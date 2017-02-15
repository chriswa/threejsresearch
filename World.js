var World = {
	chunks: {},
	getChunkId(cx, cy, cz) {
		return cx + ',' + cy + ',' + cz
	},
	addChunk(blockData, cx, cy, cz) {
		var chunk = new Chunk(blockData, cx, cy, cz)
		chunk.mesh.position.x = cx * Chunk.sizeX
		chunk.mesh.position.y = cy * Chunk.sizeY
		chunk.mesh.position.z = cz * Chunk.sizeZ
		scene.add( chunk.mesh );

		this.chunks[ this.getChunkId(cx, cy, cz) ] = chunk

		for (var sideId = 0; sideId < 6; sideId += 1) {
			var side = SidesById[sideId]
			var neighbour = this.chunks[ this.getChunkId(cx + side.dx, cy + side.dy, cz + side.dz) ]
			if (neighbour) {
				chunk.addChunkNeighbour(side, neighbour)
				neighbour.addChunkNeighbour(side.opposite, chunk)
			}
		}
	},
	build() {
		for (var cx = -5; cx <= 5; cx += 1) {
			for (var cy = -5; cy <= 5; cy += 1) {
				for (var cz = -5; cz <= 5; cz += 1) {
					if (Math.sqrt(cx*cx + cy*cy + cz*cz) > 2.5) { continue }

					var blockData = new Uint16Array( Chunk.sizeX * Chunk.sizeY * Chunk.sizeZ )
					for (var x = 0, i = 0; x < Chunk.sizeX; x += 1) {
						for (var y = 0; y < Chunk.sizeY; y += 1) {
							for (var z = 0; z < Chunk.sizeZ; z += 1, i += 1) {
								var sampleY = y + cy * Chunk.sizeY
								//var isDirt = Math.random() * sampleY * sampleY * sampleY / 2 < 1
								var isDirt = 1
								if (sampleY >= 3) { isDirt = 0; }

								if (sampleY === 3) { isDirt = Math.random() < 0.25 ? 1 : 0; }
								blockData[i] = isDirt ? 1 : 0; // dirt, air
							}
						}
					}

					World.addChunk(blockData, cx, cy, cz)
				}
			}
		}
		_.each(World.chunks, chunk => chunk.drawAllQuads() )
	},
}
