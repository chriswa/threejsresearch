const config = {
	port: 9999
}

const http = require('http')
const fs   = require('fs')
const path = require('path')

// http server
const httpServer = http.createServer((request, response) => {
	serveStaticFile(request.url, response)
})
httpServer.listen(config.port, () => {
	console.log(`http up @ http://localhost:${config.port}/`)
})

module.exports = httpServer

function serveStaticFile(url, httpResponse) {

    var urlParts = url.split('?')
    var urlPath = urlParts[0]
    var queryString = urlParts[1] || ''

	// default route is to client/
	var filePath = './client' + urlPath

	// if the urlPath start with "amd/", route to amd/ instead of client/
	//if (/^\/amd\//.test(urlPath)) { filePath = '.' + urlPath }

	// add 'index.html' if file is not supplied (e.g. urlPath === '/')
	if (/\/$/.test(filePath)) { filePath += 'index.html' }

	var contentTypeByExtension = {
		'.js':     'text/javascript',
		'.css':    'text/css',
		'.json':   'application/json',
		'.png':    'image/png',
		'.jpg':    'image/jpg',
        'default': 'text/html',
	}
	var contentType = contentTypeByExtension[path.extname(filePath)] || contentTypeByExtension['default']

	//console.log("serveStaticFile: looking for " + filePath)

	fs.readFile(filePath, (error, content) => {
		if (error) {
			if (error.code === 'ENOENT'){
				httpResponse.writeHead(404)
				httpResponse.end('Not found\n')
			}
			else {
				httpResponse.writeHead(500)
				httpResponse.end(`Server error: ${error.code}\n`)
			}
		}
		else {
			httpResponse.writeHead(200, { 'Content-Type': contentType })
			httpResponse.end(content) // , 'utf-8'
		}
	});
}