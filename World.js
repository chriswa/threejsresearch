class ChunkGenWorker {
	constructor(id) {
		this.id = id
		this.callback = undefined
		this.worker = new Worker('workerChunkGen.js')

		this.worker.addEventListener('message', e => {
			this.callback(e.data)
		})
	}
	start(payload, transferableObjects, callback) {
		this.callback = callback
		payload.workerId = this.id 
		this.worker.postMessage(payload, transferableObjects) // transfer with "Transferable Objects"
	}
}

var ChunkGenWorkerManager = {
	workerCount: 4,
	availableWorkers: [],
	queuedTasks: [],
	init() {
		for (var i = 0; i < this.workerCount; i += 1) {
			this.availableWorkers.push(new ChunkGenWorker(i))
		}
	},
	queueTask(payload, transferableObjects, callback) {
		this.queuedTasks.push({ payload, transferableObjects, callback })
		this.processQueue()
	},
	processQueue() {
		while (this.availableWorkers.length > 0 && this.queuedTasks.length > 0) {
			var task = this.queuedTasks.shift()
			var worker = this.availableWorkers.pop()
			this.startWorker(worker, task)
		}
	},
	startWorker(worker, task) {
		worker.start(task.payload, task.transferableObjects, payload => {
			this.availableWorkers.push(worker)
			this.processQueue()
			task.callback(payload)
		})
	},
}
ChunkGenWorkerManager.init()

var World = {
	chunks: {},
	chunksQueued: {},
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
	queueChunkLoad(chunkPos) {

		// set a semaphore to block additional queueChunkLoad calls for this chunk until this one completes
		var chunkId = this.getChunkId(chunkPos)
		this.chunksQueued[chunkId] = true
		
		// acquire a Chunk
		var chunk = ChunkPool.acquire()

		var request = {}
		var transferableObjects = []

		// send chunkPos
		request.chunkPos = chunkPos

		// transfer* the chunk's blockData buffer
		request.blockDataBuffer = chunk.blockData.buffer,
		transferableObjects.push( request.blockDataBuffer )

		// transfer* the chunk's quadIdsByBlockAndSide buffer
		request.quadIdsByBlockAndSideBuffer = chunk.quadIdsByBlockAndSide.buffer,
		transferableObjects.push( request.quadIdsByBlockAndSideBuffer )

		// transfer reusable chunk vertexBuffer buffers 
		request.reusableVertexBuffers = []
		if (ChunkVertexBufferPool.pool.length) {
			request.reusableVertexBuffers.push(ChunkVertexBufferPool.pool.pop())
		}
		transferableObjects.concat( request.reusableVertexBuffers )

		//console.log(`World.queueChunkLoad is sending ${request.reusableVertexBuffers.length} reusableVertexBuffers`)

		// send the request to a web worker
		ChunkGenWorkerManager.queueTask(request, transferableObjects, response => {

			//console.log(`World.queueChunkLoad got back ${response.prefilledVertexBuffers.length} prefilledVertexBuffers and ${response.unusedVertexBuffers.length} unusedVertexBuffers`)


			// put the chunk in our list of loaded chunks
			this.chunks[ chunkId ] = chunk

			// attach the chunk to any loaded neighbouring chunks
			for (var sideId = 0; sideId < 6; sideId += 1) {
				var side = SidesById[sideId]
				var neighbourChunkPos = chunkPos.clone().add(side.deltaVector3)
				var neighbourChunk = this.chunks[ this.getChunkId(neighbourChunkPos) ]
				if (neighbourChunk) {
					chunk.attachChunkNeighbour(side, neighbourChunk)
					neighbourChunk.attachChunkNeighbour(side.opposite, chunk)
				}
			}

			// start the chunk, passing in buffers (blockData, quadIdsByBlockAndSide, and prefilledVertexBuffers) and quadCount
			chunk.start(chunkPos, response.chunkBlockDataBuffer, response.quadIdsByBlockAndSideBuffer, response.quadCount, response.prefilledVertexBuffers)

			// if we provided too many reusableVertexBuffers in the request, we need to return any unused ones to the pool
			ChunkVertexBufferPool.pool.concat(response.unusedVertexBuffers)

			// remove our semaphore
			delete(this.chunksQueued[chunkId])
		})
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
	loadAndUnloadChunksAroundChunkPos(centreChunkPos, chunkRange) {

		_.each(this.chunks, chunk => chunk.outOfRange = true )

		var chunksToLoad = []

		var chunkLoadCount = 0

		var chunksWithinDistance = 1
		for (var i = 0; i < voxelSphereAreaByDistance.length; i += 1) {
			if (voxelSphereAreaByDistance[i][0] > chunkRange) { break }
			chunksWithinDistance = voxelSphereAreaByDistance[i][1]
		}

		var cursorChunkPos = new THREE.Vector3()
		for (var i = 0; i < chunksWithinDistance; i += 1) {

			cursorChunkPos.addVectors(centreChunkPos, sortedVoxelDistances[i])
			var targetChunkId = this.getChunkId(cursorChunkPos)

			if (this.chunksQueued[targetChunkId]) {
				continue
			}

			var alreadyLoadedChunk = this.chunks[targetChunkId]
			if (alreadyLoadedChunk) {
				alreadyLoadedChunk.outOfRange = false
				continue
			}

			chunksToLoad.push(cursorChunkPos.clone())

		}
		var chunksToRemove = []
		_.each(this.chunks, chunk => {
			if (chunk.outOfRange) {
				chunksToRemove.push(chunk)
			}
		})
		_.each(chunksToRemove, chunk => this.removeChunk(chunk))
		_.each(chunksToLoad, chunkPos => {
			this.queueChunkLoad(chunkPos)
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
