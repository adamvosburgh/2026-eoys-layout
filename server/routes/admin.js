import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getAllAssets, getAssetById, insertAsset, updateAsset } from '../db.js'

const router = express.Router()

const STORAGE_PATH = process.env.ASSET_STORAGE_PATH || path.join(process.cwd(), 'storage', 'assets')
fs.mkdirSync(STORAGE_PATH, { recursive: true })

const upload = multer({
  dest: STORAGE_PATH,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file) => {
    return ['.glb', '.obj'].includes(path.extname(file.originalname).toLowerCase())
  },
})

// List all assets (admin)
router.get('/assets', (req, res) => {
  res.json(getAllAssets())
})

// Upload new asset
router.post('/assets', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const id = uuidv4()
  const { name, description, category, boundingBox, isGlobal } = req.body

  // Rename to id.ext for predictable storage
  const ext = path.extname(req.file.originalname)
  const finalPath = path.join(STORAGE_PATH, `${id}${ext}`)
  fs.renameSync(req.file.path, finalPath)

  insertAsset({
    id,
    name: name || req.file.originalname,
    description: description || '',
    category: category || 'custom',
    source: 'upload',
    file_path: finalPath,
    thumbnail_path: null,
    bounding_box: boundingBox || null,
    is_global: isGlobal === 'true' || isGlobal === '1' ? 1 : 0,
    approved: 0,
    scan_source: null,
  })

  res.json({ id })
})

// Approve / update asset fields
router.patch('/assets/:id', express.json(), (req, res) => {
  const asset = getAssetById(req.params.id)
  if (!asset) return res.status(404).json({ error: 'Not found' })

  const { name, description, category, is_global, approved, bounding_box } = req.body
  const fields = {}
  if (name !== undefined) fields.name = name
  if (description !== undefined) fields.description = description
  if (category !== undefined) fields.category = category
  if (is_global !== undefined) fields.is_global = is_global ? 1 : 0
  if (approved !== undefined) fields.approved = approved ? 1 : 0
  if (bounding_box !== undefined) fields.bounding_box = bounding_box

  updateAsset(req.params.id, fields)
  res.json({ ok: true })
})

// Import scan objects from pipeline output
router.post('/scan-objects', express.json(), (req, res) => {
  const objects = req.body
  if (!Array.isArray(objects)) return res.status(400).json({ error: 'Expected array' })

  const ids = []
  for (const obj of objects) {
    const id = uuidv4()
    insertAsset({
      id,
      name: obj.scanName || '',
      description: '',
      category: obj.category || 'furniture',
      source: 'scan',
      file_path: null,
      thumbnail_path: null,
      bounding_box: obj.boundingBox ? JSON.stringify(obj.boundingBox) : null,
      is_global: 0,
      approved: 0,
      scan_source: obj.scanSource || null,
    })
    ids.push(id)
  }
  res.json({ imported: ids.length, ids })
})

export default router
