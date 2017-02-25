var CHUNK_SIZE         = 16
var CHUNK_SIZE_SQUARED = CHUNK_SIZE * CHUNK_SIZE
var CHUNK_SIZE_CUBED   = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE

var facesPerCube = 6;
var uniqVertsPerFace = 4;
var indicesPerFace = 6;
var maxVerts = 64 * 1024 // this should be 64k
var maxQuadsPerChunk = maxVerts / uniqVertsPerFace
var maxQuadsPerMesh = 1000
