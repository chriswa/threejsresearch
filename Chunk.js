var facesPerCube = 6;
var uniqVertsPerFace = 4;
var indicesPerFace = 6;
var maxVerts = 64 * 1024 // this should be 64k
var maxQuadsPerMesh = maxVerts / uniqVertsPerFace

class Chunk {
	constructor(blockData, cx, cy, cz) {
		this.blockData = blockData
		this.cx = cx
		this.cy = cy
		this.cz = cz
		this.id = [cx, cy, cz].join(',')

		if (!Chunk.material) {
			Chunk.material = new THREE.MeshBasicMaterial( { map: mainTexture, vertexColors: THREE.VertexColors, wireframe: false } )
		}

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
		this.mesh = new THREE.Mesh( this.geometry, Chunk.material );
		this.mesh.chunk = this
	}
	dispose() {
		this.geometry.dispose()
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

			for (var tangentIndex = 0; tangentIndex < 4; tangentIndex += 1) {
				var tangent = mainBlockSide.tangents[tangentIndex]

				var edgeBlockPos = adjacentBlockPos.getAdjacentBlockPos(tangent.side)
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
	}
	drawAllQuads() {

		this.quadCount = 1
		this.quadHoleList = []
		this.quadDirtyList = []
		this.interleavedUpdates = { push: () => {} } // ignore individual quad updates, since we will be writing the entire buffer
		this.eachPos(blockPos => {

			if (blockPos.isOpaque()) {

				Sides.each(side => {
					
					var adjacentPos = blockPos.getAdjacentBlockPos(side)
					if (adjacentPos.isTransparent()) {
						this.drawFace(blockPos, side)
					}
					
				})
			}
		})
		this.interleavedUpdates = []
		//this.interleavedBuffer.updateRange = { offset: 0, count: this.quadCount * 6 * 8 }
		//this.interleavedBuffer.needsUpdate = true
		this.geometry.setDrawRange(0, 6 * this.quadCount) // 6 vertex indices per quad (i.e. 2 triangles)
	}
	drawFace(blockPos, side) {

		// we want to draw the face. determine its uvs
		var uvs = blockPos.getBlockType().textureSides[side.id]

		var brightnesses = this.calculateVertexColours(blockPos, side)

		var quadId = this.addQuad(blockPos.x, blockPos.y, blockPos.z, side, uvs, brightnesses)
		//if (temp === 2) { console.log(`drawFace quadId = ${quadId}`) }
		this.quadIdsByBlockAndSide[blockPos.i * 6 + side.id] = quadId
		
		World.markChunkAsDirty(this)
	}
	eraseFace(blockPos, side) {
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId === 0) { debugger }
		//console.log(`eraseFace quadId = ${quadId}`)
		this.removeQuad(quadId)
		this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ] = undefined // necessary?
		
		World.markChunkAsDirty(this)
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
		var occludedBrightness = 0.6

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

		for (var i = 0; i < uniqVertsPerFace; i += 1) {
			var vertexIndex = vertexOrder[i]
			this.interleavedData[ cursor++ ] = x + side.verts[ vertexIndex * 3 + 0 ]
			this.interleavedData[ cursor++ ] = y + side.verts[ vertexIndex * 3 + 1 ]
			this.interleavedData[ cursor++ ] = z + side.verts[ vertexIndex * 3 + 2 ]
			this.interleavedData[ cursor++ ] = uvs[ vertexIndex * 2 + 0 ]
			this.interleavedData[ cursor++ ] = uvs[ vertexIndex * 2 + 1 ]
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
	toString() {
		return `Chunk(${this.id})`
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




