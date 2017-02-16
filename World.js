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
	addChunk(blockData, cx, cy, cz) {
		var chunk = new Chunk(blockData, cx, cy, cz)
		chunk.mesh.position.x = cx * Chunk.sizeX
		chunk.mesh.position.y = cy * Chunk.sizeY
		chunk.mesh.position.z = cz * Chunk.sizeZ
		scene.add( chunk.mesh );

		this.chunks[ chunk.id ] = chunk

		for (var sideId = 0; sideId < 6; sideId += 1) {
			var side = SidesById[sideId]
			var neighbour = this.chunks[ this.getChunkId(cx + side.dx, cy + side.dy, cz + side.dz) ]
			if (neighbour) {
				chunk.addChunkNeighbour(side, neighbour)
				neighbour.addChunkNeighbour(side.opposite, chunk)
			}
		}
	},
	dirtyChunks: {},
	markChunkAsDirty(chunk) {
		this.dirtyChunks[chunk.id] = chunk
	},
	cleanAllDirtyChunks() {
		_.each(this.dirtyChunks, chunk => chunk.cleanup())
		this.dirtyChunks = {}
	},
	build() {
		noise.seed(0)
		for (var cx = -5; cx <= 5; cx += 1) {
			for (var cy = -5; cy <= 5; cy += 1) {
				for (var cz = -5; cz <= 5; cz += 1) {
					if (Math.sqrt(cx*cx + cy*cy + cz*cz) > 2.5) { continue }

					var blockData = new Uint16Array( Chunk.sizeX * Chunk.sizeY * Chunk.sizeZ )
					for (var x = 0, i = 0; x < Chunk.sizeX; x += 1) {
						for (var y = 0; y < Chunk.sizeY; y += 1) {
							for (var z = 0; z < Chunk.sizeZ; z += 1, i += 1) {
								var sampleX = x + cx * Chunk.sizeX
								var sampleY = y + cy * Chunk.sizeY
								var sampleZ = z + cz * Chunk.sizeZ
								//var isDirt = Math.random() * sampleY * sampleY * sampleY / 2 < 1
								var isDirt = 1
								//if (sampleY >= 3) { isDirt = 0 }

								//if (sampleY === 3) {
								//	//isDirt = Math.random() < 0.25 ? 1 : 0;
								//	isDirt = noise.simplex2(x + cx * Chunk.sizeX, z + cz * Chunk.sizeZ) > 0.5
								//}
								isDirt = noise.simplex3(sampleX / 10, sampleY / 50, sampleZ / 10) > sampleY / 10
                                
								blockData[i] = isDirt ? 1 : 0; // dirt, air
							}
						}
					}

					World.addChunk(blockData, cx, cy, cz)
				}
			}
		}
		_.each(World.chunks, chunk => chunk.drawAllQuads() )
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
			var b = blockPos.getBlockData()
			if (b === 1) {
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
