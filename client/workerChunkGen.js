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

	if (request.cancel) { console.log("WORKER IS IGNORING CANCEL MESSAGE") ; return } // TODO

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

	response.jobId = request.jobId
	response.success = true

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
	var sampleVector = new THREE.Vector3()
	var chunkBlockIndex = 0
	var borderedTransparencyLookupIndex = 0
	for (var x = -1; x < CHUNK_SIZE + 1; x += 1) {
		var isBorderX = x < 0 || x === CHUNK_SIZE
		for (var y = -1; y < CHUNK_SIZE + 1; y += 1) {
			var isBorderY = y < 0 || y === CHUNK_SIZE
			for (var z = -1; z < CHUNK_SIZE + 1; z += 1) {
				var isBorderZ = z < 0 || z === CHUNK_SIZE
				
				sampleVector.x = x + chunkPos.x * CHUNK_SIZE
				sampleVector.y = y + chunkPos.y * CHUNK_SIZE
				sampleVector.z = z + chunkPos.z * CHUNK_SIZE

				var blockData = BlockTypesByName.air.id

				if (sampleVector.y < -10) {
					blockData = BlockTypesByName.obsidian.id
				}
				else if (sampleVector.y < 50) {
					blockData = terrainGen(sampleVector)
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




var fbm_counter = 0
class Noise3d {
	constructor(scale, offset) {
		this.scale       = scale
		this.workVector  = new THREE.Vector3()
		this.offset      = new THREE.Vector3()
		if (offset) {
			this.offset.copy(offset)
		}
		else {
			this.randomizeOffset()
		}
		this.setFractal(1, 0.5, 2)
	}
	randomizeOffset() {
		fbm_counter += 123.45
		this.offset.x = noise.simplex3( fbm_counter, 0, 0 ) * 1000
		this.offset.y = noise.simplex3( 0, fbm_counter, 0 ) * 1000
		this.offset.z = noise.simplex3( 0, 0, fbm_counter ) * 1000
		return this
	}
	setFractal(octaves, persistance, lacunarity) {
		this.octaves = octaves
		this.persistance = persistance
		this.lacunarity = lacunarity
		return this
	}
	clone() {
		var obj = new Noise3d(this.scale, this.offset)
		obj.setFractal(this.octaves, this.persistance, this.lacunarity)
		return obj
	}
	sample3(sampleVector) {
		var amplitude = 1
		var frequency = 1
		var sum = 0
		var work = this.workVector
		work.copy(sampleVector).add(this.offset).divideScalar(this.scale)
		for (var i = 0; i < this.octaves; i += 1) {
			work.multiplyScalar(frequency)
			sum += amplitude * noise.simplex3( work.x, work.y, work.z )
			amplitude *= this.persistance
			frequency *= this.lacunarity
		}
		return sum
	}
	sample2(sampleVector) {
		var amplitude = 1
		var frequency = 1
		var sum = 0
		var work = this.workVector
		work.copy(sampleVector).add(this.offset).divideScalar(this.scale)
		for (var i = 0; i < this.octaves; i += 1) {
			work.multiplyScalar(frequency)
			sum += amplitude * noise.simplex2( work.x, work.z )
			amplitude *= this.persistance
			frequency *= this.lacunarity
		}
		return sum
	}
}

class NoiseWarp3d {
	constructor(scale, noiseSource) {
		this.scale = scale
		this.noise_x = noiseSource.clone().randomizeOffset()
		this.noise_y = noiseSource.clone().randomizeOffset()
		this.noise_z = noiseSource.clone().randomizeOffset()
		this.workVector = new THREE.Vector3()
	}
	warp3(pos) {
		this.workVector.x = pos.x + this.scale * this.noise_x.sample3(pos)
		this.workVector.y = pos.y + this.scale * this.noise_y.sample3(pos)
		this.workVector.z = pos.z + this.scale * this.noise_z.sample3(pos)
		pos.copy(this.workVector)
		return pos
	}
	warp2(pos) {
		this.workVector.x = pos.x + this.scale * this.noise_x.sample2(pos)
		this.workVector.y = pos.y + this.scale * this.noise_y.sample2(pos)
		this.workVector.z = pos.z + this.scale * this.noise_z.sample2(pos)
		pos.copy(this.workVector)
		return pos
	}
}

var fbm1 = new Noise3d(250).setFractal(2, 0.5, 1.1)
var fbm2 = new Noise3d(80)
var fbm3 = new Noise3d(250)
var warp1 = new NoiseWarp3d(1, fbm1)


function terrainGen(pos) {
	
	pos = warp1.warp3(pos)

	var sample1 = fbm1.sample2(pos)
	sample1 += fbm2.sample3(pos) * 0.5

	sample1 = Math.pow(sample1, 2)

	//var sample2 = fbm2.sample(pos)
	//var sample3 = fbm3.sample(pos)

	//var lerped = sample1 * (sample3) + sample2 * (1 - sample3)

	if (sample1 > pos.y / 25) {
		return BlockTypesByName.stone.id
	}

	return BlockTypesByName.air.id
}









