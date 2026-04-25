import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'layout.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    source TEXT,
    file_path TEXT,
    thumbnail_path TEXT,
    bounding_box TEXT,
    is_global INTEGER DEFAULT 0,
    approved INTEGER DEFAULT 0,
    scan_source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

export function getApprovedAssets() {
  return db.prepare('SELECT * FROM assets WHERE is_global=1 AND approved=1').all()
}

export function getAllAssets() {
  return db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all()
}

export function getAssetById(id) {
  return db.prepare('SELECT * FROM assets WHERE id=?').get(id)
}

export function insertAsset(asset) {
  return db.prepare(`
    INSERT INTO assets (id, name, description, category, source, file_path, thumbnail_path, bounding_box, is_global, approved, scan_source)
    VALUES ($id, $name, $description, $category, $source, $file_path, $thumbnail_path, $bounding_box, $is_global, $approved, $scan_source)
  `).run({
    $id: asset.id,
    $name: asset.name,
    $description: asset.description,
    $category: asset.category,
    $source: asset.source,
    $file_path: asset.file_path,
    $thumbnail_path: asset.thumbnail_path,
    $bounding_box: asset.bounding_box,
    $is_global: asset.is_global,
    $approved: asset.approved,
    $scan_source: asset.scan_source,
  })
}

export function updateAsset(id, fields) {
  const allowed = ['name', 'description', 'category', 'is_global', 'approved', 'bounding_box']
  const keys = Object.keys(fields).filter(k => allowed.includes(k))
  if (!keys.length) return
  const sets = keys.map(k => `${k}=$${k}`).join(', ')
  const params = { $id: id }
  for (const k of keys) params[`$${k}`] = fields[k]
  return db.prepare(`UPDATE assets SET ${sets} WHERE id=$id`).run(params)
}

export default db
