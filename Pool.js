class Pool {
	constructor(createCallback) {
		this.createCallback = createCallback
		this.pool = []
	}
	acquire() {
		if (this.pool.length) {
			return this.pool.pop()
		}
		return this.createCallback()
	}
	release(obj) {
		this.pool.push(obj)
	}
}
