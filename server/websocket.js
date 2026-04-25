import WebSocket from 'ws'
import { setupWSConnection } from 'y-websocket/bin/utils'

export function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server })

  wss.on('connection', (ws, req) => {
    setupWSConnection(ws, req)
  })

  return wss
}
