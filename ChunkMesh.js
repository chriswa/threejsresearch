var facesPerCube = 6;
var uniqVertsPerFace = 4;
var indicesPerFace = 6;
var maxVerts = 64 * 1024 // this should be 64k
var maxQuadsPerChunk = maxVerts / uniqVertsPerFace
var maxQuadsPerMesh = 1000

var ChunkMeshPool = {
	pool: [],
	acquire() {
		var chunkMesh
		if (this.pool.length) {
			chunkMesh = this.pool.pop()
			chunkMesh.reset()
			return chunkMesh
		}
		return new ChunkMesh()
	},
	release(chunkMesh) {
		chunkMesh.mesh.visible = false
		this.pool.push(chunkMesh)
	},
}

class ChunkMesh {
	constructor() {
		this.geometry = new THREE.BufferGeometry()
		this.interleavedData = new Float32Array(maxQuadsPerMesh * 8 * 4)
		this.interleavedBuffer = new THREE.InterleavedBuffer(this.interleavedData, 3 + 2 + 3)
		this.interleavedBuffer.setDynamic(true)
		this.geometry.addAttribute( 'position', new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 0 ) )
		this.geometry.addAttribute( 'uv',       new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 2, 3 ) )
		this.geometry.addAttribute( 'color',    new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 5 ) )
		this.geometry.setIndex( ChunkMesh.sharedQuadIndexBufferAttribute )
		var maxSize = Math.max(Chunk.size, Chunk.size, Chunk.size)
		this.geometry.boundingBox = new THREE.Box3(0, maxSize)
		this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(maxSize/2, maxSize/2, maxSize/2), maxSize * 1.73205080757) // sphere radius to cover cube
		if (!ChunkMesh.material) {
			ChunkMesh.material = new THREE.MeshBasicMaterial( { map: mainTexture, vertexColors: THREE.VertexColors, wireframe: false } )
		}
		this.mesh = new THREE.Mesh( this.geometry, ChunkMesh.material )
		this.quadsToPushToGpu = []
	}
	reset() { // from pool
		this.mesh.visible = true
		this.geometry.setDrawRange(0, 0)
	}
}

class ChunkMeshManager {
	constructor(pos) {
		this.pos = pos
		this.chunkMeshes = []
		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.quadHoleList = []
		this.quadDirtyList = []
	}
	dispose() {
		_.each(this.chunkMeshes, chunkMesh => {
			scene.remove(chunkMesh.mesh)
			ChunkMeshPool.release(chunkMesh)
		})
	}
	addChunkMesh() {
		var chunkMesh = ChunkMeshPool.acquire()
		this.chunkMeshes.push( chunkMesh )
		chunkMesh.mesh.position.copy(this.pos)
		scene.add( chunkMesh.mesh )
		return chunkMesh
	}
	getChunkMeshForQuad(quadId) {
		return this.chunkMeshes[ Math.floor( quadId / maxQuadsPerMesh ) ]
	}
	addQuad(blockPos, side, uvs, brightnesses) {

		var quadId, chunkMesh
		// prefer to draw over dirty quads, which will need to be updated anyway
		if (this.quadDirtyList.length) {
			quadId = this.quadDirtyList.shift()
			chunkMesh = this.getChunkMeshForQuad(quadId)
		}
		// second preference is to fill up holes left by previously cleaned up quads, to avoid expanding our draw range and ultimately running out of space
		else if (this.quadHoleList.length) {
			quadId = this.quadHoleList.shift()
			chunkMesh = this.getChunkMeshForQuad(quadId)
		}
		// if there are no dirty quads or holes to fill, append quads to the end and increase the draw range
		else {
			quadId = this.quadCount
			chunkMesh = this.getChunkMeshForQuad(quadId)
			if (!chunkMesh) {
				chunkMesh = this.addChunkMesh()
			}
			this.quadCount += 1
			chunkMesh.geometry.setDrawRange(0, (((this.quadCount - 1) % maxQuadsPerMesh) + 1) * indicesPerFace)
		}
		chunkMesh.quadsToPushToGpu.push(quadId % maxQuadsPerMesh)

		QuadWriter.draw(chunkMesh.interleavedData, quadId % maxQuadsPerMesh, blockPos, side, uvs, brightnesses)

		return quadId
	}
	removeQuad(quadId) {
		this.quadDirtyList.push(quadId) // leave it in the interleavedData for now, in case another quad needs to be drawn this frame!
	}
	update() {
		this.cleanupRemovedQuads()
		this.pushQuadsToGpu()
	}
	cleanupRemovedQuads() {
		_.each(this.quadDirtyList, quadId => {
			var chunkMesh = this.getChunkMeshForQuad(quadId)
			chunkMesh.quadsToPushToGpu.push(quadId % maxQuadsPerMesh)

			QuadWriter.clear(chunkMesh.interleavedData, quadId % maxQuadsPerMesh)

			this.quadHoleList.push(quadId)
		})
		this.quadDirtyList = []
	}
	pushQuadsToGpu() {
		_.each(this.chunkMeshes, chunkMesh => {

			if (!chunkMesh.interleavedBuffer.__webglBuffer) {
				//console.log("no buffer to write to yet!")
				return
			}

			if (chunkMesh.quadsToPushToGpu.length) {
				var minQuadIndex = Infinity
				var maxQuadIndex = 0
				_.each(chunkMesh.quadsToPushToGpu, quadToPush => {
					minQuadIndex = Math.min(minQuadIndex, quadToPush)
					maxQuadIndex = Math.max(maxQuadIndex, quadToPush + 1)
				})
				chunkMesh.quadsToPushToGpu = []

				gl.bindBuffer( gl.ARRAY_BUFFER, chunkMesh.interleavedBuffer.__webglBuffer )
				gl.bufferSubData( gl.ARRAY_BUFFER, minQuadIndex * 128, chunkMesh.interleavedData.subarray( minQuadIndex * 32, maxQuadIndex * 32 ) ) // 128 = 8 elements per vertex * 4 verts per quad * 4 bytes per element?
			}

		})

	}

}

var indexArray = new Uint32Array(maxQuadsPerChunk * indicesPerFace)
for (var quadIndex = 0, indexIndex = 0, vertIndex = 0; quadIndex < maxQuadsPerChunk; quadIndex += 1, indexIndex += 6, vertIndex += 4) {
	indexArray[indexIndex + 0] = vertIndex + 0
	indexArray[indexIndex + 1] = vertIndex + 1
	indexArray[indexIndex + 2] = vertIndex + 2
	indexArray[indexIndex + 3] = vertIndex + 0
	indexArray[indexIndex + 4] = vertIndex + 2
	indexArray[indexIndex + 5] = vertIndex + 3
}
ChunkMesh.sharedQuadIndexBufferAttribute = new THREE.BufferAttribute( indexArray, 1 )
