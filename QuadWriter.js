var QuadWriter = {
	vertexSize: 8,
	quadSize: 8 * 4,
	draw(buffer, quadBufferIndex, blockPos, side, uvs, brightnesses) {
		var vertexOrder = this.getVertexOrderAfterQuadFlipping(brightnesses)
		var cursor = quadBufferIndex * this.quadSize
		for (var i = 0; i < 4; i += 1) {
			var vertexIndex = vertexOrder[i]
			buffer[ cursor++ ] = blockPos.x + side.verts[ vertexIndex * 3 + 0 ]
			buffer[ cursor++ ] = blockPos.y + side.verts[ vertexIndex * 3 + 1 ]
			buffer[ cursor++ ] = blockPos.z + side.verts[ vertexIndex * 3 + 2 ]
			buffer[ cursor++ ] = uvs[ vertexIndex * 2 + 0 ]
			buffer[ cursor++ ] = uvs[ vertexIndex * 2 + 1 ]
			buffer[ cursor++ ] = brightnesses[vertexIndex]
			buffer[ cursor++ ] = brightnesses[vertexIndex]
			buffer[ cursor++ ] = brightnesses[vertexIndex]
		}
	},
	clear(buffer, quadBufferIndex) {
		var cursor = quadBufferIndex * this.quadSize
		for (var i = 0; i < 4; i += 1) {
			// make the triangles degenerate by setting their positions to the same point
			buffer[ cursor + 0 ] = 0
			buffer[ cursor + 1 ] = 0
			buffer[ cursor + 2 ] = 0
			cursor += 8
		}
	},
	getVertexOrderAfterQuadFlipping(brightnesses) {
		var flipQuad = false
		if (brightnesses[0] + brightnesses[2] < brightnesses[1] + brightnesses[3]) {
			return [ 1, 2, 3, 0 ]
		}
		else {
			return [ 0, 1, 2, 3 ]
		}
	}
}
