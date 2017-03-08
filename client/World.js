var World = {
	chunks: {},
	getBlockPosFromWorldPoint(p) {
		var ix = Math.floor(p.x)
		var iy = Math.floor(p.y)
		var iz = Math.floor(p.z)
		var cx = Math.floor(ix / CHUNK_SIZE)
		var cy = Math.floor(iy / CHUNK_SIZE)
		var cz = Math.floor(iz / CHUNK_SIZE)
		var chunk = this.chunks[ this.getChunkIdFromCoords(cx, cy, cz) ]
		if (!chunk) { return BlockPos.badPos }
		return new BlockPos(chunk, ix - cx * CHUNK_SIZE, iy - cy * CHUNK_SIZE, iz - cz * CHUNK_SIZE)
	},
	getChunkId(chunkPos) {
		return chunkPos.x + ',' + chunkPos.y + ',' + chunkPos.z
	},
	getChunkIdFromCoords(cx, cy, cz) {
		return cx + ',' + cy + ',' + cz
	},
	addChunk(chunk) {
		// put the chunk in our list of loaded chunks
		this.chunks[ chunk.id ] = chunk

		// attach the chunk to any loaded neighbouring chunks
		for (var sideId = 0; sideId < 6; sideId += 1) {
			var side = SidesById[sideId]
			var neighbourChunkPos = chunk.chunkPos.clone().add(side.deltaVector3)
			var neighbourChunk = this.chunks[ this.getChunkId(neighbourChunkPos) ]
			if (neighbourChunk) {
				chunk.attachChunkNeighbour(side, neighbourChunk)
				neighbourChunk.attachChunkNeighbour(side.opposite, chunk)
			}
		}
	},
	removeChunk(chunk) {
		chunk.stop()
		ChunkPool.release(chunk)
		delete(this.chunks[ chunk.id ])
	},
	updateChunks() {
		var renderBudget = maxQuadsPerMesh * 1
		_.each(this.chunks, chunk => {
			renderBudget = chunk.update(renderBudget)
		})
	},
	translatePlayerWithCollisions(pos, moveVector, halfWidth) {
		
		//var blockPos = World.getBlockPosFromWorldPoint(origin)

		var translate = function(result) {
			pos.x += result[0]
			pos.y += result[1]
			pos.z += result[2]
		}

		var getVoxel = function(x,y,z) { return World.getBlockPosFromWorldPoint({ x:x, y:y, z:z }).isOpaque() } // TODO: optimize me, similarly to raycast(): use one or more existing blockPos objects and add() them to move them around
		var box = { base: [pos.x - halfWidth, pos.y - 1.6, pos.z - halfWidth], max: [pos.x + halfWidth, pos.y + 0.2, pos.z + halfWidth], translate: translate }
		var vector = [ moveVector.x, moveVector.y, moveVector.z ]

		var hitFloor = false

		var dist = voxelAabbSweep( getVoxel, box, vector, function(dist, axis, dir, vec) {
			if (axis === 1 && moveVector.y < 0) { hitFloor = true }
			vec[axis] = 0 // halt movement along this axis, but slide along other axes
			return false // continue sweep
		})

		return hitFloor
		
	},

	// andyhall's fast-voxel-raycast https://github.com/andyhall/fast-voxel-raycast/ with some minor adaptions
	raycast(origin, direction, max_d) { // direction must be normalized

		var blockPos = World.getBlockPosFromWorldPoint(origin)

		var px = origin.x
		var py = origin.y
		var pz = origin.z
		var dx = direction.x
		var dy = direction.y
		var dz = direction.z

		var t = 0.0
				, floor = Math.floor
				, ceil = Math.ceil

				, stepx = (dx > 0) ? 1 : -1
				, stepy = (dy > 0) ? 1 : -1
				, stepz = (dz > 0) ? 1 : -1
				
				, ix = floor(px)
				, iy = floor(py)
				, iz = floor(pz)

			// dx,dy,dz are already normalized
				, txDelta = Math.abs(1 / dx)
				, tyDelta = Math.abs(1 / dy)
				, tzDelta = Math.abs(1 / dz)

				, xdist = (stepx > 0) ? (ix + 1 - px) : (px - ix)
				, ydist = (stepy > 0) ? (iy + 1 - py) : (py - iy)
				, zdist = (stepz > 0) ? (iz + 1 - pz) : (pz - iz)
				
			// location of nearest voxel boundary, in units of t 
				, txMax = (txDelta < Infinity) ? txDelta * xdist : Infinity
				, tyMax = (tyDelta < Infinity) ? tyDelta * ydist : Infinity
				, tzMax = (tzDelta < Infinity) ? tzDelta * zdist : Infinity

				, steppedIndex = -1

		// main loop along raycast vector
		while (t <= max_d) {


			if (!blockPos.isLoaded) {
				return undefined
			}

			// exit check
			if (blockPos.isOpaque()) {
				//if (hit_pos) {
				//	hit_pos[0] = px + t * dx
				//	hit_pos[1] = py + t * dy
				//	hit_pos[2] = pz + t * dz
				//}
				var side
				if (steppedIndex === 0) {
					side = (stepx > 0) ? Sides.WEST : Sides.EAST
				}
				else if (steppedIndex === 1) {
					side = (stepy > 0) ? Sides.BOTTOM : Sides.TOP
				}
				else { // if the camera is inside a block, this else will cause the side to be only either north or south!
					side = (stepz > 0) ? Sides.SOUTH : Sides.NORTH
				}
				return { blockPos: blockPos, dist: t, side: side }
			}

			// advance t to next nearest voxel boundary
			if (txMax < tyMax) {
				if (txMax < tzMax) {
					//ix += stepx
					blockPos.add(stepx, 0, 0)
					t = txMax
					txMax += txDelta
					steppedIndex = 0
				} else {
					//iz += stepz
					blockPos.add(0, 0, stepz)
					t = tzMax
					tzMax += tzDelta
					steppedIndex = 2
				}
			} else {
				if (tyMax < tzMax) {
					//iy += stepy
					blockPos.add(0, stepy, 0)
					t = tyMax
					tyMax += tyDelta
					steppedIndex = 1
				} else {
					//iz += stepz
					blockPos.add(0, 0, stepz)
					t = tzMax
					tzMax += tzDelta
					steppedIndex = 2
				}
			}

		}
		// max_d exceeded
		return undefined
	},
}
