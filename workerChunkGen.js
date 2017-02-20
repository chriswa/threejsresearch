// var worker = new Worker('workerWorldGen.js');
// worker.addEventListener('message', function(e) {
//   console.log('Worker said: ', e.data);
// }, false);
// worker.postMessage({'cmd': 'start', 'msg': 'Hi'}); // Start the worker.

importScripts('perlin.js', 'three.js', 'Chunk.js', 'Sides.js', 'BlockTypes.js')


noise.seed(2)


self.addEventListener('message', function(e) {
	var data = e.data

	var callbackId = data.callbackId

	var cx = data.cx
	var cy = data.cy
	var cz = data.cz

	var chunkBlockData = data.blockData

	for (var x = 0, i = 0; x < Chunk.sizeX; x += 1) {
		for (var y = 0; y < Chunk.sizeY; y += 1) {
			for (var z = 0; z < Chunk.sizeZ; z += 1, i += 1) {
				
				var sampleX = x + cx * Chunk.sizeX
				var sampleY = y + cy * Chunk.sizeY
				var sampleZ = z + cz * Chunk.sizeZ

				var blockData = 0

				if (sampleY < -6) {
						blockData = BlockTypesByName.stone.id
				}
				else if (sampleY > 12) {
						blockData = BlockTypesByName.air.id
				}
				else {
					if (noise.simplex3(sampleX / 20, sampleY / 50, sampleZ / 20) > sampleY / 5) {
						blockData = BlockTypesByName.dirt.id
					}
					if (noise.simplex3((sampleX + 874356) / 10, sampleY / 50, (sampleZ + 874356) / 10) > ((sampleY + 0) / 10)) {
						blockData = BlockTypesByName.stone.id
					}
				}
				
				chunkBlockData[i] = blockData;
			}
		}
	}

  self.postMessage({ callbackId: callbackId, payload: chunkBlockData }, [ chunkBlockData.buffer ]) // transfer with "Transferable Objects". the 'version' from the calling context is no longer available once transferred to the new context

}, false);




