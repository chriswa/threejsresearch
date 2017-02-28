// var worker = new Worker('workerWorldGen.js');
// worker.addEventListener('message', function(e) {
//   console.log('Worker said: ', e.data);
// }, false);
// worker.postMessage({'cmd': 'start', 'msg': 'Hi'}); // Start the worker.

importScripts(
	'lib/lodash.js',
	'lib/perlin.js',
	'lib/three.js',
	'constants.js',
	'Pool.js',
	'Sides.js',
	'BlockTypes.js',
	'QuadWriter.js'
)


noise.seed(2)


var borderedSize = CHUNK_SIZE + 2

var borderedTransparencyLookup = new Uint8Array( borderedSize * borderedSize * borderedSize / 8 ) // shared for this worker?


self.addEventListener('message', function(e) {
	var request = e.data

	var chunkBlockData        = new Uint16Array(request.blockDataBuffer)
	var chunkPos              = request.chunkPos
	var quadIdsByBlockAndSide = new Uint16Array(request.quadIdsByBlockAndSideBuffer)
	var reusableVertexBuffers = request.reusableVertexBuffers

	// generate the block data (perlin noise!)
	loadChunkData(chunkPos, chunkBlockData, borderedTransparencyLookup)

	// prepare a pool to serve reusableVertexBuffers, then create them as needed
	var vertexBufferPool = new Pool(() => new Float32Array( maxQuadsPerMesh * 8 * 4 ).buffer)
	vertexBufferPool.pool = reusableVertexBuffers

	// pre-draw the quads to vertex buffers
	var chunkPrewriter = new ChunkPrewriter(chunkBlockData, quadIdsByBlockAndSide, vertexBufferPool, borderedTransparencyLookup)

	chunkPrewriter.drawAllBlocks()

	var response = {}
	var transferableObjects = []

	response.chunkBlockDataBuffer = chunkBlockData.buffer
	transferableObjects.push(response.chunkBlockDataBuffer)

	response.quadIdsByBlockAndSideBuffer = quadIdsByBlockAndSide.buffer
	transferableObjects.push(response.quadIdsByBlockAndSideBuffer)
	
	response.quadCount = chunkPrewriter.quadCount
	
	response.prefilledVertexBuffers = _.map(chunkPrewriter.vertexBuffers, vertexBuffer => vertexBuffer.buffer)
	transferableObjects.concat(response.prefilledVertexBuffers)
	
	response.unusedVertexBuffers = vertexBufferPool.pool
	transferableObjects.concat(response.unusedVertexBuffers)

	response.callbackId = request.callbackId
	
	self.postMessage(response, transferableObjects) // transfer with "Transferable Objects". the 'version' from the calling context is no longer available once transferred to the new context

}, false);


class ChunkPrewriter {
	constructor(blockData, quadIdsByBlockAndSide, vertexBufferPool, borderedTransparencyLookupBuffer) {
		this.blockData = blockData
		this.quadIdsByBlockAndSide = quadIdsByBlockAndSide
		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.vertexBuffers = []
		this.currentVertexBuffer = undefined
		this.borderedTransparencyLookup = new Uint8Array( borderedTransparencyLookupBuffer )
		this.vertexBufferPool = vertexBufferPool
		this._edgeOccludingBlockPos = new THREE.Vector3()   // optimization: keep these around for repeated calls to calculateVertexColours
		this._cornerOccludingBlockPos = new THREE.Vector3()   // optimization: keep these around for repeated calls to calculateVertexColours
	}
	addVertexBuffer() {
		var vertexBuffer = new Float32Array( this.vertexBufferPool.acquire() )
		this.vertexBuffers.push(vertexBuffer)
		return vertexBuffer
	}
	addQuad(blockPos, side, uvs, brightnesses, rgb) {
		var quadId = this.quadCount
		this.quadCount += 1
		if (this.quadCount > this.vertexBuffers.length * maxQuadsPerMesh) {
			this.currentVertexBuffer = this.addVertexBuffer()
		}
		QuadWriter.draw(this.currentVertexBuffer, quadId % maxQuadsPerMesh, blockPos, side, uvs, brightnesses, rgb)
		var blockPosIndex = blockPos.x * CHUNK_SIZE_SQUARED + blockPos.y * CHUNK_SIZE + blockPos.z
		this.quadIdsByBlockAndSide[blockPosIndex * 6 + side.id] = quadId
	}


	isTransparent(blockPos) {
		var borderedTransparencyLookupIndex = (blockPos.x+1) * borderedSize*borderedSize + (blockPos.y+1) * borderedSize + (blockPos.z+1)
		var byteIndex = borderedTransparencyLookupIndex >> 3
		var bitIndex  = borderedTransparencyLookupIndex & 0x7
		return ((this.borderedTransparencyLookup[byteIndex] >> bitIndex) & 0x1)
	}

	drawAllBlocks() {
		var solidBlockPos = new THREE.Vector3()
		var airBlockPos = new THREE.Vector3()

		var mainBlockIndex = 0

		for (solidBlockPos.x = 0; solidBlockPos.x < CHUNK_SIZE; solidBlockPos.x += 1) {
			for (solidBlockPos.y = 0; solidBlockPos.y < CHUNK_SIZE; solidBlockPos.y += 1) {
				for (solidBlockPos.z = 0; solidBlockPos.z < CHUNK_SIZE; solidBlockPos.z += 1) {

					if (!this.isTransparent(solidBlockPos)) {

						for (var sideId = 0; sideId < 6; sideId += 1) {
							var side = SidesById[sideId]

							airBlockPos.addVectors(solidBlockPos, side.deltaVector3) // n.b. -1..CHUNK_SIZE+1 for one dimension
							var adjacentIsTransparent = this.isTransparent(airBlockPos)
							if (adjacentIsTransparent) {

								var blockType = BlockTypesById[this.blockData[mainBlockIndex]]
								var uvs = blockType.textureSides[side.id]
								var rgb = blockType.colourSides[side.id]

								// determine vertex colours (AO)
								var brightnesses = this.calculateVertexColours(airBlockPos, side)

								this.addQuad(solidBlockPos, side, uvs, brightnesses, rgb)
							}
							
						}
					}


					mainBlockIndex += 1
				}
			}
		}

		// because quadCount starts at 1 (to aid debugging,) but we draw starting at 0 for simplicity (because this only affects the first ChunkMesh in a ChunkMeshManager)...
		// we need to clear the first quad!
		if (this.vertexBuffers.length) {
			QuadWriter.clear(this.vertexBuffers[0], 0)
		}

	}

	calculateVertexColours(airBlockPos, side) {
		// determine ambient occlusion
		var brightnesses = [0, 0, 0, 0]

		// check for occlusion at right angles to the block's normal
		for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
			var tangentSide = side.tangents[tangentIndex].side
			
			this._edgeOccludingBlockPos.addVectors(airBlockPos, tangentSide.deltaVector3)

			if (!this.isTransparent(this._edgeOccludingBlockPos)) {
				brightnesses[tangentIndex]           += 2
				brightnesses[(tangentIndex + 1) % 4] += 2
			}

			// right angle again
			var diagonalTangentSide = side.tangents[(tangentIndex + 1) % 4].side

			this._cornerOccludingBlockPos.addVectors(this._edgeOccludingBlockPos, diagonalTangentSide.deltaVector3)

			if (!this.isTransparent(this._cornerOccludingBlockPos)) {
				brightnesses[(tangentIndex + 1) % 4] += 1
			}
		}

		var occludedBrightnesses = [1, 0.7, 0.7, 0.6, 0.5, 0.5]
		for (var i = 0; i < 4; i += 1) {
			brightnesses[i] = occludedBrightnesses[brightnesses[i]]
		}

		return brightnesses
	}
}


function loadChunkData(chunkPos, chunkBlockData, borderedTransparencyLookup) {
	var chunkBlockIndex = 0
	var borderedTransparencyLookupIndex = 0
	for (var x = -1; x < CHUNK_SIZE + 1; x += 1) {
		var isBorderX = x < 0 || x === CHUNK_SIZE
		for (var y = -1; y < CHUNK_SIZE + 1; y += 1) {
			var isBorderY = y < 0 || y === CHUNK_SIZE
			for (var z = -1; z < CHUNK_SIZE + 1; z += 1) {
				var isBorderZ = z < 0 || z === CHUNK_SIZE
				
				var sampleX = x + chunkPos.x * CHUNK_SIZE
				var sampleY = y + chunkPos.y * CHUNK_SIZE
				var sampleZ = z + chunkPos.z * CHUNK_SIZE

				var blockData = 0

				if (sampleY < -6) {
						blockData = BlockTypesByName.stone.id
				}
				else if (sampleY > 20) {
						blockData = BlockTypesByName.air.id
				}
				else {
					if (noise.simplex3(sampleX / 80, sampleY / 200, sampleZ / 80) > sampleY / 5) {
						blockData = BlockTypesByName.dirt.id
					}
					if (noise.simplex3((sampleX + 874356) / 20, (sampleY + 63456) / 40, (sampleZ + 475672) / 20) > ((sampleY + 0) / 10) && 
						  noise.simplex3((sampleX + 3452234) / 20, (sampleY + 567834) / 40, (sampleZ + 464562) / 20) > ((sampleY + 0) / 10)) {
						blockData = BlockTypesByName.stone.id
					}
				}

				if (!isBorderX && !isBorderY && !isBorderZ) {
					chunkBlockData[chunkBlockIndex] = blockData;
					chunkBlockIndex += 1
				}

				// write to borderedTransparencyLookup
				var byteIndex = borderedTransparencyLookupIndex >> 3
				var bitIndex  = borderedTransparencyLookupIndex & 0x7
				if (blockData === BlockTypesByName.air.id) {
					this.borderedTransparencyLookup[byteIndex] |= 1 << bitIndex // set bit
				}
				else {
					this.borderedTransparencyLookup[byteIndex] &= ~(1 << bitIndex) // unset bit
				}

				borderedTransparencyLookupIndex += 1

			}
		}
	}
}

