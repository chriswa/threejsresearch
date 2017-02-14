var Sides = {
	TOP:    { id: 0, verts: [ +0,+0,+1, +1,+0,+1, +1,+0,+0, +0,+0,+0, ], dx: 0, dy: 1, dz: 0, size: Chunk.sizeY, deltaIndex: Chunk.sizeZ,                },
	BOTTOM: { id: 1, verts: [ +0,-1,+0, +1,-1,+0, +1,-1,+1, +0,-1,+1, ], dx: 0, dy:-1, dz: 0, size: Chunk.sizeY, deltaIndex: -Chunk.sizeZ,               },
	NORTH:  { id: 2, verts: [ +1,-1,+1, +1,+0,+1, +0,+0,+1, +0,-1,+1, ], dx: 0, dy: 0, dz: 1, size: Chunk.sizeZ, deltaIndex: 1,                          },
	SOUTH:  { id: 3, verts: [ +0,-1,+0, +0,+0,+0, +1,+0,+0, +1,-1,+0, ], dx: 0, dy: 0, dz:-1, size: Chunk.sizeZ, deltaIndex: -1,                         },
	EAST:   { id: 4, verts: [ +1,-1,+0, +1,+0,+0, +1,+0,+1, +1,-1,+1, ], dx: 1, dy: 0, dz: 0, size: Chunk.sizeX, deltaIndex: Chunk.sizeZ * Chunk.sizeY,  },
	WEST:   { id: 5, verts: [ +0,-1,+1, +0,+0,+1, +0,+0,+0, +0,-1,+0, ], dx:-1, dy: 0, dz: 0, size: Chunk.sizeX, deltaIndex: -Chunk.sizeZ * Chunk.sizeY, },
}
Sides.TOP.tangents    = [ Sides.NORTH, Sides.EAST, Sides.SOUTH, Sides.WEST,   ]
Sides.BOTTOM.tangents = [ Sides.SOUTH, Sides.EAST, Sides.NORTH, Sides.WEST,   ]
Sides.NORTH.tangents  = [ Sides.EAST,  Sides.TOP,  Sides.WEST,  Sides.BOTTOM, ]
Sides.SOUTH.tangents  = [ Sides.WEST,  Sides.TOP,  Sides.EAST,  Sides.BOTTOM, ]
Sides.EAST.tangents   = [ Sides.SOUTH, Sides.TOP,  Sides.NORTH, Sides.BOTTOM, ]
Sides.WEST.tangents   = [ Sides.NORTH, Sides.TOP,  Sides.SOUTH, Sides.BOTTOM, ]
Sides.TOP.mirror    = Sides.BOTTOM
Sides.BOTTOM.mirror = Sides.TOP
Sides.NORTH.mirror  = Sides.SOUTH
Sides.SOUTH.mirror  = Sides.NORTH
Sides.EAST.mirror   = Sides.WEST
Sides.WEST.mirror   = Sides.EAST
var SidesById = [ Sides.TOP, Sides.BOTTOM, Sides.NORTH, Sides.SOUTH, Sides.EAST, Sides.WEST ]
