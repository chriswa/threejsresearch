var T = { name: "TOP",    id: 0, verts: [ 0,1,1, 1,1,1, 1,1,0, 0,1,0, ], dx: 0, dy: 1, dz: 0, size: Chunk.sizeY, deltaIndex: Chunk.sizeZ,                }
var B = { name: "BOTTOM", id: 1, verts: [ 0,0,0, 1,0,0, 1,0,1, 0,0,1, ], dx: 0, dy:-1, dz: 0, size: Chunk.sizeY, deltaIndex: -Chunk.sizeZ,               }
var N = { name: "NORTH",  id: 2, verts: [ 1,0,1, 1,1,1, 0,1,1, 0,0,1, ], dx: 0, dy: 0, dz: 1, size: Chunk.sizeZ, deltaIndex: 1,                          }
var S = { name: "SOUTH",  id: 3, verts: [ 0,0,0, 0,1,0, 1,1,0, 1,0,0, ], dx: 0, dy: 0, dz:-1, size: Chunk.sizeZ, deltaIndex: -1,                         }
var E = { name: "EAST",   id: 4, verts: [ 1,0,0, 1,1,0, 1,1,1, 1,0,1, ], dx: 1, dy: 0, dz: 0, size: Chunk.sizeX, deltaIndex: Chunk.sizeZ * Chunk.sizeY,  }
var W = { name: "WEST",   id: 5, verts: [ 0,0,1, 0,1,1, 0,1,0, 0,0,0, ], dx:-1, dy: 0, dz: 0, size: Chunk.sizeX, deltaIndex: -Chunk.sizeZ * Chunk.sizeY, }

var Sides = {
	TOP:    T,
	BOTTOM: B,
	NORTH:  N,
	SOUTH:  S,
	EAST:   E,
	WEST:   W,
}

_.each(Sides, side => {
	side.deltaVector3 = new THREE.Vector3( side.dx, side.dy, side.dz )
})

T.tangents = [ { side: N, tangents: [ E, W ] }, { side: E, tangents: [ S, N ] }, { side: S, tangents: [ W, E ] }, { side: W, tangents: [ N, S ]  } ]
B.tangents = [ { side: S, tangents: [ W, E ] }, { side: E, tangents: [ S, N ] }, { side: N, tangents: [ E, W ] }, { side: W, tangents: [ N, S ]  } ]
N.tangents = [ { side: E, tangents: [ T, B ] }, { side: T, tangents: [ E, W ] }, { side: W, tangents: [ B, T ] }, { side: B, tangents: [ W, E ]  } ]
S.tangents = [ { side: W, tangents: [ B, T ] }, { side: T, tangents: [ E, W ] }, { side: E, tangents: [ T, B ] }, { side: B, tangents: [ W, E ]  } ]
E.tangents = [ { side: S, tangents: [ T, B ] }, { side: T, tangents: [ N, S ] }, { side: N, tangents: [ B, T ] }, { side: B, tangents: [ S, N ]  } ]
W.tangents = [ { side: N, tangents: [ B, T ] }, { side: T, tangents: [ N, S ] }, { side: S, tangents: [ T, B ] }, { side: B, tangents: [ S, N ]  } ]

T.opposite = B
B.opposite = T
N.opposite = S
S.opposite = N
E.opposite = W
W.opposite = E

var SidesById = [ T, B, N, S, E, W ]

Sides.each = callback => {
	for (var sideId = 0; sideId < 6; sideId += 1) {
		callback(SidesById[sideId])
	}
}

Sides.findFromNormal = normal => {
	return _.minBy(SidesById, side => {
		return Math.abs( side.dx - normal.x ) + Math.abs( side.dy - normal.y ) + Math.abs( side.dz - normal.z )
	})
}
