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
		this.i = this.y + this.z * CHUNK_SIZE + this.x * CHUNK_SIZE * CHUNK_SIZE
	}
	getWorldPoint() {
		return new THREE.Vector3( this.chunk.chunkPos.x * CHUNK_SIZE + this.x, this.chunk.chunkPos.y * CHUNK_SIZE + this.y, this.chunk.chunkPos.z * CHUNK_SIZE + this.z )
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
		this.chunk.alterOneBlock(this, newBlockData)
	}
	getAdjacentBlockPos(side) {
		var neighbourChunk = this.chunk.neighboursBySideId[side.id]
		if (side === Sides.TOP) {
			if (this.y === CHUNK_SIZE - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, 0, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.BOTTOM) {
			if (this.y === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, CHUNK_SIZE - 1, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.NORTH) {
			if (this.z === CHUNK_SIZE - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, this.y, 0 ) : BlockPos.badPos
			}
		}
		else if (side === Sides.SOUTH) {
			if (this.z === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, this.x, this.y, CHUNK_SIZE - 1 ) : BlockPos.badPos
			}
		}
		else if (side === Sides.EAST) {
			if (this.x === CHUNK_SIZE - 1) {
				return neighbourChunk ? new BlockPos( neighbourChunk, 0, this.y, this.z ) : BlockPos.badPos
			}
		}
		else if (side === Sides.WEST) {
			if (this.x === 0) {
				return neighbourChunk ? new BlockPos( neighbourChunk, CHUNK_SIZE - 1, this.y, this.z ) : BlockPos.badPos
			}
		}
		return new BlockPos(this.chunk, this.x + side.dx, this.y + side.dy, this.z + side.dz)
	}
	add(dx, dy, dz) {
		if (dy > 0) { this.y += dy; while (this.y > CHUNK_SIZE-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.TOP.id    ]; this.y -= CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
		if (dy < 0) { this.y += dy; while (this.y < 0)            { this.chunk = this.chunk.neighboursBySideId[ Sides.BOTTOM.id ]; this.y += CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
		if (dz > 0) { this.z += dz; while (this.z > CHUNK_SIZE-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.NORTH.id  ]; this.z -= CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
		if (dz < 0) { this.z += dz; while (this.z < 0)            { this.chunk = this.chunk.neighboursBySideId[ Sides.SOUTH.id  ]; this.z += CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
		if (dx > 0) { this.x += dx; while (this.x > CHUNK_SIZE-1) { this.chunk = this.chunk.neighboursBySideId[ Sides.EAST.id   ]; this.x -= CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
		if (dx < 0) { this.x += dx; while (this.x < 0)            { this.chunk = this.chunk.neighboursBySideId[ Sides.WEST.id   ]; this.x += CHUNK_SIZE; if (!this.chunk) { this.corrupt() ; return } } }
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
