var ChunkLoader = {

	followsCamera: true,
	
	centreChunkPos: new THREE.Vector3(0.5, 0.5, 0.5), // an invalid chunkPos, forcing the first update to load chunks

	loadingChunks: {},

	queuedDebugChunkOutlines: {},

	init(range) {
		this.range = range
	},

	update(force) {
		if (this.followsCamera && !force) {
			var cameraChunkPos = Game.camera.position.clone().divideScalar(CHUNK_SIZE).floor()
			if (cameraChunkPos.equals(this.centreChunkPos)) { return }
			this.centreChunkPos.copy(cameraChunkPos)
		}
		this.loadAndUnloadChunksAroundChunkPos(this.centreChunkPos, this.range)
	},

	loadAndUnloadChunksAroundChunkPos(centreChunkPos, chunkRange) {

		var chunksToLoad = {}

		var chunksWithinDistance = 1
		for (var i = 0; i < voxelSphereAreaByDistance.length; i += 1) {
			if (voxelSphereAreaByDistance[i][0] > chunkRange) { break }
			chunksWithinDistance = voxelSphereAreaByDistance[i][1]
		}

		var cursorChunkPos = new THREE.Vector3()
		for (var i = 0; i < chunksWithinDistance; i += 1) {

			cursorChunkPos.addVectors(centreChunkPos, sortedVoxelDistances[i])
			var targetChunkId = World.getChunkId(cursorChunkPos)

			chunksToLoad[ targetChunkId ] = cursorChunkPos.clone()
		}

		_.each(World.chunks, chunk => {
			if (!chunksToLoad[chunk.id]) {
				World.removeChunk(chunk)
			}
		})

		_.each(this.loadingChunks, (task, chunkId) => {
			if (!chunksToLoad[chunkId]) {
				this.cancelChunkLoad(chunkId)
			}
		})

		_.each(chunksToLoad, (chunkPos, chunkId) => {
			if (!this.loadingChunks[chunkId] && !World.chunks[chunkId]) {
				this.queueChunkLoad(chunkPos)
			}
		})
		
	},
	queueChunkLoad(chunkPos) {

		var chunkId = World.getChunkId(chunkPos)
		var chunk

		var debugChunkOutline = new ChunkOutline(Game.scene, 0x000088)
		debugChunkOutline.object.position.copy(chunkPos).multiplyScalar(CHUNK_SIZE)
		this.queuedDebugChunkOutlines[chunkId] = debugChunkOutline

		
		// send the request to a web worker
		var taskId = ChunkGenWorkerManager.queueTask(

			// start task
			() => {

				debugChunkOutline.material.color.setHex(0x00ff00)

				// acquire a Chunk object (complete with array buffers)
				chunk = ChunkPool.acquire()

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

				// transfer* reusable chunk vertexBuffer buffers 
				request.reusableVertexBuffers = []
				if (ChunkVertexBufferPool.pool.length) {
					request.reusableVertexBuffers.push(ChunkVertexBufferPool.pool.pop())
				}
				transferableObjects.concat( request.reusableVertexBuffers )
				
				return [request, transferableObjects]

			},

			// task complete
			response => {

				if (debugChunkOutline.object.parent) {
					debugChunkOutline.dispose()
				}

				if (response.success) {

					// start the chunk, passing in buffers (blockData, quadIdsByBlockAndSide, and prefilledVertexBuffers) and quadCount
					chunk.start(chunkPos, response.chunkBlockDataBuffer, response.quadIdsByBlockAndSideBuffer, response.quadCount, response.prefilledVertexBuffers)

					// remove our semaphore
					delete(this.loadingChunks[chunkId])
				}

				else {

					// reabsorb arraybuffers into chunk (TODO: move this and related code to Chunk? or ChunkTransferManager?)
					chunk.blockData = new Uint16Array(response.chunkBlockDataBuffer)
					chunk.quadIdsByBlockAndSide = new Uint16Array(response.quadIdsByBlockAndSideBuffer)

				}

				// if we provided too many reusableVertexBuffers in the request, we need to return any unused ones to the pool
				ChunkVertexBufferPool.pool.concat(response.unusedVertexBuffers)

			}

		)

		// set a semaphore to block additional queueChunkLoad calls for this chunk until this one completes
		this.loadingChunks[ chunkId ] = taskId
	},
	cancelChunkLoad(chunkId) {
		var taskId = this.loadingChunks[chunkId]
		if (taskId) {
			var wasImmediatelyCancelled = ChunkGenWorkerManager.cancelTask(taskId)

			// remove our semaphore
			delete(this.loadingChunks[chunkId])

			var debugChunkOutline = this.queuedDebugChunkOutlines[chunkId]
			if (wasImmediatelyCancelled) {
				debugChunkOutline.material.color.setHex(0xff0000)

			}
			else {
				debugChunkOutline.material.color.setHex(0xff00ff)
			}
			setTimeout(() => {
				// the success response may have come back since this timeout was setup, so debugChunkOutline may already have been disposed of
				if (debugChunkOutline.object.parent) {
					debugChunkOutline.dispose()
				}
			}, 50)
		}
		else {
			debugger
		}
	},
}
