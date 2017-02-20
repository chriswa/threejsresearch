var facesPerCube = 6;
var uniqVertsPerFace = 4;
var indicesPerFace = 6;
var maxVerts = 64 * 1024 // this should be 64k
var maxQuadsPerChunk = maxVerts / uniqVertsPerFace
var maxQuadsPerMesh = 1000

var ChunkBlockDataPool = {
	pool: [],
	get() {
		if (this.pool.length) {
			return this.pool.pop()
		}
		return new Uint16Array( Chunk.sizeX * Chunk.sizeY * Chunk.sizeZ )
	},
	release(blockData) {
		this.pool.push(blockData)
	},
}

var ChunkMeshPool = {
	pool: [],
	get() {
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
		this.bufferIsNew = true
		this.geometry = new THREE.BufferGeometry()
		this.interleavedData = new Float32Array(maxQuadsPerMesh * 8 * 4)
		this.interleavedBuffer = new THREE.InterleavedBuffer(this.interleavedData, 3 + 2 + 3)
		this.interleavedBuffer.setDynamic(true)
		this.geometry.addAttribute( 'position', new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 0 ) )
		this.geometry.addAttribute( 'uv',       new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 2, 3 ) )
		this.geometry.addAttribute( 'color',    new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 5 ) )
		this.geometry.setIndex( Chunk.sharedQuadIndexBufferAttribute )
		var maxSize = Math.max(Chunk.sizeX, Chunk.sizeY, Chunk.sizeZ)
		this.geometry.boundingBox = new THREE.Box3(0, maxSize)
		this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(maxSize/2, maxSize/2, maxSize/2), maxSize * 1.73205080757) // sphere radius to cover cube
		this.mesh = new THREE.Mesh( this.geometry, Chunk.material )
		this.updateRanges = []
	}
	reset() { // from pool
		this.mesh.visible = true
		this.bufferIsNew = false
		this.geometry.setDrawRange(0, 0)
	}
}

class Chunk {
	constructor(cx, cy, cz) {
		this.blockData = ChunkBlockDataPool.get()
		this.cx = cx
		this.cy = cy
		this.cz = cz
		this.id = [cx, cy, cz].join(',')

		if (!Chunk.material) {
			Chunk.material = new THREE.MeshBasicMaterial( { map: mainTexture, vertexColors: THREE.VertexColors, wireframe: false } )
		}

		this.quadIdsByBlockAndSide = new Uint16Array(Chunk.sizeX * Chunk.sizeY * Chunk.sizeZ * facesPerCube)

		this.neighboursBySideId = [ undefined, undefined, undefined, undefined, undefined, undefined ]
		this.chunkMeshes = []
	}
	dispose() {
		_.each(this.chunkMeshes, chunkMesh => {
			scene.remove(chunkMesh.mesh)			
			ChunkMeshPool.release(chunkMesh)
		})
		Sides.each(side => {
			if (this.neighboursBySideId[ side.id ]) {
				this.neighboursBySideId[ side.id ].neighboursBySideId[ side.opposite.id ] = undefined
			}
		})
		this.neighboursBySideId = undefined
	}
	addChunkMesh() {
		var chunkMesh = ChunkMeshPool.get()
		this.chunkMeshes.push( chunkMesh )
		chunkMesh.mesh.position.x = this.cx * Chunk.sizeX
		chunkMesh.mesh.position.y = this.cy * Chunk.sizeY
		chunkMesh.mesh.position.z = this.cz * Chunk.sizeZ
		scene.add( chunkMesh.mesh )
		return chunkMesh
	}
	eachPos(callback) {
		var blockPos = new BlockPos(this, 0, 0, 0)
		for (blockPos.x = 0; blockPos.x < Chunk.sizeX; blockPos.x += 1) {
			for (blockPos.y = 0; blockPos.y < Chunk.sizeY; blockPos.y += 1) {
				for (blockPos.z = 0; blockPos.z < Chunk.sizeZ; blockPos.z += 1, blockPos.i += 1) {
					callback(blockPos)
				}
			}
		}
	}
	attachChunkNeighbour(side, chunk) {
		this.neighboursBySideId[ side.id ] = chunk
	}
	getBlockPos(x, y, z) {
		return new BlockPos(this, x, y, z)
	}
	setBlockData(mainBlockPos, newBlockData) {
		var wasOpaque = mainBlockPos.isOpaque()
		this.blockData[ mainBlockPos.i ] = newBlockData
		var isOpaque = mainBlockPos.isOpaque()

		if (wasOpaque && isOpaque) {
			// hack to deal with block type changing without switching to air first
			this.setBlockData(mainBlockPos, 0)
			this.setBlockData(mainBlockPos, newBlockData)
			return
		}

		// note: remove quads first, then draw new quads, to take advantage of quadDirtyList
		if (!wasOpaque && isOpaque) {
			// block added
			//   for any neighbouring solid blocks, we want to remove their previously exposed face
			//   for any neighbouring air blocks, we want to draw this block's face
			Sides.each(side => {
				var adjacentPos = mainBlockPos.getAdjacentBlockPos(side)
				if (adjacentPos.isOpaque()) {
					adjacentPos.chunk.eraseFace(adjacentPos, side.opposite)
				}
			})
			Sides.each(side => {
				var adjacentPos = mainBlockPos.getAdjacentBlockPos(side)
				if (adjacentPos.isTransparent()) {
					this.drawFace(mainBlockPos, side)
				}
			})
		}
		else if (wasOpaque && !isOpaque) {
			// block removed
			//   for any neighbouring air blocks, we want to remove this block's faces
			//   for any neighbouring solid blocks, we want to draw their exposed face
			Sides.each(side => {
				var adjacentPos = mainBlockPos.getAdjacentBlockPos(side)
				if (adjacentPos.isTransparent()) {
					this.eraseFace(mainBlockPos, side)
				}
			})
			Sides.each(side => {
				var adjacentPos = mainBlockPos.getAdjacentBlockPos(side)
				if (adjacentPos.isOpaque()) {
					adjacentPos.chunk.drawFace(adjacentPos, side.opposite, 1)
				}
			})
		}

		// update ambient occlusion vertex coloutrs of neighbouring blocks
		for (var sideId = 0; sideId < 6; sideId += 1) {
			var mainBlockSide = SidesById[sideId]

			var adjacentBlockPos = mainBlockPos.getAdjacentBlockPos(mainBlockSide)
			if (!adjacentBlockPos.isLoaded) { continue }

			adjacentBlockPos.chunk.updateAO(adjacentBlockPos, mainBlockSide.opposite)

		}
	}
	updateAO(airBlockPos, solidSourceBlockSide) {
		for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
			var tangent = solidSourceBlockSide.tangents[tangentIndex]

			var edgeBlockPos = airBlockPos.getAdjacentBlockPos(tangent.side)
			if (!edgeBlockPos.isLoaded) { continue }

			if (edgeBlockPos.isOpaque()) {
				edgeBlockPos.chunk.redrawFace(edgeBlockPos, tangent.side.opposite) // potential optimization: if mainBlock is being added, we only need to make sure two vertices are darkened; not sure about optimizing mainBlock removal
			}
			else {

				for (var tangentTangentIndex = 0; tangentTangentIndex < 2; tangentTangentIndex += 1) {
					var tangentTangentSide = tangent.tangents[tangentTangentIndex]

					var cornerBlockPos = edgeBlockPos.getAdjacentBlockPos(tangentTangentSide)
					if (cornerBlockPos.isOpaque()) {
						cornerBlockPos.chunk.redrawFace(cornerBlockPos, tangentTangentSide.opposite)  // potential optimization: if mainBlock is being added, we only need to make sure two vertices are darkened; not sure about optimizing mainBlock removal
					}

				}
			}
		}
	}
	redraw() {

		this.quadCount = 1 // for development, skip the first quad, so we can know that a quadId of 0 is bad data
		this.quadHoleList = []
		this.quadDirtyList = []

		// queue the majority of the work to occur during update calls
		this.incrementalRedraw = { active: true, coords: [0, 0, 0]}

		// because we are not drawing quads facing the void, we must also add quads to neighbouring chunks which face our air blocks (also update nearby AO)
		Sides.each(side => {
			var neighbourChunk = this.neighboursBySideId[ side.id ]
			if (neighbourChunk) {
				var ourBlockPos       = new BlockPos(this, 0, 0, 0) // side.dx === 1 ? side.size-1 : 0, side.dy === 1 ? side.size-1 : 0, side.dz === 1 ? side.size-1 : 0
				var neighbourBlockPos = new BlockPos(neighbourChunk, 0, 0, 0)
				
				var ourCoordIndices
				var neighbourCoordIndices
				switch (side) {
					case Sides.TOP:    ourCoordIndices = [0, 3, 1]; neighbourCoordIndices = [0, 2, 1]; break
					case Sides.BOTTOM: ourCoordIndices = [0, 2, 1]; neighbourCoordIndices = [0, 3, 1]; break
					case Sides.NORTH:  ourCoordIndices = [0, 1, 3]; neighbourCoordIndices = [0, 1, 2]; break
					case Sides.SOUTH:  ourCoordIndices = [0, 1, 2]; neighbourCoordIndices = [0, 1, 3]; break
					case Sides.EAST:   ourCoordIndices = [3, 0, 1]; neighbourCoordIndices = [2, 0, 1]; break
					case Sides.WEST:   ourCoordIndices = [2, 0, 1]; neighbourCoordIndices = [3, 0, 1]; break
				}
				
				
				var coords = [undefined, undefined, 0, Chunk.sizeX-1]
				for (coords[0] = 0; coords[0] < Chunk.sizeX; coords[0] += 1) {       // XXX: assumes cubical chunks!
					for (coords[1] = 0; coords[1] < Chunk.sizeX; coords[1] += 1) {     // XXX: assumes cubical chunks!
						ourBlockPos.x = coords[ourCoordIndices[0]]
						ourBlockPos.y = coords[ourCoordIndices[1]]
						ourBlockPos.z = coords[ourCoordIndices[2]]
						ourBlockPos.recalculateIndex()
						neighbourBlockPos.x = coords[neighbourCoordIndices[0]]
						neighbourBlockPos.y = coords[neighbourCoordIndices[1]]
						neighbourBlockPos.z = coords[neighbourCoordIndices[2]]
						neighbourBlockPos.recalculateIndex()
						if (ourBlockPos.isTransparent()) {
							if (neighbourBlockPos.isOpaque()) {
								neighbourChunk.drawFace(neighbourBlockPos, side.opposite)
							}
						}
						else {
							// update AO?
							if (neighbourBlockPos.isTransparent()) {
								neighbourChunk.updateAO(neighbourBlockPos, side.opposite)
							}
						}
					}
				}
			}
		})

		//this.updateRanges = []
		//this.interleavedBuffer.updateRanges = { offset: 0, count: this.quadCount * 6 * 8 }
		//this.interleavedBuffer.needsUpdate = true
		//this.chunkMesh.geometry.setDrawRange(0, 6 * this.quadCount) // 6 vertex indices per quad (i.e. 2 triangles)
	}
	drawFace(blockPos, side) {

		// we want to draw the face. determine its uvs
		var uvs = blockPos.getBlockType().textureSides[side.id]

		var brightnesses = this.calculateVertexColours(blockPos, side)

		var quadId = this.addQuad(blockPos.x, blockPos.y, blockPos.z, side, uvs, brightnesses)
		//if (temp === 2) { console.log(`drawFace quadId = ${quadId}`) }
		this.quadIdsByBlockAndSide[blockPos.i * 6 + side.id] = quadId
	}
	eraseFace(blockPos, side) {
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId === 0) { debugger }
		//console.log(`eraseFace quadId = ${quadId}`)
		this.removeQuad(quadId)
		this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ] = undefined // necessary?
	}
	redrawFace(blockPos, side) {
		// todo: avoid buffer updates if the quad doesn't change (n.b. an existing quad may need to be flipped!)
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId) {
			this.eraseFace(blockPos, side)
			this.drawFace(blockPos, side)
		}
	}
	calculateVertexColours(blockPos, side) {
		// determine ambient occlusion
		var brightnesses = [1, 1, 1, 1]
		var occludedBrightness = 0.7

		var adjacentPos = blockPos.getAdjacentBlockPos(side)

		// check for occlusion at right angles to the block's normal
		for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
			var tangentSide = side.tangents[tangentIndex].side
			
			var tangentPos = adjacentPos.getAdjacentBlockPos(tangentSide)
			if (!tangentPos) { continue }

			if (tangentPos.isOpaque()) {
				brightnesses[tangentIndex] = occludedBrightness
				brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
				continue // optimization: no need to check diagonal(s)
			}

			// diagonal ambient occlusion
			
			var diagonalTangentSide = side.tangents[(tangentIndex + 1) % 4].side

			var tangentDiagonalPos = tangentPos.getAdjacentBlockPos(diagonalTangentSide)
			if (!tangentDiagonalPos) { continue }

			if (tangentDiagonalPos.isOpaque()) {
				brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
			}
		}
		return brightnesses
	}
	addQuad(x, y, z, side, uvs, brightnesses) {

		var flipQuad = false
		if (brightnesses[0] + brightnesses[2] < brightnesses[1] + brightnesses[3]) {
			flipQuad = true
		}
		var vertexOrder = flipQuad ? [ 1, 2, 3, 0 ] : [ 0, 1, 2, 3 ]

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
		var cursor = (quadId % maxQuadsPerMesh) * 8 * uniqVertsPerFace
		chunkMesh.updateRanges.push({ offset: cursor, count: 8 * uniqVertsPerFace })

		for (var i = 0; i < uniqVertsPerFace; i += 1) {
			var vertexIndex = vertexOrder[i]
			chunkMesh.interleavedData[ cursor++ ] = x + side.verts[ vertexIndex * 3 + 0 ]
			chunkMesh.interleavedData[ cursor++ ] = y + side.verts[ vertexIndex * 3 + 1 ]
			chunkMesh.interleavedData[ cursor++ ] = z + side.verts[ vertexIndex * 3 + 2 ]
			chunkMesh.interleavedData[ cursor++ ] = uvs[ vertexIndex * 2 + 0 ]
			chunkMesh.interleavedData[ cursor++ ] = uvs[ vertexIndex * 2 + 1 ]
			chunkMesh.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
			chunkMesh.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
			chunkMesh.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
		}
		return quadId
	}
	getChunkMeshForQuad(quadId) {
		return this.chunkMeshes[ Math.floor( quadId / maxQuadsPerMesh ) ]
	}
	removeQuad(quadId) {
		this.quadDirtyList.push(quadId) // leave it in the interleavedData for now, in case another quad needs to be drawn this frame!
	}
	update() {

		// upgrade dirty quads into holes
		_.each(this.quadDirtyList, quadId => {
			var chunkMesh = this.getChunkMeshForQuad(quadId)
			var cursor = (quadId % maxQuadsPerMesh) * 8 * uniqVertsPerFace
			chunkMesh.updateRanges.push({ offset: cursor, count: 8 * uniqVertsPerFace })
			for (var i = 0; i < uniqVertsPerFace; i += 1) {
				// only need to set the positions to 0, not UVs or colours
				chunkMesh.interleavedData[ cursor + 0 ] = 0
				chunkMesh.interleavedData[ cursor + 1 ] = 0
				chunkMesh.interleavedData[ cursor + 2 ] = 0
				cursor += 8
			}
			this.quadHoleList.push(quadId)
		})
		this.quadDirtyList = []

		// incremental redraw
		if (this.incrementalRedraw.active) {
			for (var incrementalCount = 0; incrementalCount < 1024; incrementalCount += 1) {

				var incCoords = this.incrementalRedraw.coords
				var blockPos = this.getBlockPos(incCoords[0], incCoords[1], incCoords[2])

				if (blockPos.isOpaque()) {

					Sides.each(side => {
						
						var adjacentPos = blockPos.getAdjacentBlockPos(side)
						if (adjacentPos.isTransparent()) {
							this.drawFace(blockPos, side)
						}
						
					})
				}

				incCoords[0] += 1
				if (incCoords[0] === Chunk.sizeX) {
					incCoords[0] -= Chunk.sizeX
					incCoords[1] += 1
					if (incCoords[1] === Chunk.sizeY) {
						incCoords[1] -= Chunk.sizeY
						incCoords[2] += 1
						if (incCoords[2] === Chunk.sizeZ) {
							this.incrementalRedraw.active = false

							//console.log(this.quadCount)

							break
						}
					}
				}

			}
		}



		_.each(this.chunkMeshes, chunkMesh => {

			if (!chunkMesh.interleavedBuffer.__webglBuffer) {
				//console.log("no buffer to write to yet!")
				return
			}

			var bufferUpdateRanges = []

			if (chunkMesh.updateRanges.length) {
				var minOffset = Infinity
				var maxOffset = 0
				_.each(chunkMesh.updateRanges, updateRange => {
					minOffset = Math.min(minOffset, updateRange.offset)
					maxOffset = Math.max(maxOffset, updateRange.offset + updateRange.count)
				})

				bufferUpdateRanges = [{ offset: minOffset, count: maxOffset - minOffset }]
				chunkMesh.updateRanges = []
			}

			if (bufferUpdateRanges.length > 0) {
				gl.bindBuffer( gl.ARRAY_BUFFER, chunkMesh.interleavedBuffer.__webglBuffer )
				_.each(bufferUpdateRanges, updateRange => {
					gl.bufferSubData( gl.ARRAY_BUFFER, updateRange.offset * 4, chunkMesh.interleavedData.subarray( updateRange.offset, updateRange.offset + updateRange.count ) )
				})
			}
		})

	}
	toString() {
		return `Chunk(${this.id})`
	}
}

Chunk.sizeX = 16
Chunk.sizeY = 16
Chunk.sizeZ = 16

var indexArray = new Uint32Array(maxQuadsPerChunk * indicesPerFace)
for (var quadIndex = 0, indexIndex = 0, vertIndex = 0; quadIndex < maxQuadsPerChunk; quadIndex += 1, indexIndex += 6, vertIndex += 4) {
	indexArray[indexIndex + 0] = vertIndex + 0
	indexArray[indexIndex + 1] = vertIndex + 1
	indexArray[indexIndex + 2] = vertIndex + 2
	indexArray[indexIndex + 3] = vertIndex + 0
	indexArray[indexIndex + 4] = vertIndex + 2
	indexArray[indexIndex + 5] = vertIndex + 3
}
Chunk.sharedQuadIndexBufferAttribute = new THREE.BufferAttribute( indexArray, 1 )




