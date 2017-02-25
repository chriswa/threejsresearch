// var worker = new Worker('workerWorldGen.js');
// worker.addEventListener('message', function(e) {
//   console.log('Worker said: ', e.data);
// }, false);
// worker.postMessage({'cmd': 'start', 'msg': 'Hi'}); // Start the worker.

importScripts('lodash.js', 'perlin.js', 'three.js', 'constants.js', 'Pool.js', 'Sides.js', 'BlockTypes.js', 'QuadWriter.js')


noise.seed(2)


self.addEventListener('message', function(e) {
	var data = e.data

	var chunkBlockData        = new Uint16Array(data.blockDataBuffer)
	var chunkPos              = data.chunkPos
	var quadIdsByBlockAndSide = new Uint16Array(data.quadIdsByBlockAndSideBuffer)
	var reusableVertexBuffers = data.reusableVertexBuffers

	// generate the block data (perlin noise!)
	generateChunkBlockData(chunkPos, chunkBlockData)

	// prepare a pool to serve reusableVertexBuffers, then create them as needed
	var vertexBufferPool = new Pool(() => new Float32Array( maxQuadsPerMesh * 8 * 4 ).buffer)
	vertexBufferPool.pool = reusableVertexBuffers

	// pre-draw the quads to vertex buffers
	var chunkPrewriter = new ChunkPrewriter(chunkBlockData, quadIdsByBlockAndSide, vertexBufferPool)

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
	
	self.postMessage(response, transferableObjects) // transfer with "Transferable Objects". the 'version' from the calling context is no longer available once transferred to the new context

}, false);

var borderedSize = CHUNK_SIZE + 2

class ChunkPrewriter {
	constructor(blockData, quadIdsByBlockAndSide, vertexBufferPool, neighbourEdgeOpacities) {
		this.blockData = blockData
		this.quadIdsByBlockAndSide = quadIdsByBlockAndSide
		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.vertexBuffers = []
		this.currentVertexBuffer = undefined
		this.transparencyLookup = new Uint8Array( borderedSize * borderedSize * borderedSize / 8 )
		this.vertexBufferPool = vertexBufferPool
	}
	addVertexBuffer() {
		var vertexBuffer = new Float32Array( this.vertexBufferPool.acquire() )
		this.vertexBuffers.push(vertexBuffer)
		return vertexBuffer
	}
	addQuad(blockPos, side, uvs, brightnesses) {
		var quadId = this.quadCount
		this.quadCount += 1
		if (this.quadCount > this.vertexBuffers.length * maxQuadsPerMesh) {
			this.currentVertexBuffer = this.addVertexBuffer()
		}
		QuadWriter.draw(this.currentVertexBuffer, quadId % maxQuadsPerMesh, blockPos, side, uvs, brightnesses)
		var blockPosIndex = blockPos.x * CHUNK_SIZE_SQUARED + blockPos.y * CHUNK_SIZE + blockPos.z
		this.quadIdsByBlockAndSide[blockPosIndex * 6 + side.id] = quadId
	}

	prepareTransparencyLookup(neighbourEdgeOpacities) {
		var i = 0;
		for (var x = 0; x < CHUNK_SIZE; x += 1) {
			for (var y = 0; y < CHUNK_SIZE; y += 1) {
				for (var z = 0; z < CHUNK_SIZE; z += 1) {
					var b = (x+1) * borderedSize*borderedSize + (y+1) * borderedSize + (z+1)
					var j = b >> 3
					var k = b & 0x7

					if (this.blockData[i] === 0) {
						this.transparencyLookup[j] |= 1 << k
					}

					//(this.transparencyLookup[j] >> k) & 0x1

					i += 1
				}
			}
		}
		// TODO: write neighbourEdgeOpacities
	}
	isTransparent(blockPos) {
		var b = (blockPos.x+1) * borderedSize*borderedSize + (blockPos.y+1) * borderedSize + (blockPos.z+1)
		var j = b >> 3
		var k = b & 0x7
		return ((this.transparencyLookup[j] >> k) & 0x1)
	}

	drawAllBlocks() {
		this.prepareTransparencyLookup()

		var mainBlockPos = new THREE.Vector3()
		var adjacentBlockPos = new THREE.Vector3()
		var mainBlockIndex = 0

		for (mainBlockPos.x = 0; mainBlockPos.x < CHUNK_SIZE; mainBlockPos.x += 1) {
			for (mainBlockPos.y = 0; mainBlockPos.y < CHUNK_SIZE; mainBlockPos.y += 1) {
				for (mainBlockPos.z = 0; mainBlockPos.z < CHUNK_SIZE; mainBlockPos.z += 1) {

					if (!this.isTransparent(mainBlockPos)) {

						Sides.each(side => {

							adjacentBlockPos.addVectors(mainBlockPos, side.deltaVector3) // n.b. -1..CHUNK_SIZE+1 for one dimension
							var adjacentIsTransparent = this.isTransparent(adjacentBlockPos)
							if (adjacentIsTransparent) {

								var blockType = BlockTypesById[this.blockData[mainBlockIndex]]
								var uvs = blockType.textureSides[side.id]
								var brightnesses = [1,1,1,1] // this.calculateVertexColours(mainBlockPos, side)

								this.addQuad(mainBlockPos, side, uvs, brightnesses)
							}
							
						})
					}


					mainBlockIndex += 1
				}
			}
		}
	}
}


function generateChunkBlockData(chunkPos, chunkBlockData) {
	for (var x = 0, i = 0; x < CHUNK_SIZE; x += 1) {
		for (var y = 0; y < CHUNK_SIZE; y += 1) {
			for (var z = 0; z < CHUNK_SIZE; z += 1, i += 1) {
				
				var sampleX = x + chunkPos.x * CHUNK_SIZE
				var sampleY = y + chunkPos.y * CHUNK_SIZE - 6
				var sampleZ = z + chunkPos.z * CHUNK_SIZE

				var blockData = 0

				if (sampleY < -6) {
						blockData = BlockTypesByName.stone.id
				}
				else if (sampleY > 12) {
						blockData = BlockTypesByName.air.id
				}
				else {
					if (noise.simplex3(sampleX / 20, sampleY / 50, sampleZ / 20) > sampleY / 1) {
						blockData = BlockTypesByName.dirt.id
					}
					if (noise.simplex3((sampleX + 874356) / 10, sampleY / 50, (sampleZ + 874356) / 10) > ((sampleY + 0) / 2)) {
						blockData = BlockTypesByName.stone.id
					}
				}
				
				chunkBlockData[i] = blockData;
			}
		}
	}
}

