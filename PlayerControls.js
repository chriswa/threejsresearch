var PlayerControls = {
	init(camera) {

		this.pointerLocked = false

		var element = document.body;

		var pointerlockchange = event => {
			if ( document.pointerLockElement === element || document.mozPointerLockElement === element || document.webkitPointerLockElement === element ) {
				this.pointerLocked = true;
			}
			else {
				this.pointerLocked = false;
			}
		}

		// Hook pointer lock state change events
		document.addEventListener( 'pointerlockchange', pointerlockchange, false );
		document.addEventListener( 'mozpointerlockchange', pointerlockchange, false );
		document.addEventListener( 'webkitpointerlockchange', pointerlockchange, false );

		document.addEventListener( 'click', event => {
			if (!this.pointerLocked) {
				element.requestPointerLock = element.requestPointerLock || element.mozRequestPointerLock || element.webkitRequestPointerLock;
				element.requestPointerLock();
			}
			else {
				camera.dispatchEvent( { type: 'click', button: event.button } )
			}
		}, false );

		this.fps = new THREE.FirstPersonControls( camera );
		this.fps.movementSpeed = 10;
		//this.fps.lookSpeed     = 0.5;
		this.fps.noFly         = false;
		//this.fps.lookVertical  = true;
		this.fps.activeLook    = false;

		document.addEventListener( 'mousemove', event => {

			if ( this.pointerLocked === false ) return;

			this.fps.lon += 0.3 * (event.movementX || event.mozMovementX || event.webkitMovementX || 0);
			this.fps.lat -= 0.3 * (event.movementY || event.mozMovementY || event.webkitMovementY || 0);

		}, false );



	},
	update(dt) {
		this.fps.update(dt)
	},
}
