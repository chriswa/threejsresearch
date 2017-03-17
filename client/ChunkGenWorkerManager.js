class ChunkGenWorker {
	constructor() {
		this.jobId = 0
		this.onComplete = undefined
		this.init()
	}
	init() {
		var that = this
		this.worker = new Worker('workerChunkGen.js')
		this.worker.addEventListener('message', e => {
			if (e.data.jobId !== that.jobId) { return } // old job? ignore response
			if (!that.onComplete) { return } // already called onComplete once? ignore response

			// onComplete may start this worker again, so calling it should be the last thing we do, however we want to make sure onComplete is wiped out so it isn't accidently called again, hence this swapping of variables
			var callback = that.onComplete
			that.onComplete = undefined
			callback(e.data)
		})
	}
	start(payload, transferableObjects, onComplete) {
		this.jobId += 1
		this.onComplete = onComplete
		payload.jobId = this.jobId
		this.worker.postMessage(payload, transferableObjects) // transfer with "Transferable Objects"
	}
	cancel() {
		this.worker.postMessage({ cancel: this.jobId }) // after sending this, we aren't sure if we'll get a success or cancelled message, but our listener will only respond to the first one just in case there are two
	}
}

var estimatedLogicalCoresAvailable = (navigator.hardwareConcurrency || 4) - 2

var ChunkGenWorkerManager = {
	nextTaskId: 1,
	workerCount: estimatedLogicalCoresAvailable,
	activeWorkerTasks: [],
	availableWorkers: [],
	queuedTasks: [],
	init() {
		for (var i = 0; i < this.workerCount; i += 1) {
			this.availableWorkers.push(new ChunkGenWorker())
		}
	},
	queueTask(onStart, onComplete) {
		var taskId = this.nextTaskId++
		var task = { taskId, onStart, onComplete }
		this.queuedTasks.push(task)
		this.processQueue()
		return taskId
	},
	processQueue() {
		while (this.availableWorkers.length > 0 && this.queuedTasks.length > 0) {
			var task = this.queuedTasks.shift()
			var worker = this.availableWorkers.pop()
			this.activeWorkerTasks.push({ task, worker })
			this.startWorker(worker, task)
		}
	},
	startWorker(worker, task) {
		var startRetval = task.onStart()
		var payload = startRetval[0]
		var transferableObjects = startRetval[1]

		worker.start(payload, transferableObjects, payload => {
			_.remove(this.activeWorkerTasks, activeWorkerTask => activeWorkerTask.task === task)
			this.availableWorkers.push(worker)
			this.processQueue()
			task.onComplete(payload)
		})
	},
	cancelTask(taskId) {
		// if the task is still in the queue, simply remove it (we never called onStart, so we don't need to call onComplete)
		var taskFromQueue = _.remove(this.queuedTasks, task => task.taskId === taskId)
		if (taskFromQueue.length) {
			return true
		}

		// otherwise, we need to stop an active worker...
		var taskFromActive = _.find(this.activeWorkerTasks, activeWorkerTask => activeWorkerTask.task.taskId === taskId)
		if (taskFromActive) {
			console.log(`cancelling a task`)
			taskFromActive.worker.cancel() // fire off the cancel message and continue waiting for a reply...
		}
		else {
			debugger
		}
		return false
	},
}
ChunkGenWorkerManager.init()
