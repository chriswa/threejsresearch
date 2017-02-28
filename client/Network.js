var Network = {
	init() {
		this.isConnected = false
		this.serverUrl = 'ws://' + window.location.host
		this.connect()
	},
	connect() {
		this.websocket = new WebSocket(this.serverUrl)

		this.websocket.onopen = () => {
			this.isConnected = true
			console.log(`Network websocket connected `)
		}

		this.websocket.onerror = error => {
			if (this.isConnected) {
				console.error(`Network websocket error!`, error)
			}
		}

		this.websocket.onclose = event => {
			if (this.isConnected) {
				this.isConnected = false
				console.error(`Network websocket lost connection!`)
				// TODO: reconnect?
			}
		}

		this.websocket.onmessage = message => {
			console.log(`WEBSOCKET MESSAGE: ${message}`)
		}
	},
	send(data) {
		this.connection.send(data)
	},
}

Network.init()
