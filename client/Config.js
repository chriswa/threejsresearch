var Config = {
	init() {
		this.data = {
			'Position'      : "",
			'Movement Mode' : PlayerControls.mode,
			'Move Speed'    : PlayerControls.MOVE_SPEED,
			'Jump Impulse'  : PlayerControls.JUMP_IMPULSE,
			'No Clip'       : PlayerControls.NO_CLIP,
			'Gravity'       : PlayerControls.GRAVITY,
			'Reset Position': () => { Game.camera.position.set(0, 16, 0) ; PlayerControls.fallVelocity = 0 },
		}
		var gui = new dat.GUI()
		var f1 = gui.addFolder('Movement')
		f1.open()
		f1.add(this.data, 'Movement Mode', { Walking: PlayerControls.WALKING, Flying: PlayerControls.FLYING })
		                                  .onChange(v => PlayerControls.mode = parseInt(v))
		f1.add(this.data, 'Move Speed')   .onChange(v => PlayerControls.MOVE_SPEED = v)
		f1.add(this.data, 'Jump Impulse') .onChange(v => PlayerControls.JUMP_IMPULSE = v)
		f1.add(this.data, 'No Clip')      .onChange(v => PlayerControls.NO_CLIP = v)
		f1.add(this.data, 'Gravity')      .onChange(v => PlayerControls.GRAVITY = v)
		f1.add(this.data, 'Reset Position')
	},
	update() {
		this.data.Position = `x = ${Math.round(Game.camera.position.x)}, y = ${Math.round(Game.camera.position.y)}, z = ${Math.round(Game.camera.position.z)}`

	},
}
