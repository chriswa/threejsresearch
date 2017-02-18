class BlockPos {
	constructor(chunk, x, y, z) {
		this.chunk = chunk
		this.x = x
		this.y = y
		this.z = z
		this.recalculateIndex()
		this.isLoaded = true
	}
	clone() {
		return new BlockPos(this.chunk, this.x, this.y)
	}
	recalculateIndex() {
		this.i = this.z + this.y * Chunk.sizeZ + this.x * Chunk.sizeZ * Chunk.sizeY
	}
	getWorldPoint() {
		return new THREE.Vector3( this.chunk.cx * Chunk.sizeX + this.x, this.chunk.cy * Chunk.sizeY + this.y, this.chunk.cz * Chunk.sizeZ + this.z )
	}
	getBlockData() {
		return this.chunk.blockData[this.i]
	}
	getBlockType() {
		return BlockTypesById[this.getBlockData()]
	}
	isOpaque() {
		return (this.isLoaded && this.getBlockData() !== 0)
	}
	isTransparent() {
		return (this.isLoaded && this.getBlockData() === 0)
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
	add(dx, dy, dz) {
		if (dy > 0) { this.y += dy; while (this.y > Chunk.sizeY-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.TOP.id    ]; this.y -= Chunk.sizeY; if (!this.chunk) { this.corrupt() ; return } } }
		if (dy < 0) { this.y += dy; while (this.y < 0)             { this.chunk = this.chunk.neighboursBySideId[ Sides.BOTTOM.id ]; this.y += Chunk.sizeY; if (!this.chunk) { this.corrupt() ; return } } }
		if (dz > 0) { this.z += dz; while (this.z > Chunk.sizeZ-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.NORTH.id  ]; this.z -= Chunk.sizeZ; if (!this.chunk) { this.corrupt() ; return } } }
		if (dz < 0) { this.z += dz; while (this.z < 0)             { this.chunk = this.chunk.neighboursBySideId[ Sides.SOUTH.id  ]; this.z += Chunk.sizeZ; if (!this.chunk) { this.corrupt() ; return } } }
		if (dx > 0) { this.x += dx; while (this.x > Chunk.sizeX-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.EAST.id   ]; this.x -= Chunk.sizeX; if (!this.chunk) { this.corrupt() ; return } } }
		if (dx < 0) { this.x += dx; while (this.x < 0)             { this.chunk = this.chunk.neighboursBySideId[ Sides.WEST.id   ]; this.x += Chunk.sizeX; if (!this.chunk) { this.corrupt() ; return } } }
		this.recalculateIndex()
	}
	corrupt() {
		this.isLoaded = false
	}
	toString() {
		return `BlockPos(${this.x},${this.y},${this.z} @ ${this.chunk})`
	}
}
BlockPos.badPos = new BlockPos(undefined, NaN, NaN, NaN)
BlockPos.badPos.isLoaded = false
BlockPos.badPos.getBlockData = () => { return undefined }
BlockPos.badPos.setBlockData = (newBlockData) => { throw new Error("setBlockData on badPos") }
BlockPos.badPos.getAdjacentBlockPos = (side) => { return BlockPos.badPos }
