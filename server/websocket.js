import WebSocket from 'ws'
import { createRequire } from 'module'
import { setPersistence, setupWSConnection } from 'y-websocket/bin/utils'
import { LeveldbPersistence } from 'y-leveldb'
import path from 'path'

// Load Yjs via CommonJS so we share the SAME module instance with y-websocket
// and y-leveldb (which both `require('yjs')`). Importing `yjs` as ESM resolves
// to dist/yjs.mjs and creates a second Y.Doc constructor — Yjs warns
// ("Yjs was already imported. This breaks constructor checks…") and silent
// CRDT misbehavior can follow under load.
const require = createRequire(import.meta.url)
const Y = require('yjs')

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
