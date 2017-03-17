var fbm_counter = 0
class Noise3d {
	constructor(scale, offset) {
		this.scale			 = scale
		this.workVector	= new THREE.Vector3()
		this.offset			= new THREE.Vector3()
		if (offset) {
			this.offset.copy(offset)
		}
		else {
			this.randomizeOffset()
		}
		this.setFractal(1, 0.5, 2)
	}
	randomizeOffset() {
		fbm_counter += 123.45
		this.offset.x = noise.simplex3( fbm_counter, 0, 0 ) * 1000
		this.offset.y = noise.simplex3( 0, fbm_counter, 0 ) * 1000
		this.offset.z = noise.simplex3( 0, 0, fbm_counter ) * 1000
		return this
	}
	setFractal(octaves, persistance, lacunarity) {
		this.octaves = octaves
		this.persistance = persistance
		this.lacunarity = lacunarity
		return this
	}
	clone() {
		var obj = new Noise3d(this.scale, this.offset)
		obj.setFractal(this.octaves, this.persistance, this.lacunarity)
		return obj
	}
	sample3(sampleVector) {
		var amplitude = 1
		var frequency = 1
		var sum = 0
		var work = this.workVector
		work.copy(sampleVector).add(this.offset).divideScalar(this.scale)
		for (var i = 0; i < this.octaves; i += 1) {
			work.multiplyScalar(frequency)
			sum += amplitude * noise.simplex3( work.x, work.y, work.z )
			amplitude *= this.persistance
			frequency *= this.lacunarity
		}
		return sum
	}
	sample2(sampleVector) {
		var amplitude = 1
		var frequency = 1
		var sum = 0
		var work = this.workVector
		work.copy(sampleVector).add(this.offset).divideScalar(this.scale)
		for (var i = 0; i < this.octaves; i += 1) {
			work.multiplyScalar(frequency)
			sum += amplitude * noise.simplex2( work.x, work.z )
			amplitude *= this.persistance
			frequency *= this.lacunarity
		}
		return sum
	}
}

class NoiseWarp3d {
	constructor(scale, noiseSource) {
		this.scale = scale
		this.noise_x = noiseSource.clone().randomizeOffset()
		this.noise_y = noiseSource.clone().randomizeOffset()
		this.noise_z = noiseSource.clone().randomizeOffset()
		this.workVector = new THREE.Vector3()
	}
	warp3(pos) {
		this.workVector.x = pos.x + this.scale * this.noise_x.sample3(pos)
		this.workVector.y = pos.y + this.scale * this.noise_y.sample3(pos)
		this.workVector.z = pos.z + this.scale * this.noise_z.sample3(pos)
		pos.copy(this.workVector)
		return pos
	}
	warp2(pos) {
		this.workVector.x = pos.x + this.scale * this.noise_x.sample2(pos)
		this.workVector.y = pos.y + this.scale * this.noise_y.sample2(pos)
		this.workVector.z = pos.z + this.scale * this.noise_z.sample2(pos)
		pos.copy(this.workVector)
		return pos
	}
}



class CellNoise {
	constructor(scale) {
		this.scale = scale
		this.noisex = new Noise3d(1)
		this.noisez = new Noise3d(1)
		this.noiseq = new Noise3d(1)
		this.workVector = new THREE.Vector3()
		this.winningGridCoord = new THREE.Vector3()
	}
	sample2sqr(x, z) {
		// http://www.iquilezles.org/www/articles/voronoilines/voronoilines.htm
		x *= this.scale
		z *= this.scale
		var px = Math.floor( x )
		var pz = Math.floor( z )
		var fx = x - px
		var fz = z - pz
		var smallestD = 100
		for (var bz = -1; bz <= 1; bz += 1) {
			for (var bx = -1; bx <= 1; bx += 1) {
				this.workVector.set( px + bx, 0, pz + bz )
				var rx = bx + 0.5 * this.noisex.sample2(this.workVector) - fx
				var rz = bz + 0.5 * this.noisez.sample2(this.workVector) - fz
				var d = rx*rx + rz*rz
				if ( d < smallestD ) {
					smallestD = d
					this.winningGridCoord.copy(this.workVector)
				}
			}
		}
		var closestNoise = this.noiseq.sample2(this.winningGridCoord)
		return [ smallestD, closestNoise ]
	}
}
