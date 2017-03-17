// var worker = new Worker('workerWorldGen.js');
// worker.addEventListener('message', function(e) {
//	 console.log('Worker said: ', e.data);
// }, false);
// worker.postMessage({'cmd': 'start', 'msg': 'Hi'}); // Start the worker.

importScripts(
	'lib/lodash.js',
	'lib/perlin.js',
	'lib/three.js',
	'constants.js',
	'noise.js',
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

	if (request.cancel) {
		if (request.jobId === Job.jobId) {
			Job.cancel()
		}
		return
	}

	Job.start(request)

}, false);




var Job = {
	cancelled: false,
	start(request) {

		this.cancelled = false

		this.jobId								 = request.jobId
		this.chunkBlockData				 = new Uint16Array(request.blockDataBuffer)
		this.chunkPos							 = request.chunkPos
		this.quadIdsByBlockAndSide = new Uint16Array(request.quadIdsByBlockAndSideBuffer)
		var reusableVertexBuffers  = request.reusableVertexBuffers

		// generate the block data (perlin noise!)
		loadChunkData(this.chunkPos, this.chunkBlockData, borderedTransparencyLookup)

		// prepare a pool to serve reusableVertexBuffers, then create them as needed
		this.vertexBufferPool = new Pool(() => new Float32Array( maxQuadsPerMesh * 8 * 4 ).buffer)
		this.vertexBufferPool.pool = reusableVertexBuffers

		// pre-draw the quads to vertex buffers
		this.chunkPrewriter = new ChunkPrewriter(this.chunkBlockData, this.quadIdsByBlockAndSide, this.vertexBufferPool, borderedTransparencyLookup)

		this.chunkPrewriter.drawAllBlocks()

		this.complete()

	},
	complete() {
		var response = {}
		var transferableObjects = []

		response.chunkBlockDataBuffer = this.chunkBlockData.buffer
		transferableObjects.push(response.chunkBlockDataBuffer)

		response.quadIdsByBlockAndSideBuffer = this.quadIdsByBlockAndSide.buffer
		transferableObjects.push(response.quadIdsByBlockAndSideBuffer)
		
		response.quadCount = this.chunkPrewriter.quadCount
		
		response.prefilledVertexBuffers = _.map(this.chunkPrewriter.vertexBuffers, vertexBuffer => vertexBuffer.buffer)
		transferableObjects.concat(response.prefilledVertexBuffers)
		
		response.unusedVertexBuffers = this.vertexBufferPool.pool
		transferableObjects.concat(response.unusedVertexBuffers)

		response.jobId = this.jobId
		response.success = true

		self.postMessage(response, transferableObjects) // transfer with "Transferable Objects". the 'version' from the calling context is no longer available once transferred to the new context
	},
}



class ChunkPrewriter {
	constructor(blockData, quadIdsByBlockAndSide, vertexBufferPool, borderedTransparencyLookupBuffer) {
		this.blockData = blockData
		this.quadIdsByBlockAndSide = quadIdsByBlockAndSide
		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.vertexBuffers = []
		this.currentVertexBuffer = undefined
		this.borderedTransparencyLookup = new Uint8Array( borderedTransparencyLookupBuffer )
		this.vertexBufferPool = vertexBufferPool
		this._edgeOccludingBlockPos = new THREE.Vector3()	 // optimization: keep these around for repeated calls to calculateVertexColours
		this._cornerOccludingBlockPos = new THREE.Vector3()	 // optimization: keep these around for repeated calls to calculateVertexColours
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
		var blockPosIndex = blockPos.x * CHUNK_SIZE_SQUARED + blockPos.z * CHUNK_SIZE + blockPos.y
		this.quadIdsByBlockAndSide[blockPosIndex * 6 + side.id] = quadId
	}


	isTransparent(blockPos) {
		var borderedTransparencyLookupIndex = (blockPos.x+1) * borderedSize*borderedSize + (blockPos.z+1) * borderedSize + (blockPos.y+1)
		var byteIndex = borderedTransparencyLookupIndex >> 3
		var bitIndex	= borderedTransparencyLookupIndex & 0x7
		return ((this.borderedTransparencyLookup[byteIndex] >> bitIndex) & 0x1)
	}

	drawAllBlocks() {
		var solidBlockPos = new THREE.Vector3()
		var airBlockPos = new THREE.Vector3()

		var mainBlockIndex = 0

		for (solidBlockPos.x = 0; solidBlockPos.x < CHUNK_SIZE; solidBlockPos.x += 1) {
			for (solidBlockPos.z = 0; solidBlockPos.z < CHUNK_SIZE; solidBlockPos.z += 1) {
				for (solidBlockPos.y = 0; solidBlockPos.y < CHUNK_SIZE; solidBlockPos.y += 1) {

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
				brightnesses[tangentIndex]					 += 2
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




var fbm1 = new Noise3d(250).setFractal(2, 0.5, 1.1)
var fbm2 = new Noise3d(80)
var fbm3 = new Noise3d(250)
var warp1 = new NoiseWarp3d(1, fbm1)
var cell1 = new CellNoise(0.02)

function loadChunkData(chunkPos, chunkBlockData, borderedTransparencyLookup) {
	var sampleVector = new THREE.Vector3()
	var chunkBlockIndex = 0
	var borderedTransparencyLookupIndex = 0
	for (var x = -1; x < CHUNK_SIZE + 1; x += 1) {
		var isBorderX = x < 0 || x === CHUNK_SIZE
		sampleVector.x = x + chunkPos.x * CHUNK_SIZE
		for (var z = -1; z < CHUNK_SIZE + 1; z += 1) {
			var isBorderZ = z < 0 || z === CHUNK_SIZE
			sampleVector.z = z + chunkPos.z * CHUNK_SIZE


			var cellNoise = cell1.sample2sqr(sampleVector.x, sampleVector.z)
			var v_dist = cellNoise[0]
			var v_closest = cellNoise[1]


			for (var y = -1; y < CHUNK_SIZE + 1; y += 1) {
				var isBorderY = y < 0 || y === CHUNK_SIZE
				sampleVector.y = y + chunkPos.y * CHUNK_SIZE
						

				var blockData = BlockTypesByName.air.id

				if (sampleVector.y < -10) {
					blockData = BlockTypesByName.obsidian.id
				}
				else if (sampleVector.y < 50) {
					blockData = terrainGen(sampleVector, v_dist, v_closest)
				}


				if (!isBorderX && !isBorderY && !isBorderZ) {
					chunkBlockData[chunkBlockIndex] = blockData;
					chunkBlockIndex += 1
				}

				// write to borderedTransparencyLookup
				var byteIndex = borderedTransparencyLookupIndex >> 3
				var bitIndex	= borderedTransparencyLookupIndex & 0x7
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
var workVector = new THREE.Vector3()
var biomeBlockTypes = [
	BlockTypesByName.stone.id,
	BlockTypesByName.dirt.id,
	BlockTypesByName.sand.id,
	BlockTypesByName.gravel.id,
	BlockTypesByName.snow.id,
	BlockTypesByName.ice.id,
	BlockTypesByName.sandstone.id,
	BlockTypesByName.grass.id,
]
function terrainGen(pos, v_dist, v_closest) {

	var biomeSolidBlock = biomeBlockTypes[ Math.floor((v_closest + 0.5) * biomeBlockTypes.length) ]

	//return (pos.y < v_dist * 20) ? biomeSolidBlock : BlockTypesByName.air.id



	workVector.copy(pos)
	
	workVector = warp1.warp3(workVector)

	var sample1 = fbm1.sample2(workVector)
	sample1 += fbm2.sample3(workVector) * 0.5

	sample1 = Math.pow(sample1, 2)

	//var sample2 = fbm2.sample(workVector)
	//var sample3 = fbm3.sample(workVector)

	//var lerped = sample1 * (sample3) + sample2 * (1 - sample3)

	if (sample1 > pos.y / 25) {
		return biomeSolidBlock
	}

	return BlockTypesByName.air.id
}









