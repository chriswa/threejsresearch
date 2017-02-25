var ChunkMeshPool = new Pool(() => new ChunkMesh())


var ChunkVertexBufferPool = new Pool(() => new Float32Array( maxQuadsPerMesh * 8 * 4 ).buffer)


class ChunkMesh {
	constructor() {
		this.geometry = new THREE.BufferGeometry()
		this.vertexArray = undefined // new Float32Array(maxQuadsPerMesh * 8 * 4)
		this.interleavedBuffer = new THREE.InterleavedBuffer(undefined, 3 + 2 + 3)
		this.interleavedBuffer.count = maxQuadsPerMesh * 4 // fake it for now
		this.interleavedBuffer.setDynamic(true)
		this.geometry.addAttribute( 'position', new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 0 ) )
		this.geometry.addAttribute( 'uv',       new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 2, 3 ) )
		this.geometry.addAttribute( 'color',    new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 5 ) )
		this.geometry.setIndex( ChunkMesh.sharedQuadIndexBufferAttribute )
		var maxSize = Math.max(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
		this.geometry.boundingBox = new THREE.Box3(0, maxSize)
		this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(maxSize/2, maxSize/2, maxSize/2), maxSize * 1.73205080757) // sphere radius to cover cube
		if (!ChunkMesh.material) {
			ChunkMesh.material = new THREE.MeshBasicMaterial( { map: mainTexture, vertexColors: THREE.VertexColors, wireframe: false } )
		}
		this.mesh = new THREE.Mesh( this.geometry, ChunkMesh.material )
		this.quadsToPushToGpu = []
	}
}

class ChunkMeshManager {
	constructor(parentObject3d) {
		this.parentObject3d = parentObject3d
		this.chunkMeshes = []
		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.quadHoleList = []
		this.quadDirtyList = []
	}
	dispose() {
		_.each(this.chunkMeshes, chunkMesh => {
			this.parentObject3d.remove( chunkMesh.mesh )
			ChunkVertexBufferPool.release(chunkMesh.vertexArray.buffer)
			ChunkMeshPool.release(chunkMesh)
		})
	}
	prefill(quadCount, prefilledVertexBuffers) {
		this.quadCount = quadCount
		for (var i = 0; i < prefilledVertexBuffers.length; i += 1) {
			var chunkMesh = this.addChunkMesh(prefilledVertexBuffers[i])
			if (i < prefilledVertexBuffers.length - 1) {
				chunkMesh.quadsToPushToGpu = [0, maxQuadsPerMesh - 1]
			}
			else {
				chunkMesh.quadsToPushToGpu = [0, (this.quadCount - 1) % maxQuadsPerMesh]
			}
			chunkMesh.geometry.setDrawRange(0, 0)
		}
	}
	addChunkMesh(prefilledVertexBuffer) {
		var chunkMesh = ChunkMeshPool.acquire()
		if (prefilledVertexBuffer) {
			chunkMesh.vertexArray = new Float32Array( prefilledVertexBuffer ) // create a view on an existing buffer
		}
		else {
			chunkMesh.vertexArray = new Float32Array( ChunkVertexBufferPool.acquire() )
		}
		chunkMesh.geometry.setDrawRange(0, 0)
		chunkMesh.interleavedBuffer.array = chunkMesh.vertexArray
		this.chunkMeshes.push( chunkMesh )
		this.parentObject3d.add( chunkMesh.mesh )
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
		}
		chunkMesh.quadsToPushToGpu.push(quadId % maxQuadsPerMesh)

		QuadWriter.draw(chunkMesh.vertexArray, quadId % maxQuadsPerMesh, blockPos, side, uvs, brightnesses)

		return quadId
	}
	removeQuad(quadId) {
		this.quadDirtyList.push(quadId) // leave it in the vertexArray for now, in case another quad needs to be drawn this frame!
	}
	update(renderBudget) {
		this.cleanupRemovedQuads()
		return this.pushQuadsToGpu(renderBudget)
	}
	cleanupRemovedQuads() {
		_.each(this.quadDirtyList, quadId => {
			var chunkMesh = this.getChunkMeshForQuad(quadId)
			chunkMesh.quadsToPushToGpu.push(quadId % maxQuadsPerMesh)

			QuadWriter.clear(chunkMesh.vertexArray, quadId % maxQuadsPerMesh)

			this.quadHoleList.push(quadId)
		})
		this.quadDirtyList = []
	}
	pushQuadsToGpu(renderBudget) {
		_.each(this.chunkMeshes, chunkMesh => {

			if (renderBudget <= 0) { return }

			if (!chunkMesh.interleavedBuffer.__webglBuffer) {
				//console.log("no buffer to write to yet!")
				return
			}

			if (chunkMesh.quadsToPushToGpu.length) {
				var minQuadIndex = Infinity
				var maxQuadIndex = 0
				_.each(chunkMesh.quadsToPushToGpu, quadToPush => {
					minQuadIndex = Math.min(minQuadIndex, quadToPush)
					maxQuadIndex = Math.max(maxQuadIndex, quadToPush)
				})

				var quadPushCount = maxQuadIndex - minQuadIndex + 1
				if (quadPushCount <= renderBudget) {
					chunkMesh.quadsToPushToGpu = []
					renderBudget -= Math.min(quadPushCount, 200) // increase the budget cost of small updates, since 1x1000 bufferSubData calls probably costs way more than 1000x1

				}
				else {
					chunkMesh.quadsToPushToGpu = [minQuadIndex + renderBudget, maxQuadIndex]
					maxQuadIndex = minQuadIndex + renderBudget
					renderBudget = 0
				}

				if (chunkMesh.geometry.drawRange.start + chunkMesh.geometry.drawRange.count < (maxQuadIndex + 1) * indicesPerFace) {
					chunkMesh.geometry.setDrawRange(0, (maxQuadIndex + 1) * indicesPerFace)
				}


				gl.bindBuffer( gl.ARRAY_BUFFER, chunkMesh.interleavedBuffer.__webglBuffer )
				gl.bufferSubData( gl.ARRAY_BUFFER, minQuadIndex * 128, chunkMesh.vertexArray.subarray( minQuadIndex * 32, (maxQuadIndex + 1) * 32 ) ) // 128 = 8 elements per vertex * 4 verts per quad * 4 bytes per element?
			}

		})

		return renderBudget

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
