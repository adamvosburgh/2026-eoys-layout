import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { NodeIO } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ROOM_PREFIXES = ['wall_', 'joint_', 'floor_', 'door_', 'ceiling_']

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function toRoomName(filename) {
  const base = path.basename(filename, path.extname(filename))
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function categoryFromName(name) {
  const lower = name.toLowerCase()
  const prefixes = [
    'storage_cabinet', 'chair', 'table', 'sofa', 'desk',
    'refrigerator', 'television', 'cabinet', 'shelf',
    'monitor', 'computer', 'lamp', 'plant', 'bed', 'couch',
  ]
  for (const p of prefixes) {
    if (lower.startsWith(p)) return p.replace('_', '')
  }
  return lower.split('_')[0] || 'object'
}

function isRoomNode(name) {
  return ROOM_PREFIXES.some(p => name.toLowerCase().startsWith(p))
}

function collectNodes(node, roomNodes, scanNodes) {
  const name = node.getName() || ''
  const hasMesh = !!node.getMesh()
  if (isRoomNode(name)) {
    roomNodes.push(node)
  } else if (name && hasMesh) {
    // Only mesh-bearing named nodes are scan objects. Skip transform-only
    // container nodes (Blender exports a wrapper like "Node_67" at the root).
    scanNodes.push(node)
  }
  for (const child of node.listChildren()) {
    collectNodes(child, roomNodes, scanNodes)
  }
}

function computeNodeBBox(node) {
  const mesh = node.getMesh()
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray()
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], arr[i]);     max[0] = Math.max(max[0], arr[i])
        min[1] = Math.min(min[1], arr[i + 1]); max[1] = Math.max(max[1], arr[i + 1])
        min[2] = Math.min(min[2], arr[i + 2]); max[2] = Math.max(max[2], arr[i + 2])
      }
    }
  }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}

function computeDocBBox(root) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray()
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], arr[i]);     max[0] = Math.max(max[0], arr[i])
        min[1] = Math.min(min[1], arr[i + 1]); max[1] = Math.max(max[1], arr[i + 1])
        min[2] = Math.min(min[2], arr[i + 2]); max[2] = Math.max(max[2], arr[i + 2])
      }
    }
  }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}

function subtreeContainsName(node, name) {
  if (node.getName() === name) return true
  for (const c of node.listChildren()) {
    if (subtreeContainsName(c, name)) return true
  }
  return false
}

function pruneToName(node, name) {
  if (node.getName() === name) return // keep entire subtree of target
  for (const c of node.listChildren()) {
    if (subtreeContainsName(c, name)) pruneToName(c, name)
    else c.dispose()
  }
}

/** Re-read the original GLB and produce a single-node GLB at outPath. */
async function writeScanNodeGLB(originalBuffer, targetName, outPath) {
  const io  = new NodeIO()
  const doc = await io.readBinary(new Uint8Array(originalBuffer))
  const root = doc.getRoot()

  let foundAny = false
  for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) {
      if (subtreeContainsName(node, targetName)) {
        pruneToName(node, targetName)
        foundAny = true
      } else {
        node.dispose()
      }
    }
  }
  if (!foundAny) return false

  await doc.transform(prune())
  const buf = await io.writeBinary(doc)
  fs.writeFileSync(outPath, Buffer.from(buf))
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const raw  = args.includes('--raw')
  const files = args.filter(a => !a.startsWith('-'))

  const modelsDir = path.resolve(__dirname, 'models')

  if (!files.length) {
    const found = fs.readdirSync(modelsDir).filter(f => f.endsWith('.glb') || f.endsWith('.zip'))
    if (!found.length) { console.error('No .glb or .zip files found in layout-generator/models/'); process.exit(1) }
    for (const file of found) { await processFile(file, raw); console.log() }
    return
  }

  for (const file of files) await processFile(file, raw)
}

async function processFile(arg, raw = false) {
  const filePath = path.resolve(__dirname, 'models', arg)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const roomName = toRoomName(arg)
  const slug     = slugify(roomName)
  console.log(`Processing: ${arg}  →  "${roomName}"  (${slug})`)

  // ── 1. Read GLB bytes ───────────────────────────────────────────────────
  let glbBuffer
  const ext = path.extname(arg).toLowerCase()

  if (ext === '.zip') {
    const zip     = new AdmZip(filePath)
    const entries = zip.getEntries().filter(e => e.entryName.endsWith('.glb'))
    if (!entries.length) { console.error('No .glb found in zip'); process.exit(1) }
    glbBuffer = entries[0].getData()
    console.log(`  Extracted: ${entries[0].entryName} (${(glbBuffer.length / 1024).toFixed(1)} KB)`)
  } else if (ext === '.glb') {
    glbBuffer = fs.readFileSync(filePath)
    console.log(`  Read: ${arg} (${(glbBuffer.length / 1024).toFixed(1)} KB)`)
  } else {
    console.error('Unsupported file type. Use .glb or .zip')
    process.exit(1)
  }

  // ── 2. Parse ─────────────────────────────────────────────────────────────
  const io       = new NodeIO()
  const document = await io.readBinary(new Uint8Array(glbBuffer))
  const root     = document.getRoot()

  // ── 3. Categorize nodes ───────────────────────────────────────────────────
  const roomNodes = []
  const scanNodes = []
  for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) {
      collectNodes(node, roomNodes, scanNodes)
    }
  }
  console.log(`  Room nodes: ${roomNodes.length},  Scan objects: ${scanNodes.length}`)

  // ── RAW mode: copy GLB unchanged, just write meta ─────────────────────────
  if (raw) {
    const bbox     = computeDocBBox(root)
    const floorY   = bbox.min[1]
    const wallMaxY = bbox.max[1]
    console.log(`  BBox: min=[${bbox.min.map(v => v.toFixed(3)).join(', ')}]  max=[${bbox.max.map(v => v.toFixed(3)).join(', ')}]`)
    const outDir = path.resolve(__dirname, '..', 'public', 'models', slug)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'room.glb'), glbBuffer)
    console.log(`  room.glb  →  ${(glbBuffer.length / 1024).toFixed(1)} KB  (raw copy)`)
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
      roomName, slug, boundingBox: bbox, gridSize: 0.1524,
      floorY, wallMaxY, processedAt: new Date().toISOString(), sourceFile: arg,
    }, null, 2))
    console.log(`  meta.json`)
    fs.writeFileSync(path.join(outDir, 'scan_objects.json'), '[]')
    console.log(`Done → public/models/${slug}/  (raw)`)
    return
  }

  // ── 4. Replace floor base-color texture with flat light gray ─────────────
  const floorMats = new Set()
  for (const node of roomNodes) {
    if (!node.getName().toLowerCase().startsWith('floor_')) continue
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (mat) floorMats.add(mat)
    }
  }
  for (const mat of floorMats) {
    mat.setBaseColorTexture(null)
    mat.setBaseColorFactor([0.82, 0.82, 0.82, 1.0])
  }
  console.log(`  Floor materials patched: ${floorMats.size}`)

  // ── 5. Collect scan object metadata + extract each as its own GLB ────────
  const scanDir = path.resolve(__dirname, '..', 'public', 'models', slug, 'scans')
  fs.mkdirSync(scanDir, { recursive: true })

  const scanObjects = []
  for (const node of scanNodes) {
    const scanName = node.getName()
    const safeName = scanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const filename = `${safeName}.glb`
    const ok = await writeScanNodeGLB(glbBuffer, scanName, path.join(scanDir, filename))
    scanObjects.push({
      scanName,
      category:    categoryFromName(scanName),
      boundingBox: computeNodeBBox(node),
      approved:    false,
      assetId:     null,
      scanSource:  slug,
      scanFile:    ok ? `public/models/${slug}/scans/${filename}` : null,
    })
  }
  console.log(`  Extracted ${scanObjects.filter(s => s.scanFile).length} scan GLBs → public/models/${slug}/scans/`)

  // ── 6. Remove scan objects from the main room.glb ────────────────────────
  for (const node of scanNodes) node.dispose()
  await document.transform(prune())

  // ── 7. Bounding box ───────────────────────────────────────────────────────
  const bbox     = computeDocBBox(root)
  const floorY   = bbox.min[1]
  const wallMaxY = bbox.max[1]
  console.log(`  BBox: min=[${bbox.min.map(v => v.toFixed(3)).join(', ')}]  max=[${bbox.max.map(v => v.toFixed(3)).join(', ')}]`)

  // ── 8. Write outputs ──────────────────────────────────────────────────────
  const outDir = path.resolve(__dirname, '..', 'public', 'models', slug)
  fs.mkdirSync(outDir, { recursive: true })

  const glbOut = await io.writeBinary(document)
  fs.writeFileSync(path.join(outDir, 'room.glb'), Buffer.from(glbOut))
  console.log(`  room.glb  →  ${(glbOut.byteLength / 1024).toFixed(1)} KB`)

  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
    roomName,
    slug,
    boundingBox: bbox,
    gridSize:    0.1524,
    floorY,
    wallMaxY,
    processedAt: new Date().toISOString(),
    sourceFile:  arg,
  }, null, 2))
  console.log(`  meta.json`)

  fs.writeFileSync(path.join(outDir, 'scan_objects.json'), JSON.stringify(scanObjects, null, 2))
  console.log(`  scan_objects.json  (${scanObjects.length} objects)`)

  console.log(`Done → public/models/${slug}/`)
}

main().catch(err => { console.error(err); process.exit(1) })
