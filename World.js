var World = {
	chunks: {},
	getBlockPosFromWorldPoint(p) {
		var ix = Math.floor(p.x)
		var iy = Math.ceil(p.y)
		var iz = Math.floor(p.z)
		var cx = Math.floor(ix / Chunk.sizeX)
		var cy = Math.floor(iy / Chunk.sizeY)
		var cz = Math.floor(iz / Chunk.sizeZ)
		var chunk = this.chunks[ this.getChunkId(cx, cy, cz) ]
		if (!chunk) { return BlockPos.badPos }
		return chunk.getBlockPos(ix - cx * Chunk.sizeX, iy - cy * Chunk.sizeY, iz - cz * Chunk.sizeZ)
	},
	getChunkId(cx, cy, cz) {
		return cx + ',' + cy + ',' + cz
	},
	addChunk(cx, cy, cz) {
		var chunk = new Chunk(cx, cy, cz)
		chunk.chunkMesh.mesh.position.x = cx * Chunk.sizeX
		chunk.chunkMesh.mesh.position.y = cy * Chunk.sizeY
		chunk.chunkMesh.mesh.position.z = cz * Chunk.sizeZ
		scene.add( chunk.chunkMesh.mesh );

		this.chunks[ chunk.id ] = chunk

		for (var sideId = 0; sideId < 6; sideId += 1) {
			var side = SidesById[sideId]
			var neighbour = this.chunks[ this.getChunkId(cx + side.dx, cy + side.dy, cz + side.dz) ]
			if (neighbour) {
				chunk.attachChunkNeighbour(side, neighbour)
				neighbour.attachChunkNeighbour(side.opposite, chunk)
			}
		}

		return chunk
	},
	removeChunk(chunk) {
		scene.remove( chunk.mesh )
		chunk.dispose()
		delete(this.chunks[ chunk.id ])
	},
	updateChunks() {
		_.each(this.chunks, chunk => chunk.update())
	},
	build() {
		noise.seed(0)
		this.loadChunk(0, 0, 0)
		var centerChunk = this.chunks[ this.getChunkId(0, 0, 0) ]
		this.updateNearbyChunks(centerChunk)
	},
	updateNearbyChunks(centerChunk) {
		_.each(this.chunks, chunk => chunk.outOfRange = true )

		var chunksToLoad = []

		var chunkLoadCount = 0
		var chunkRange = 3
		for (var dcx = -chunkRange; dcx <= chunkRange; dcx += 1) {
			for (var dcy = -chunkRange; dcy <= chunkRange; dcy += 1) {
				for (var dcz = -chunkRange; dcz <= chunkRange; dcz += 1) {
					if (Math.sqrt(dcx*dcx + dcy*dcy + dcz*dcz) > chunkRange + 0.5) { continue }

					var cx = centerChunk.cx + dcx
					var cy = centerChunk.cy + dcy
					var cz = centerChunk.cz + dcz

					var alreadyLoadedChunk = this.chunks[this.getChunkId(cx, cy, cz)]
					if (alreadyLoadedChunk) {
						alreadyLoadedChunk.outOfRange = false
						continue
					}

					chunksToLoad.push([cx, cy, cz])

				}
			}
		}
		var chunksToRemove = []
		_.each(this.chunks, chunk => {
			if (chunk.outOfRange) {
				chunksToRemove.push(chunk)
			}
		})
		_.each(chunksToRemove, chunk => this.removeChunk(chunk))
		_.each(chunksToLoad, coords => {
			this.loadChunk(coords[0], coords[1], coords[2]) // cx, cy, cz
		})
	},
	loadChunk(cx, cy, cz) {
		var chunk = World.addChunk(cx, cy, cz)

		var chunkBlockData = chunk.blockData
		for (var x = 0, i = 0; x < Chunk.sizeX; x += 1) {
			for (var y = 0; y < Chunk.sizeY; y += 1) {
				for (var z = 0; z < Chunk.sizeZ; z += 1, i += 1) {
					
					var sampleX = x + cx * Chunk.sizeX
					var sampleY = y + cy * Chunk.sizeY
					var sampleZ = z + cz * Chunk.sizeZ

					var blockData = 0

					if (sampleY < -6) {
							blockData = BlockTypesByName.stone.id
					}
					else if (sampleY > 12) {
							blockData = BlockTypesByName.air.id
					}
					else {
						if (noise.simplex3(sampleX / 20, sampleY / 50, sampleZ / 20) > sampleY / 5) {
							blockData = BlockTypesByName.dirt.id
						}
						if (noise.simplex3((sampleX + 874356) / 10, sampleY / 50, (sampleZ + 874356) / 10) > ((sampleY + 0) / 10)) {
							blockData = BlockTypesByName.stone.id
						}
					}
					
					//if (cx === 0) { blockData = 0 }

					//isDirt = sampleY < 3
					chunkBlockData[i] = blockData;
				}
			}
		}

		chunk.redraw()
	},
	raycast(ray, max_d) { // ray.direction must be normalized // https://github.com/andyhall/fast-voxel-raycast/
		var origin = ray.origin
		var direction = ray.direction // normalized

		var blockPos = World.getBlockPosFromWorldPoint(origin)

		var px = origin.x
		var py = origin.y
		var pz = origin.z
		var dx = direction.x
		var dy = direction.y
		var dz = direction.z

		var t = 0.0
				, floor = Math.floor
				, ix = floor(px) | 0
				, iy = floor(py) | 0
				, iz = floor(pz) | 0

				, stepx = (dx > 0) ? 1 : -1
				, stepy = (dy > 0) ? 1 : -1
				, stepz = (dz > 0) ? 1 : -1
				
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
