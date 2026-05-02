import WebSocket from 'ws'
import * as Y from 'yjs'
import { setPersistence, setupWSConnection } from 'y-websocket/bin/utils'
import { LeveldbPersistence } from 'y-leveldb'
import path from 'path'

const DB_DIR = path.join(path.dirname(process.env.DB_PATH || './data/layout.db'), 'yjs-db')
const ldb = new LeveldbPersistence(DB_DIR)

setPersistence({
  bindState: async (docName, ydoc) => {
    const persisted = await ldb.getYDoc(docName)
    // Flush any updates that arrived during the async LevelDB load window
    await ldb.storeUpdate(docName, Y.encodeStateAsUpdate(ydoc))
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persisted))
    ydoc.on('update', update => ldb.storeUpdate(docName, update))
  },
  writeState: async (docName, ydoc) => {
    // Flush full state on last-client-disconnect to prevent race with pending storeUpdate promises
    await ldb.storeUpdate(docName, Y.encodeStateAsUpdate(ydoc))
  },
})

export function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server })

  wss.on('connection', (ws, req) => {
    setupWSConnection(ws, req)
  })

  return wss
}
