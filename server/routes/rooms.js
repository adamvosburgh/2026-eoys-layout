import express from 'express'
import fs from 'fs'
import path from 'path'

const router = express.Router()
const MODELS_DIR = path.join(process.cwd(), 'public', 'models')

router.get('/', (req, res) => {
  if (!fs.existsSync(MODELS_DIR)) return res.json([])

  const rooms = []
  for (const entry of fs.readdirSync(MODELS_DIR)) {
    const metaPath = path.join(MODELS_DIR, entry, 'meta.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        rooms.push(meta)
      } catch {}
    }
  }
  res.json(rooms)
})

export default router
