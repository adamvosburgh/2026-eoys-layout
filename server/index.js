import express from 'express'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

import { v4 as uuidv4 } from 'uuid'

import { setupWebSocket } from './websocket.js'
import roomsRouter from './routes/rooms.js'
import assetsRouter from './routes/assets.js'
import adminRouter from './routes/admin.js'
import { getAssetById, findScanAsset, insertAsset, updateAsset } from './db.js'

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

// Auto-import scan_objects.json from every processed room into the DB.
// Dedupe by (scan_source, scanName), so re-running is idempotent.
function importScanObjects() {
  const modelsDir = path.join(process.cwd(), 'public', 'models')
  if (!fs.existsSync(modelsDir)) return
  let imported = 0, skipped = 0
  for (const slug of fs.readdirSync(modelsDir)) {
    const jsonPath = path.join(modelsDir, slug, 'scan_objects.json')
    if (!fs.existsSync(jsonPath)) continue
    let entries
    try { entries = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }
    catch (e) { console.warn(`[scan-import] bad JSON in ${jsonPath}:`, e.message); continue }
    if (!Array.isArray(entries)) continue
    for (const obj of entries) {
      const scanSource = obj.scanSource || slug
      const name = obj.scanName || ''
      if (!name) continue
      const existing = findScanAsset(scanSource, name)
      if (existing) {
        // Backfill file_path on rows imported before per-scan-GLB extraction
        const filePathExisting = obj.scanFile
          ? path.join(process.cwd(), obj.scanFile)
          : null
        if (!existing.file_path && filePathExisting && fs.existsSync(filePathExisting)) {
          updateAsset(existing.id, { file_path: filePathExisting })
        }
        skipped++; continue
      }
      // scanFile is a path relative to repo root (e.g. public/models/avery-115/scans/xxx.glb)
      const filePath = obj.scanFile
        ? path.join(process.cwd(), obj.scanFile)
        : null
      const fileExists = filePath && fs.existsSync(filePath)
      insertAsset({
        id: uuidv4(),
        name,
        description: '',
        category: obj.category || 'furniture',
        source: 'scan',
        file_path: fileExists ? filePath : null,
        thumbnail_path: null,
        bounding_box: obj.boundingBox ? JSON.stringify(obj.boundingBox) : null,
        is_global: 0,
        approved: 0,
        scan_source: scanSource,
      })
      imported++
    }
  }
  console.log(`[scan-import] ${imported} new scan objects imported, ${skipped} already in DB`)
}

importScanObjects()

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT} [${isProd ? 'production' : 'dev'}]`)
})
