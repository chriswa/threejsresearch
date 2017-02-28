global.DEBUG = true

global._ = require('lodash')

// persistence
//global.DB = require('./DB')

// http server (serves static files, also depended upon by websocket server)
const httpServer = require('./HttpServer')

// websocket server
const websocket = require('websocket')
//const ServerClient = require('./user/User')
var clients = {}
var nextClientId = 1
wsServer = new websocket.server({ httpServer })
wsServer.on('request', request => {
    console.log("--- new user connected ---")
    var wsConnection = request.accept(null, request.origin)

    wsConnection.on('close', () => {
        console.log('user disconnected')
        //delete(clients[clientId])
    })

    //var clientId = nextClientId
    //nextClientId += 1

    //var client = new ServerClient(wsConnection)
    //clients[clientId] = client
    //user.on('queue_for_multiplayer', () => {;;;})
})