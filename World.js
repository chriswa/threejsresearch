var chunkGenWorker = new Worker('workerChunkGen.js')
var chunkGenWorkerCallbacks = {}
var chunkGenWorkerCallbackNextId = 0
chunkGenWorker.addEventListener('message', e => {
	var callbackId = e.data.callbackId
	var callback = chunkGenWorkerCallbacks[callbackId]
	if (callback) {
		callback(e.data.payload)
	}
})
var ChunkGenWorker = {
	start(blockData, cx, cy, cz, callback) {
		var callbackId = chunkGenWorkerCallbackNextId++
		chunkGenWorkerCallbacks[callbackId] = callback
		chunkGenWorker.postMessage({ callbackId, cx, cy, cz, blockData }, [ blockData.buffer ])
	}
}

var World = {
	chunks: {},
	chunksQueued: {},
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
	queueChunkLoad(cx, cy, cz) {
		var chunkId = this.getChunkId(cx, cy, cz)
		this.chunksQueued[chunkId] = true
		var blockData = ChunkBlockDataPool.acquire()
		ChunkGenWorker.start(blockData, cx, cy, cz, blockData => {

			delete(this.chunksQueued[chunkId])

			var chunk = new Chunk(cx, cy, cz, blockData)

			this.chunks[ chunk.id ] = chunk

			for (var sideId = 0; sideId < 6; sideId += 1) {
				var side = SidesById[sideId]
				var neighbour = this.chunks[ this.getChunkId(cx + side.dx, cy + side.dy, cz + side.dz) ]
				if (neighbour) {
					chunk.attachChunkNeighbour(side, neighbour)
					neighbour.attachChunkNeighbour(side.opposite, chunk)
				}
			}

			chunk.redraw()

		})
	},
	removeChunk(chunk) {
		ChunkBlockDataPool.release(chunk.blockData)
		chunk.dispose()
		delete(this.chunks[ chunk.id ])
	},
	updateChunks() {
		_.each(this.chunks, chunk => chunk.update())
	},
	build() {
		this.loadAndUnloadChunksNearPoint(new THREE.Vector3(0, 0, 0))
	},
	loadAndUnloadChunksNearPoint(p) {
		var ix = Math.floor(p.x)
		var iy = Math.ceil(p.y)
		var iz = Math.floor(p.z)
		var centerCX = Math.floor(ix / Chunk.sizeX)
		var centerCY = Math.floor(iy / Chunk.sizeY)
		var centerCZ = Math.floor(iz / Chunk.sizeZ)
		var centerId = this.getChunkId(centerCX, centerCY, centerCZ)
		if (centerId === this.lastCenterId) {
			return
		}
		this.lastCenterId = centerId


		_.each(this.chunks, chunk => chunk.outOfRange = true )

		var chunksToLoad = []

		var chunkLoadCount = 0
		var chunkRange = 8
		for (var dcx = -chunkRange; dcx <= chunkRange; dcx += 1) {
			for (var dcy = -chunkRange; dcy <= chunkRange; dcy += 1) {
				for (var dcz = -chunkRange; dcz <= chunkRange; dcz += 1) {
					if (Math.sqrt(dcx*dcx + dcy*dcy + dcz*dcz) > chunkRange + 0.5) { continue }

					var cx = centerCX + dcx
					var cy = centerCY + dcy
					var cz = centerCZ + dcz
					var targetChunkId = this.getChunkId(cx, cy, cz)

					if (this.chunksQueued[targetChunkId]) {
						continue
					}

					var alreadyLoadedChunk = this.chunks[targetChunkId]
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
			this.queueChunkLoad(coords[0], coords[1], coords[2]) // cx, cy, cz
		})
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
