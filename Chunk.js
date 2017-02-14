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
	getBlockData() {
		return this.chunk.blockData[this.i]
	}
	setBlockData(newBlockData) {
		this.chunk.setBlockData(this, newBlockData)
	}
	getAdjacentBlockPos(side) {
		var neighbourChunk = this.chunk.neighbours[side.id]
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
	getBlockData() {
		return undefined
	},
	getAdjacentBlockPos(side) {
		return BlockPos.badPos
	},
}


class Chunk {
	constructor(blockData, cx, cy, cz) {
		this.blockData = blockData
		this.cx = cx
		this.cy = cy
		this.cz = cz

		this.neighbours = [undefined, undefined, undefined, undefined, undefined, undefined]
		this.geometry = new THREE.BufferGeometry();
		this.interleavedData = new Float32Array(maxQuadsPerMesh * 8 * 4)
		this.interleavedBuffer = new THREE.InterleavedBuffer(this.interleavedData, 3 + 2 + 3);
		this.interleavedBuffer.setDynamic(true)
		this.geometry.addAttribute( 'position', new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 0 ) );
		this.geometry.addAttribute( 'uv',       new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 2, 3 ) );
		this.geometry.addAttribute( 'color',    new THREE.InterleavedBufferAttribute( this.interleavedBuffer, 3, 5 ) );
		this.geometry.setIndex( Chunk.sharedQuadIndexBufferAttribute );
		this.geometry.setDrawRange(0, 6 * this.quadCount)
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
		this.neighbours[ side.id ] = chunk
	}
	removeChunkNeighbour(side) {
		this.neighbours[ side.id ] = undefined
	}
	getBlockPos(x, y, z) {
		return new BlockPos(this, x, y, z)
	}
	setBlockData(blockPos, newBlockData) {
		var oldBlockData = this.blockData[ blockPos.i ]
		if (oldBlockData === 0 && newBlockData === 1) {
			// air to dirt


		}
		else if (oldBlockData === 1 && newBlockData === 0) {
			// dirt to air
		}

		// update blockData
		this.blockData[ blockPos.i ] = newBlockData

		// TODO: this is wrong!
		this.drawAllQuads()
		this.interleavedBuffer.updateRange = { offset: 0, count: this.quadCount * 6 * 8 }
		this.interleavedBuffer.needsUpdate = true
	}
	drawAllQuads() {

		this.quadCount = 0
		this.quadHoles = []
		this.eachPos(blockPos => {
			if (blockPos.getBlockData() !== 0) { return }

			for (var sideId = 0; sideId < 6; sideId += 1) {
				var side = SidesById[sideId]

				var adjacentPos = blockPos.getAdjacentBlockPos(side)
				var adjacentBlockData = adjacentPos.getBlockData()
				if (adjacentBlockData !== 1) { continue }

				// we want to draw the face. determine its uvs
				var tu = 1, tv = 15 // dirt

				// determine ambient occlusion
				var brightnesses = [1, 1, 1, 1]
				var occludedBrightness = 0.6

				// check for occlusion at right angles to the block's normal
				for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
					var tangentSide = side.mirror.tangents[tangentIndex]    // XXX: why do i have to mirror tangents?!
					
					var tangentPos = blockPos.getAdjacentBlockPos(tangentSide)
					if (!tangentPos) { continue }
					var tangentBlockData = tangentPos.getBlockData()

					if (tangentBlockData === 1) {
						brightnesses[tangentIndex] = occludedBrightness
						brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
						continue // optimization: no need to check diagonal(s)
					}

					// diagonal
					
					var diagonalTangentSide = side.mirror.tangents[(tangentIndex + 1) % 4]

					var tangentDiagonalPos = tangentPos.getAdjacentBlockPos(diagonalTangentSide)
					if (!tangentDiagonalPos) { continue }
					var tangentDiagonalBlockData = tangentDiagonalPos.getBlockData()

					if (tangentDiagonalBlockData === 1) {
						brightnesses[(tangentIndex + 1) % 4] = occludedBrightness
					}
				}

				this.appendFace(blockPos.x + side.dx, blockPos.y + side.dy, blockPos.z + side.dz, side.mirror, tu, tv, brightnesses)
			}
		})
		this.geometry.setDrawRange(0, 6 * this.quadCount) // 6 vertex indices per quad (i.e. 2 triangles)
	}
	appendFace(x, y, z, side, tu, tv, brightnesses) {

		var flipQuad = false
		if (brightnesses[0] + brightnesses[2] < brightnesses[1] + brightnesses[3]) {
			flipQuad = true
		}
		var vertexOrder = flipQuad ? [ 1, 2, 3, 0 ] : [ 0, 1, 2, 3 ]

		var cursor = this.quadCount * 8 * 4
		var u0 = tu/16
		var u1 = (tu+1)/16
		var v0 = tv/16
		var v1 = (tv+1)/16
		var uvList = [ u0, v0, u1, v0, u1, v1, u0, v1 ]
		for (var i = 0; i < 4; i += 1) {
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
		this.quadCount += 1
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
