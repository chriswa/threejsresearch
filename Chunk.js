var facesPerCube = 6;
var uniqVertsPerFace = 4;
var indicesPerFace = 6;
var maxVerts = 64 * 1024 // this should be 64k
var maxQuadsPerMesh = maxVerts / uniqVertsPerFace

class BlockPos {
	constructor(chunk, x, y, z) {
		this.chunk = chunk
		this.x = x
		this.y = y
		this.z = z
		this.i = z + y * Chunk.sizeZ + x * Chunk.sizeZ * Chunk.sizeY
	}
    isLoaded() {
        return true
    }
	getBlockData() {
		return this.chunk.blockData[this.i]
	}
	setBlockData(newBlockData) {
		this.chunk.setBlockData(this, newBlockData)
	}
	getAdjacentBlockPos(side) {
		var neighbourChunk = this.chunk.neighboursBySideId[side.id]
		if (side === Sides.TOP) {
			if (this.y === Chunk.sizeY - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, 0, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.BOTTOM) {
			if (this.y === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, Chunk.sizeY - 1, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.NORTH) {
			if (this.z === Chunk.sizeZ - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, this.y, 0 ) : BlockPos.badPos
			}
		}
		else if (side === Sides.SOUTH) {
			if (this.z === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, this.y, Chunk.sizeZ - 1 ) : BlockPos.badPos
			}
		}
		else if (side === Sides.EAST) {
			if (this.x === Chunk.sizeX - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, 0, this.y, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.WEST) {
			if (this.x === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, Chunk.sizeX - 1, this.y, this.z ) : BlockPos.badPos
			}
		}
		return new BlockPos(this.chunk, this.x + side.dx, this.y + side.dy, this.z + side.dz)
	}
}
BlockPos.badPos = {
    isLoaded() { return false },
	getBlockData() { return undefined },
	setBlockData(newBlockData) { throw new Error("setBlockData on badPos") },
	getAdjacentBlockPos(side) { return BlockPos.badPos },
}


class Chunk {
	constructor(blockData, cx, cy, cz) {
		this.blockData = blockData
		this.cx = cx
		this.cy = cy
		this.cz = cz
		this.id = [cx, cy, cz].join(',')

		this.quadIdsByBlockAndSide = new Uint16Array(Chunk.sizeX * Chunk.sizeY * Chunk.sizeZ * facesPerCube)

		this.neighboursBySideId = [ undefined, undefined, undefined, undefined, undefined, undefined ]
		this.geometry = new THREE.BufferGeometry();
		this.interleavedData = new Float32Array(maxQuadsPerMesh * 8 * 4)
		this.interleavedBuffer = new THREE.InterleavedBuffer(this.interleavedData, 3 + 2 + 3);
		this.interleavedBuffer.setDynamic(true)
		this.geometry.addAttribute( 'position', new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 0 ) );
		this.geometry.addAttribute( 'uv',       new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 2, 3 ) );
		this.geometry.addAttribute( 'color',    new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 5 ) );
		this.geometry.setIndex( Chunk.sharedQuadIndexBufferAttribute );
		this.material = new THREE.MeshBasicMaterial( { map: mainTexture, vertexColors: THREE.VertexColors } );
		this.mesh     = new THREE.Mesh( this.geometry, this.material );
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
	addChunkNeighbour(side, chunk) {
		this.neighboursBySideId[ side.id ] = chunk
	}
	removeChunkNeighbour(side) {
		this.neighboursBySideId[ side.id ] = undefined
	}
	getBlockPos(x, y, z) {
		return new BlockPos(this, x, y, z)
	}
	setBlockData(blockPos, newBlockData) {
		var oldBlockData = this.blockData[ blockPos.i ]
		this.blockData[ blockPos.i ] = newBlockData

		// note: remove quads first, then draw new quads, to take advantage of quadDirtyList
		if (oldBlockData !== 1 && newBlockData === 1) {
			// block added
			//   for any neighbouring solid blocks, we want to remove their previously exposed face
			//   for any neighbouring air blocks, we want to draw this block's face
			//   also update ambient occlusion?
			Sides.each(side => {
				var adjacentPos = blockPos.getAdjacentBlockPos(side)
				if (adjacentPos.getBlockData() === 1) {
					adjacentPos.chunk.eraseFace(adjacentPos, side.opposite)
				}
			})
			Sides.each(side => {
				var adjacentPos = blockPos.getAdjacentBlockPos(side)
				if (adjacentPos.getBlockData() !== 1) {
					this.drawFace(blockPos, side, 1)
				}
			})


		}
		else if (oldBlockData === 1 && newBlockData !== 1) {
			// block removed
			//   for any neighbouring air blocks, we want to remove this block's faces
			//   for any neighbouring solid blocks, we want to draw their exposed face
			//   also update ambient occlusion?
			Sides.each(side => {
				var adjacentPos = blockPos.getAdjacentBlockPos(side)
				if (adjacentPos.getBlockData() !== 1) {
					this.eraseFace(blockPos, side)
				}
			})
			Sides.each(side => {
				var adjacentPos = blockPos.getAdjacentBlockPos(side)
				if (adjacentPos.getBlockData() === 1) {
					adjacentPos.chunk.drawFace(adjacentPos, side.opposite, 1)
				}
			})
		}
	}
	drawAllQuads() {

		this.quadCount = 1
		this.quadHoleList = []
		this.quadDirtyList = []
		this.interleavedUpdates = { push: () => {} } // ignore individual quad updates, since we will be writing the entire buffer
		this.eachPos(blockPos => {

			if (blockPos.getBlockData() === 1) {

				Sides.each(side => {
					
					var adjacentPos = blockPos.getAdjacentBlockPos(side)
					var adjacentBlockData = adjacentPos.getBlockData()
					if (adjacentBlockData !== 1) {
						this.drawFace(blockPos, side, 1)
					}
					
				})
			}
		})
		this.interleavedUpdates = []
		//this.interleavedBuffer.updateRange = { offset: 0, count: this.quadCount * 6 * 8 }
		//this.interleavedBuffer.needsUpdate = true
		this.geometry.setDrawRange(0, 6 * this.quadCount) // 6 vertex indices per quad (i.e. 2 triangles)
	}
	drawFace(blockPos, side, temp) {

		// we want to draw the face. determine its uvs
		var tu = temp, tv = 15 // dirt

		// determine ambient occlusion
		var brightnesses = [1, 1, 1, 1]
		var occludedBrightness = 0.6

		var adjacentPos = blockPos.getAdjacentBlockPos(side)

		// check for occlusion at right angles to the block's normal
		for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
			var tangentSide = side.tangents[tangentIndex]
			
			var tangentPos = adjacentPos.getAdjacentBlockPos(tangentSide)
			if (!tangentPos) { continue }
			var tangentBlockData = tangentPos.getBlockData()

			if (tangentBlockData === 1) {
				brightnesses[tangentIndex] = occludedBrightness
				brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
				continue // optimization: no need to check diagonal(s)
			}

			// diagonal ambient occlusion
			
			var diagonalTangentSide = side.tangents[(tangentIndex + 1) % 4]

			var tangentDiagonalPos = tangentPos.getAdjacentBlockPos(diagonalTangentSide)
			if (!tangentDiagonalPos) { continue }
			var tangentDiagonalBlockData = tangentDiagonalPos.getBlockData()

			if (tangentDiagonalBlockData === 1) {
				brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
			}
		}

		var quadId = this.addQuad(blockPos.x, blockPos.y, blockPos.z, side, tu, tv, brightnesses)
		//if (temp === 2) { console.log(`drawFace quadId = ${quadId}`) }
		this.quadIdsByBlockAndSide[blockPos.i * 6 + side.id] = quadId
		
		World.markChunkAsDirty(this)
	}
	eraseFace(blockPos, side) {
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId === 0) { debugger; }
		//console.log(`eraseFace quadId = ${quadId}`)
		this.removeQuad(quadId)
		this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ] = undefined // necessary?
		
		World.markChunkAsDirty(this)
	}
	addQuad(x, y, z, side, tu, tv, brightnesses, temp) {

		var flipQuad = false
		if (brightnesses[0] + brightnesses[2] < brightnesses[1] + brightnesses[3]) {
			flipQuad = true
		}
		var vertexOrder = flipQuad ? [ 1, 2, 3, 0 ] : [ 0, 1, 2, 3 ]

		var quadId
		// prefer to draw over dirty quads, which will need to be updated anyway
		if (this.quadDirtyList.length) {
			quadId = this.quadDirtyList.shift()
		}
		// second preference is to fill up holes left by previously cleaned up quads, to avoid expanding our draw range and ultimately running out of space
		else if (this.quadHoleList.length) {
			quadId = this.quadHoleList.shift()
		}
		// if there are no dirty quads or holes to fill, append quads to the end and increase the draw range
		else {
			quadId = this.quadCount
			this.quadCount += 1
			this.geometry.setDrawRange(0, this.quadCount * indicesPerFace)
		}
		var cursor = quadId * 8 * uniqVertsPerFace
		this.interleavedUpdates.push({ offset: cursor, count: 8 * uniqVertsPerFace })

		var u0 = tu/16
		var u1 = (tu+1)/16
		var v0 = tv/16
		var v1 = (tv+1)/16
		var uvList = [ u0, v0, u1, v0, u1, v1, u0, v1 ]
		for (var i = 0; i < uniqVertsPerFace; i += 1) {
			var vertexIndex = vertexOrder[i]
			this.interleavedData[ cursor++ ] = x + side.verts[ vertexIndex * 3 + 0 ]
			this.interleavedData[ cursor++ ] = y + side.verts[ vertexIndex * 3 + 1 ]
			this.interleavedData[ cursor++ ] = z + side.verts[ vertexIndex * 3 + 2 ]
			this.interleavedData[ cursor++ ] = uvList[ vertexIndex * 2 + 0 ]
			this.interleavedData[ cursor++ ] = uvList[ vertexIndex * 2 + 1 ]
			this.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
			this.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
			this.interleavedData[ cursor++ ] = brightnesses[vertexIndex]
		}
		return quadId
	}
	removeQuad(quadId) {
		this.quadDirtyList.push(quadId) // leave it in the interleavedData for now, in case another quad needs to be drawn this frame!
	}
	cleanup() {
		_.each(this.quadDirtyList, quadId => {
			var cursor = quadId * 8 * uniqVertsPerFace
			this.interleavedUpdates.push({ offset: cursor, count: 8 * uniqVertsPerFace })
			for (var i = 0; i < uniqVertsPerFace; i += 1) {
				for (var j = 0; j < 8; j += 1) {
					this.interleavedData[ cursor++ ] = 0 // OPTIMIZE: probably only need to set the positions to 0, not UVs or colours
				}
			}
			this.quadHoleList.push(quadId)
		})
		this.quadDirtyList = []
		//console.log(`this.interleavedUpdates = ${JSON.stringify(this.interleavedUpdates)}`)

		//this.interleavedBuffer.updateRange = this.interleavedUpdates // { offset: 0, count: this.quadCount * 6 * 8 }
		this.interleavedBuffer.updateRange = [{ offset: 0, count: this.quadCount * 6 * 8 }]
		this.interleavedBuffer.needsUpdate = true
		this.interleavedUpdates = []

	}
}

Chunk.sizeX = 16
Chunk.sizeY = 16
Chunk.sizeZ = 16

var indexArray = new Uint32Array(maxQuadsPerMesh * indicesPerFace)
for (var quadIndex = 0, indexIndex = 0, vertIndex = 0; quadIndex < maxQuadsPerMesh; quadIndex += 1, indexIndex += 6, vertIndex += 4) {
	indexArray[indexIndex + 0] = vertIndex + 0
	indexArray[indexIndex + 1] = vertIndex + 1
	indexArray[indexIndex + 2] = vertIndex + 2
	indexArray[indexIndex + 3] = vertIndex + 0
	indexArray[indexIndex + 4] = vertIndex + 2
	indexArray[indexIndex + 5] = vertIndex + 3
}
Chunk.sharedQuadIndexBufferAttribute = new THREE.BufferAttribute( indexArray, 1 )




