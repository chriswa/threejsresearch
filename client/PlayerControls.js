var PlayerControls = {
	FLYING: 1,
	WALKING: 2,
	
	MOVE_SPEED: 100,
	GRAVITY: 1,
	JUMP_IMPULSE: 0.2,
	NO_CLIP: false,

	init(camera, domElement) {
		this.camera = camera

		this.mode = this.FLYING

		this.fallVelocity = 0

		this.pointerLocked = false

		var pointerlockchange = event => {
			if ( document.pointerLockElement === domElement || document.mozPointerLockElement === domElement || document.webkitPointerLockElement === domElement ) {
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

		domElement.addEventListener( 'click', event => {
			if (!this.pointerLocked) {
				domElement.requestPointerLock = domElement.requestPointerLock || domElement.mozRequestPointerLock || domElement.webkitRequestPointerLock;
				domElement.requestPointerLock();
			}
			else {
				camera.dispatchEvent( { type: 'click', button: event.button } )
			}
		}, false );

		this.fps = new THREE.FirstPersonControls( camera, domElement );
		this.fps.movementSpeed = 0;
		//this.fps.lookSpeed     = 0.5;
		this.fps.noFly         = false;
		//this.fps.lookVertical  = true;
		this.fps.activeLook    = false;

		document.addEventListener( 'mousemove', event => {

			if ( this.pointerLocked === false ) return;

			this.fps.lon += 0.2 * (event.movementX || event.mozMovementX || event.webkitMovementX || 0);
			this.fps.lat -= 0.2 * (event.movementY || event.mozMovementY || event.webkitMovementY || 0);

		}, false );



	},
	update(dt) {
		this.fps.update(dt)

		camera.updateMatrixWorld() // prevent raycast from lagging by one frame

		var blockPos = World.getBlockPosFromWorldPoint(camera.position)
		if (!blockPos.isLoaded) { return } // if chunk isn't loaded, don't move!


		var moveMagnitude = this.MOVE_SPEED * dt
		var moveDirection = new THREE.Vector3()
		if (this.fps.moveForward)  { moveDirection.z -= 1 }
		if (this.fps.moveBackward) { moveDirection.z += 1 }
		if (this.fps.moveLeft)     { moveDirection.x -= 1 }
		if (this.fps.moveRight)    { moveDirection.x += 1 }
		if (this.mode === this.FLYING) {
			if (this.fps.moveUp)       { moveDirection.y += 1 }
			if (this.fps.moveDown)     { moveDirection.y -= 1 }
			moveDirection.normalize()
			moveDirection.applyQuaternion(this.camera.quaternion)
		}
		else {
			moveDirection.normalize()
			moveDirection.applyEuler(new THREE.Euler( 0, -this.fps.theta - Math.PI / 2, 0 ))
		}

		moveDirection.multiplyScalar(moveMagnitude)

		if (this.mode === this.WALKING) {
			if (this.fps.moveDown) { moveDirection.multiplyScalar(0.3) }
			if (this.fallVelocity === 0) {
				if (this.fps.moveUp) { this.fallVelocity = this.JUMP_IMPULSE } // jump
			}
			this.fallVelocity -= this.GRAVITY * dt // apply gravity
			moveDirection.y += this.fallVelocity
		}

		if (this.NO_CLIP) {
			this.camera.position.add(moveDirection)
		}
		else {
			var hitFloor = World.translatePlayerWithCollisions(this.camera.position, moveDirection, 0.4)
			if (hitFloor) {
				this.fallVelocity = 0
			}
		}
	},
}
