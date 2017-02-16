var fps
var pointerLocked = false

var element = document.body;

var pointerlockchange = function ( event ) {
	if ( document.pointerLockElement === element || document.mozPointerLockElement === element || document.webkitPointerLockElement === element ) {
		pointerLocked = true;
	}
	else {
		pointerLocked = false;
	}
}

// Hook pointer lock state change events
document.addEventListener( 'pointerlockchange', pointerlockchange, false );
document.addEventListener( 'mozpointerlockchange', pointerlockchange, false );
document.addEventListener( 'webkitpointerlockchange', pointerlockchange, false );


var PlayerControls = {
	init(camera) {

		document.addEventListener( 'click', function ( event ) {
			if (!pointerLocked) {
				element.requestPointerLock = element.requestPointerLock || element.mozRequestPointerLock || element.webkitRequestPointerLock;
				element.requestPointerLock();
			}
			else {
				camera.dispatchEvent( { type: 'click', button: event.button } )
			}
		}, false );

		fps = new THREE.FirstPersonControls( camera );
		fps.movementSpeed = 10;
		//fps.lookSpeed     = 0.5;
		fps.noFly         = false;
		//fps.lookVertical  = true;
		fps.activeLook    = false;

		document.addEventListener( 'mousemove', function ( event ) {

			if ( pointerLocked === false ) return;

			fps.lon += 0.3 * (event.movementX || event.mozMovementX || event.webkitMovementX || 0);
			fps.lat -= 0.3 * (event.movementY || event.mozMovementY || event.webkitMovementY || 0);

		}, false );



	},
	update(dt) {
		fps.update(dt)
	},
}
