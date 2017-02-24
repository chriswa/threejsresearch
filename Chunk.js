class ChunkOutline {
	constructor(parentObject3d) {
		var chunkOutlineVerts = [ 0,0,0,  0,0,1,  0,1,1,  1,1,1,  1,1,0,  0,1,0,  0,0,0,  1,0,0,  1,0,1,  0,0,1,  0,1,1,  0,1,0,  1,1,0,  1,0,0,  1,0,1,  1,1,1 ]
		for (var i = 0; i < chunkOutlineVerts.length; i += 1) {
			chunkOutlineVerts[i] *= Chunk.size
		}
		var chunkOutlineGeometry = new THREE.BufferGeometry()
		chunkOutlineGeometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array(chunkOutlineVerts), 3 ) )
		var chunkOutlineMaterial = new THREE.LineBasicMaterial( { color: 0x00ffff, linewidth: 1, transparent: true } )
		this.object = new THREE.Line( chunkOutlineGeometry, chunkOutlineMaterial )
		parentObject3d.add(this.object)
	}
}



var ChunkBlockDataPool = {
	pool: [],
	acquire() {
		if (this.pool.length) {
			return this.pool.pop()
		}
		return new Uint16Array( Chunk.sizeCubed )
	},
	release(obj) {
		this.pool.push(obj)
	},
}

var QuadIdsByBlockAndSidePool = {
	pool: [],
	acquire() {
		if (this.pool.length) {
			return this.pool.pop()
		}
		return new Uint16Array( Chunk.sizeCubed * facesPerCube )
	},
	release(obj) {
		obj.fill(0) // reset to 0 for next user
		this.pool.push(obj)
	},
}

class Chunk {
	constructor(chunkPos, blockData) {
		this.blockData = blockData
		this.id = World.getChunkId(chunkPos)
		this.chunkPos = chunkPos
		this.object3d = new THREE.Object3D()
		this.object3d.position.copy(this.chunkPos).multiplyScalar(Chunk.size)
		scene.add(this.object3d)

		this.quadIdsByBlockAndSide = QuadIdsByBlockAndSidePool.acquire()

		this.neighboursBySideId = [ undefined, undefined, undefined, undefined, undefined, undefined ]

		this.chunkMeshManager = new ChunkMeshManager(this.object3d)


		// queue the majority of the work to occur during update calls
		this.incrementalRedraw = { active: true, coords: [0, 0, 0]}

		// chunk outline
		this.chunkOutline = new ChunkOutline(this.object3d)

	}
	dispose() {
		scene.remove(this.object3d)
		this.chunkMeshManager.dispose()
		QuadIdsByBlockAndSidePool.release(this.quadIdsByBlockAndSide)
		// break references between neighbouring chunks so they can be garbage collected
		Sides.each(side => {
			if (this.neighboursBySideId[ side.id ]) {
				this.neighboursBySideId[ side.id ].neighboursBySideId[ side.opposite.id ] = undefined
			}
		})
		this.neighboursBySideId = undefined
	}
	toString() {
		return `Chunk(${this.id})`
	}
	attachChunkNeighbour(side, chunk) {
		this.neighboursBySideId[ side.id ] = chunk
	}
	update() {
		// incremental redraw
		if (this.incrementalRedraw.active) {
			this.redrawIncrementally()
		}

		this.chunkMeshManager.update()
	}






	drawFace(blockPos, side) {
		var uvs = blockPos.getBlockType().textureSides[side.id]
		var brightnesses = this.calculateVertexColours(blockPos, side)
		var quadId = this.chunkMeshManager.addQuad(blockPos, side, uvs, brightnesses)
		this.quadIdsByBlockAndSide[blockPos.i * 6 + side.id] = quadId
	}
	eraseFace(blockPos, side) {
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId === 0) { debugger }
		this.chunkMeshManager.removeQuad(quadId)
		this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ] = undefined
	}
	redrawFaceAO(blockPos, side) {
		// todo: avoid buffer updates if the quad doesn't change (n.b. an existing quad may need to be flipped!)
		var quadId = this.quadIdsByBlockAndSide[ blockPos.i * 6 + side.id ]
		if (quadId) {
			this.eraseFace(blockPos, side)
			this.drawFace(blockPos, side)
		}
	}





	updateBlockData(mainBlockPos, newBlockData) {
		var wasOpaque = mainBlockPos.isOpaque()
		this.blockData[ mainBlockPos.i ] = newBlockData
		var isOpaque = mainBlockPos.isOpaque()

		if (wasOpaque && isOpaque) {
			// hack to deal with block type changing without switching to air first
			this.updateBlockData(mainBlockPos, 0)
			this.updateBlockData(mainBlockPos, newBlockData)
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
				edgeBlockPos.chunk.redrawFaceAO(edgeBlockPos, tangent.side.opposite) // potential optimization: if mainBlock is being added, we only need to make sure two vertices are darkened; not sure about optimizing mainBlock removal
			}
			else {

				for (var tangentTangentIndex = 0; tangentTangentIndex < 2; tangentTangentIndex += 1) {
					var tangentTangentSide = tangent.tangents[tangentTangentIndex]

					var cornerBlockPos = edgeBlockPos.getAdjacentBlockPos(tangentTangentSide)
					if (!cornerBlockPos.isLoaded) { continue }

					if (cornerBlockPos.isOpaque()) {
						cornerBlockPos.chunk.redrawFaceAO(cornerBlockPos, tangentTangentSide.opposite)
					}

				}
			}
		}
	}
	stitchQuadsForNeighbouringChunks() {

		// because we are not drawing quads facing the void, we must also add quads to neighbouring chunks which face our air blocks (also update nearby AO)
		Sides.each(side => {
			var neighbourChunk = this.neighboursBySideId[ side.id ]
			if (neighbourChunk) {
				var ourBlockPos       = new BlockPos(this, 0, 0, 0)
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
				
				
				var coords = [undefined, undefined, 0, Chunk.size-1]
				for (coords[0] = 0; coords[0] < Chunk.size; coords[0] += 1) {       // XXX: assumes cubical chunks!
					for (coords[1] = 0; coords[1] < Chunk.size; coords[1] += 1) {     // XXX: assumes cubical chunks!
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

	redrawIncrementally() {
		for (var incrementalCount = 0; incrementalCount < 64; incrementalCount += 1) {

			var incCoords = this.incrementalRedraw.coords
			var blockPos = new BlockPos(this, incCoords[0], incCoords[1], incCoords[2])

			if (blockPos.isOpaque()) {

				Sides.each(side => {
					
					var adjacentPos = blockPos.getAdjacentBlockPos(side)
					if (adjacentPos.isTransparent()) {
						this.drawFace(blockPos, side)
					}
					
				})
			}

			incCoords[0] += 1
			if (incCoords[0] === Chunk.size) {
				incCoords[0] -= Chunk.size
				incCoords[1] += 1
				if (incCoords[1] === Chunk.size) {
					incCoords[1] -= Chunk.size
					incCoords[2] += 1
					if (incCoords[2] === Chunk.size) {
						this.incrementalRedraw.active = false

						this.stitchQuadsForNeighbouringChunks()

						//console.log(this.quadCount)

						break
					}
				}
			}

		}
	}
}

Chunk.size = 16
Chunk.sizeCubed = Chunk.size * Chunk.size * Chunk.size





