class BlockType {
	constructor(id, name, tileIndex) {
		this.id = id
		this.name = name
		this.textureSides = []
		Sides.each(side => {
			this.textureSides[side.id] = this.makeTextureSide(tileIndex)
		})
	}
	setSideTile(side, tileIndex) {
		this.textureSides[side.id] = this.makeTextureSide(tileIndex)
		return this
	}
	makeTextureSide(tileIndex) {
		var tu = tileIndex % 16
		var tv = (16 - 1) - Math.floor(tileIndex / 16)
		var u0 = tu / 16
		var u1 = (tu + 1) / 16
		var v0 = tv / 16
		var v1 = (tv + 1) / 16
		return [ u1, v0, u1, v1, u0, v1, u0, v0 ]
	}
}

var BlockTypesById = []
var BlockTypesByName = {}

function addBlockType(name, tileIndex) {
	var id = BlockTypesById.length
	var blockType = new BlockType(id, name, tileIndex)
	BlockTypesById[id] = blockType
	BlockTypesByName[name] = blockType
	return blockType
}

addBlockType('air', 0)
addBlockType('stone', 1)
addBlockType('dirt', 2)
addBlockType('grass', 3).setSideTile(Sides.TOP, 0).setSideTile(Sides.BOTTOM, 2)
addBlockType('planks', 4)

