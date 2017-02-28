class NetworkAuthority {

	constructor(serverUrl) {
		this.isConnected = false
		this.serverUrl = 'ws://' + (serverUrl === '1' ? window.location.host : serverUrl)
		this.connect()
	}

	connect() {
		this.websocket = new WebSocket(this.serverUrl)

		this.websocket.onopen = () => {
			this.isConnected = true
			console.log(`NetworkAuthority websocket connected `)
		}

		this.websocket.onerror = error => {
			if (this.isConnected) {
				console.error(`NetworkAuthority websocket error!`, error)
			}
		}

		this.websocket.onclose = event => {
			if (this.isConnected) {
				this.isConnected = false
				console.error(`NetworkAuthority websocket lost connection!`)
				// TODO: reconnect?
			}
		}

		this.websocket.onmessage = message => {
			console.log(`WEBSOCKET MESSAGE: ${message}`)
		}
	}

	send(data) {
		this.connection.send(data)
	}

}

