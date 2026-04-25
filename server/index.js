import express from 'express'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

import { setupWebSocket } from './websocket.js'
import roomsRouter from './routes/rooms.js'
import assetsRouter from './routes/assets.js'
import adminRouter from './routes/admin.js'
import { getAssetById } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

const app = express()
const server = http.createServer(app)

// WebSocket (y-websocket)
setupWebSocket(server)

// Static: processed room models (always served)
app.use('/models', express.static(path.join(process.cwd(), 'public', 'models')))

// Serve uploaded asset files by id
app.get('/api/asset-file/:id', (req, res) => {
  const asset = getAssetById(req.params.id)
  if (!asset || !asset.file_path) return res.status(404).end()
  if (!fs.existsSync(asset.file_path)) return res.status(404).end()
  res.sendFile(asset.file_path)
})

// API routes
app.use('/api/rooms', roomsRouter)
app.use('/api/assets', assetsRouter)
app.use('/api/admin', adminRouter)

// Admin page (standalone HTML in dev, served from dist in prod)
if (isProd) {
  app.use(express.static(path.join(process.cwd(), 'dist')))
  app.get('/admin', (req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'admin', 'index.html')))
  app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')))
} else {
  // In dev, Vite serves the frontend on :5173. Express only serves the API + WebSocket.
  // Serve admin/index.html directly for convenience
  app.get('/admin', (req, res) => res.sendFile(path.join(process.cwd(), 'admin', 'index.html')))
}

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT} [${isProd ? 'production' : 'dev'}]`)
})
