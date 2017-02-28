class BlockType {
	constructor(id, name, tileIndex) {
		this.id = id
		this.name = name
		this.textureSides = []
		this.colourSides = []
		Sides.each(side => {
			this.textureSides[side.id] = this.makeTextureSide(tileIndex)
			this.colourSides[side.id] = [ 1, 1, 1 ] // white
		})
	}
	setSideColour(side, r, g, b) {
		this.colourSides[side.id] = [r, g, b]
		return this
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
addBlockType('grass', 3).setSideTile(Sides.TOP, 0).setSideColour(Sides.TOP, 0.67, 1.0, 0.33).setSideTile(Sides.BOTTOM, 2)
addBlockType('planks', 4)
addBlockType('brick', 7)
addBlockType('cobble', 16)
addBlockType('bedrock', 17)
addBlockType('sand', 18)
addBlockType('gravel', 19)
addBlockType('wood', 20).setSideTile(Sides.TOP, 21).setSideTile(Sides.BOTTOM, 21)
addBlockType('gold_ore', 32)
addBlockType('iron_ore', 33)
addBlockType('coal_ore', 34)
addBlockType('mossy_cobble', 36)
addBlockType('obsidian', 37)
addBlockType('diamond_ore', 50)
addBlockType('redstone_ore', 51)
addBlockType('stone_brick', 54)
addBlockType('snow', 66)
addBlockType('ice', 67)
addBlockType('snowy_grass', 68).setSideTile(Sides.TOP, 66).setSideTile(Sides.BOTTOM, 2)
addBlockType('fungus', 77).setSideTile(Sides.TOP, 78).setSideTile(Sides.BOTTOM, 2)
addBlockType('mossy_stone_brick', 100)
addBlockType('cracked_stone_brick', 101)
addBlockType('sandstone', 176).setSideTile(Sides.TOP, 192).setSideTile(Sides.BOTTOM, 192)
