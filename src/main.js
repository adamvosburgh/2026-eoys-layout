import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { v4 as uuidv4 } from 'uuid'

import { RoomScene } from './scene/RoomScene.js'
import { RoomLoader } from './scene/RoomLoader.js'
import { Grid } from './scene/Grid.js'
import { AssetObject, SEL_MAT } from './scene/AssetObject.js'
import { DrawnShape } from './scene/DrawnShape.js'
import { DrawTool } from './scene/DrawTool.js'
import { LabelManager } from './scene/LabelManager.js'
import { Projector } from './scene/Projector.js'
import { snap, GRID_UNIT, metersToFeetInches } from './scene/Snapping.js'
import { SurfaceFrame } from './scene/SurfaceFrame.js'

import { RoomSwitcher } from './ui/RoomSwitcher.js'
import { Sidebar } from './ui/Sidebar.js'
import { AssetPanel } from './ui/AssetPanel.js'
import { CreatePanel } from './ui/CreatePanel.js'
import { DrawPanel } from './ui/DrawPanel.js'
import { VisibilityToggles } from './ui/VisibilityToggles.js'
import { Tooltip } from './ui/Tooltip.js'

import {
  connect, disconnect, getObjects, getVisibility, getAwareness,
  upsertObject, removeObject,
} from './collab/sync.js'

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const sceneContainer = document.getElementById('scene-container')
const roomScene = new RoomScene(sceneContainer)
const { scene, camera, renderer, controls } = roomScene

const roomLoader = new RoomLoader(scene)
const grid = new Grid(scene)
const labelManager = new LabelManager(sceneContainer, camera, scene)
const tooltip = new Tooltip()

const gltfLoader = new GLTFLoader()

// Shared color refs — debug panel mutates these live
const COLORS = {
  drawnFloor: new THREE.Color(0xbbbbff),
  drawnWall:  new THREE.Color(0xffbbbb),
  primitive:  new THREE.Color(0xcccccc),
  cursor:     new THREE.Color(0x00ff00),
}

const liveObjects = new Map()  // id → AssetObject | DrawnShape | Projector

let currentMeta = null
let drawTool = null
let drawMode = null

// ─── Rooms ──────────────────────────────────────────────────────────────────

async function loadRoom(slug) {
  disconnect()
  for (const obj of liveObjects.values()) obj.dispose?.()
  liveObjects.clear()
  labelManager._labels.forEach((_, id) => labelManager.remove(id))
  selected = hovered = null

  const meta = await fetch(`/models/${slug}/meta.json`).then(r => r.json())
  await roomLoader.load(slug)
  currentMeta = meta

  const gridSurfaces = roomLoader.getAllRoomMeshes()
    .filter(m => !m.name.toLowerCase().startsWith('door_'))
  grid.build(gridSurfaces)
  roomScene.focusRoom(meta)

  const { objectsMap, visibilityMap } = connect(slug)
  objectsMap.observe(() => syncObjectsFromYjs())
  syncObjectsFromYjs()

  visibilityMap.observe(e => {
    e.changes.keys.forEach((_, key) => visToggles.sync(key, visibilityMap.get(key)))
  })

  const awareness = getAwareness()
  awareness.on('change', () => renderAwarenessCursors(awareness))
}

// ─── Yjs → Scene ────────────────────────────────────────────────────────────

function syncObjectsFromYjs() {
  const objectsMap = getObjects()
  if (!objectsMap) return
  const liveIds = new Set(liveObjects.keys())

  objectsMap.forEach((ymap, id) => {
    liveIds.delete(id)
    const type = ymap.get('type')
    const name = ymap.get('name') || ''
    const desc = ymap.get('description') || ''
    const pos  = ymap.get('position') || [0, 0, 0]
    const rot  = ymap.get('rotation') || [0, 0, 0]

    if (liveObjects.has(id)) {
      const obj = liveObjects.get(id)
      if (obj instanceof DrawnShape) {
        const g = ymap.get('geometry') || {}
        if (g.centerWorld) obj.setCenterWorld(...g.centerWorld)
        if ((g.extrude || 0) !== (obj.desc.extrude || 0)) obj.setExtrude(g.extrude || 0)
        labelManager.update(id, labelPosFor(obj), name, desc)
      } else if (obj instanceof Projector || obj instanceof AssetObject) {
        obj.setPosition(...pos)
        obj.setRotationY(rot[1])
        labelManager.update(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc)
      }
    } else {
      spawnFromYjs(id, type, ymap, pos, rot, name, desc)
    }
  })

  for (const id of liveIds) {
    const obj = liveObjects.get(id)
    if (obj === selected)  selected = null
    if (obj === hovered)   hovered  = null
    obj?.dispose?.()
    liveObjects.delete(id)
    labelManager.remove(id)
  }
}

function deleteObject(id) {
  const obj = liveObjects.get(id)
  if (obj) {
    if (obj === selected) selected = null
    if (obj === hovered)  hovered  = null
    obj.dispose?.()
    liveObjects.delete(id)
  }
  labelManager.remove(id)
  removeObject(id)
}

function labelPosFor(obj) {
  if (obj instanceof DrawnShape) {
    const wp = obj.worldOrigin()
    const out = obj.worldOutwardDir().multiplyScalar(0.05)
    return [wp.x + out.x, wp.y + out.y + 0.05, wp.z + out.z]
  }
  const p = obj.group.position
  return [p.x, p.y + 0.3, p.z]
}

function spawnFromYjs(id, type, ymap, pos, rot, name, desc) {
  if (type === 'projector') {
    const proj = new Projector({
      id, scene,
      getRoomMeshes: () => roomLoader.getAllRoomMeshes(),
    })
    proj.setPosition(...pos)
    proj.setRotationY(rot[1])
    liveObjects.set(id, proj)
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc, deleteObject)
    return
  }

  if (type === 'primitive') {
    const geo = ymap.get('geometry') || { w: 0.6096, d: 0.6096, h: 0.9144 }
    const primType = ymap.get('primType') || 'box'
    const mesh = makePrimitiveMesh(primType, geo.w, geo.d, geo.h)
    const obj = new AssetObject({ id, type, name, desc, scene, mesh })
    obj.setPosition(...pos)
    obj.setRotationY(rot[1])
    liveObjects.set(id, obj)
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc, deleteObject)
    return
  }

  if (type === 'drawn') {
    const g = ymap.get('geometry') || {}
    const parentMesh = roomLoader.getAllRoomMeshes().find(m => m.name === g.parentName) || null
    const obj = new DrawnShape({ id, scene, desc: g, colorRefs: COLORS, parentMesh })
    liveObjects.set(id, obj)
    labelManager.add(id, labelPosFor(obj), name, desc, deleteObject)
    if (id === pendingSelectId) {
      pendingSelectId = null
      if (selected) selected.deselect?.()
      selected = obj
      obj.select()
    }
    return
  }

  if (type === 'label') {
    liveObjects.set(id, { dispose: () => {} })
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc, deleteObject)
    return
  }

  if (type === 'asset') {
    const filePath = ymap.get('filePath')
    if (filePath) {
      gltfLoader.loadAsync(filePath).then(gltf => {
        const mesh = gltf.scene
        mesh.layers.set(1)
        const obj = new AssetObject({ id, type, name, description: desc, scene, mesh })
        obj.setPosition(...pos)
        obj.setRotationY(rot[1])
        liveObjects.set(id, obj)
        labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc, deleteObject)
      })
    }
    return
  }
}

function makePrimitiveMesh(primType, w, d, h) {
  let geo
  if (primType === 'cylinder') geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 16)
  else if (primType === 'sphere') geo = new THREE.SphereGeometry(w / 2, 16, 12)
  else geo = new THREE.BoxGeometry(w, h, d)
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.primitive.getHex() })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  return mesh
}

// ─── Placing Objects ─────────────────────────────────────────────────────────

function placeAsset(asset) {
  const id = uuidv4()
  upsertObject(id, {
    type: asset.category === 'projector' ? 'projector' : 'asset',
    assetId: asset.id,
    filePath: asset.file_path ? `/api/asset-file/${asset.id}` : null,
    name: asset.name,
    description: asset.description || '',
    position: [snap(camera.position.x), 0, snap(camera.position.z)],
    rotation: [0, 0, 0],
    createdBy: getAwareness()?.clientID?.toString() || '',
  })
}

function placePrimitive({ primType, w, d, h }) {
  promptLabel(name => {
    upsertObject(uuidv4(), {
      type: 'primitive',
      primType,
      geometry: { w, d, h },
      name, description: '',
      position: [0, 0, 0], rotation: [0, 0, 0],
      createdBy: getAwareness()?.clientID?.toString() || '',
    })
  })
}

let pendingSelectId = null

function placeDrawnShape(desc) {
  promptLabel(name => {
    const id = uuidv4()
    pendingSelectId = id
    upsertObject(id, {
      type: 'drawn',
      geometry: desc,
      name, description: '',
      position: [0, 0, 0], rotation: [0, 0, 0],
      createdBy: getAwareness()?.clientID?.toString() || '',
    })
  })
}

// ─── Label dialog ────────────────────────────────────────────────────────────

function promptLabel(onConfirm) {
  const overlay = document.createElement('div')
  overlay.className = 'dialog-overlay'
  overlay.innerHTML = `
    <div class="dialog">
      <h2>Name this object</h2>
      <label>Name (required)</label>
      <input type="text" id="dlg-name" placeholder="e.g. Drawing 1" />
      <label>Description (optional)</label>
      <input type="text" id="dlg-desc" placeholder="" />
      <div class="dialog-actions">
        <button class="btn" id="dlg-cancel">Cancel</button>
        <button class="btn primary" id="dlg-ok">Place</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('#dlg-name').focus()
  const close = () => document.body.removeChild(overlay)
  overlay.querySelector('#dlg-cancel').addEventListener('click', close)
  overlay.querySelector('#dlg-ok').addEventListener('click', () => {
    const name = overlay.querySelector('#dlg-name').value.trim()
    if (!name) { overlay.querySelector('#dlg-name').focus(); return }
    close()
    onConfirm(name)
  })
}

// ─── Interaction ─────────────────────────────────────────────────────────────

let selected = null
let hovered  = null
let dragging = false        // moving an object
let extruding = null        // { shape, initialOffset, initialExtrude }
let dragSurface = null      // for non-drawn assets: { plane, y } for floor-plane drag
const raycaster = new THREE.Raycaster()
raycaster.layers.enableAll()
const mouse = new THREE.Vector2()

function setMouse(e) {
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

/** Raycast all selectable user objects (groups), return closest hit (with obj). */
function pickUserObject() {
  let best = null
  for (const [id, obj] of liveObjects) {
    const group = obj.group
    if (!group || !group.visible) continue
    const hits = raycaster.intersectObject(group, true)
    if (!hits.length) continue
    const h = hits[0]
    if (!best || h.distance < best.dist) best = { id, obj, dist: h.distance, hit: h }
  }
  return best
}

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0) return
  if (drawMode) return
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)

  const pick = pickUserObject()
  if (!pick) {
    if (selected) { selected.deselect?.(); selected = null }
    return
  }

  // Extrude handle?
  if (pick.hit.object.userData?.isExtrudeHandle) {
    const target = liveObjects.get(pick.hit.object.userData.targetId)
    if (target instanceof DrawnShape) {
      const t0 = projectRayOntoOutwardLine(target)
      if (t0 !== null) {
        extruding = {
          shape: target,
          initialOffset: t0 - (target.desc.extrude || 0),
        }
        controls.enabled = false
        return
      }
    }
  }

  // Regular select + drag
  if (selected && selected !== pick.obj) selected.deselect?.()
  selected = pick.obj
  selected.select?.()

  dragging = true
  controls.enabled = false

  // Set up drag plane for non-drawn assets
  if (!(selected instanceof DrawnShape)) {
    const y = (selected.group?.position?.y) || 0
    dragSurface = { plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), y }
  } else {
    dragSurface = null
  }
})

renderer.domElement.addEventListener('pointermove', e => {
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)

  // Grid hover (draw mode)
  if (drawMode) {
    const hits = raycaster.intersectObjects(roomLoader.getAllRoomMeshes(), false)
    if (hits.length) grid.showHover(hits[0])
    else             grid.hideHover()
    return
  }

  // Extrude drag
  if (extruding) {
    const t = projectRayOntoOutwardLine(extruding.shape)
    if (t !== null) {
      const raw = t - extruding.initialOffset
      const newExt = Math.max(Math.round(raw / GRID_UNIT) * GRID_UNIT, 0)
      if (newExt !== extruding.shape.desc.extrude) {
        extruding.shape.setExtrude(newExt)
        labelManager.update(extruding.shape.id,
          labelPosFor(extruding.shape),
          ymapName(extruding.shape.id), '')
        upsertObject(extruding.shape.id, { geometry: extruding.shape.desc })
      }
      sizeLabel.show(`extrude: ${metersToFeetInches(extruding.shape.desc.extrude)}`, [e.clientX, e.clientY])
    }
    return
  }

  // Object drag
  if (dragging && selected) {
    if (selected instanceof DrawnShape) {
      const parent = selected.parentMesh
      if (!parent) return
      const hits = raycaster.intersectObject(parent, false)
      if (!hits.length) return

      // Build a SurfaceFrame from this hit (world-space). Project the hit point
      // onto (U, V), snap so the shape's MIN corner lands on a grid line —
      // this preserves the rectangle's existing dimensions while snapping.
      const f = new SurfaceFrame(hits[0])
      const [u, v] = f.to2D(hits[0].point)
      const w = selected.desc.width, h = selected.desc.height
      const minU = Math.round((u - w / 2) / GRID_UNIT) * GRID_UNIT
      const minV = Math.round((v - h / 2) / GRID_UNIT) * GRID_UNIT
      const newCenter = f.to3DWorld(minU + w / 2, minV + h / 2)

      const cw = selected.desc.centerWorld
      if (cw[0] !== newCenter.x || cw[1] !== newCenter.y || cw[2] !== newCenter.z) {
        selected.setCenterWorld(newCenter.x, newCenter.y, newCenter.z)
        labelManager.update(selected.id, labelPosFor(selected), ymapName(selected.id), '')
        upsertObject(selected.id, { geometry: selected.desc })
      }
    } else if (dragSurface) {
      const pt = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(dragSurface.plane, pt)) {
        const id = selected.group?.userData?.assetObjectId
        if (id) {
          const pos = [snap(pt.x), dragSurface.y, snap(pt.z)]
          selected.setPosition?.(...pos)
          labelManager.update(id, [pos[0], pos[1] + 0.3, pos[2]], ymapName(id), '')
          upsertObject(id, { position: pos })
        }
      }
    }
    checkProjectorTooltip(e)
    return
  }

  // Hover (no drag, no draw)
  const pick = pickUserObject()
  const newHover = pick?.obj || null
  if (newHover !== hovered) {
    if (hovered && hovered !== selected) hovered.hoverOff?.()
    hovered = newHover
    if (hovered && hovered !== selected) hovered.hoverOn?.()
  }
  // Cursor: special pointer over extrude handle, move pointer over body
  if (pick?.hit?.object?.userData?.isExtrudeHandle) {
    renderer.domElement.style.cursor = 'ns-resize'
  } else if (pick) {
    renderer.domElement.style.cursor = 'grab'
  } else {
    renderer.domElement.style.cursor = ''
  }
  checkProjectorTooltip(e)
})

renderer.domElement.addEventListener('pointerup', () => {
  dragging = false
  extruding = null
  dragSurface = null
  sizeLabel.hide()
  controls.enabled = !drawMode
})

renderer.domElement.addEventListener('pointerleave', () => {
  grid.hideHover()
  if (hovered && hovered !== selected) { hovered.hoverOff?.(); hovered = null }
})

window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    const id = selected.group?.userData?.assetObjectId || selected.id
    if (id) deleteObject(id)
  }
  if (e.key === 'Escape' && selected) {
    selected.deselect?.()
    selected = null
  }
})

/** Distance along the shape's outward axis at which the mouse ray is closest. */
function projectRayOntoOutwardLine(shape) {
  const origin = shape.worldOrigin()
  const dir = shape.worldOutwardDir().normalize()
  const ro = raycaster.ray.origin
  const rd = raycaster.ray.direction
  const w  = ro.clone().sub(origin)
  const a = rd.dot(rd)
  const b = rd.dot(dir)
  const c = dir.dot(dir)
  const d = rd.dot(w)
  const e = dir.dot(w)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-6) return null
  return (a * e - b * d) / denom
}

function ymapName(id) {
  return getObjects()?.get(id)?.get('name') || ''
}

// ─── Projector tooltip ───────────────────────────────────────────────────────

function checkProjectorTooltip(e) {
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)
  for (const obj of liveObjects.values()) {
    if (obj instanceof Projector) {
      const hits = raycaster.intersectObject(obj.projectionMesh, false)
      if (hits.length) {
        tooltip.show('Projected surface is for representational purposes only.', e.clientX, e.clientY)
        return
      }
    }
  }
  tooltip.hide()
}

// ─── Awareness cursors ────────────────────────────────────────────────────────

const cursorDots = new Map()

function renderAwarenessCursors(awareness) {
  const states = awareness.getStates()
  const seenIds = new Set()
  states.forEach((state, clientId) => {
    if (clientId === awareness.clientID) return
    const user = state.user
    if (!user) return
    seenIds.add(clientId)

    let dot = cursorDots.get(clientId)
    if (!dot) {
      const geo = new THREE.SphereGeometry(0.05, 8, 6)
      const mat = new THREE.MeshBasicMaterial({ color: user.color || COLORS.cursor.getHex() })
      dot = new THREE.Mesh(geo, mat)
      dot.layers.set(1)
      scene.add(dot)
      cursorDots.set(clientId, dot)
    }
    if (user.cursor) { dot.position.set(...user.cursor); dot.visible = true }
    else dot.visible = false
  })
  for (const [id, dot] of cursorDots) {
    if (!seenIds.has(id)) { scene.remove(dot); cursorDots.delete(id) }
  }
}

// ─── Draw tool ───────────────────────────────────────────────────────────────

function enableDrawMode(mode) {
  if (drawMode === mode) return
  if (!drawTool) {
    drawTool = new DrawTool(scene, camera, renderer, () => roomLoader.getAllRoomMeshes())
    drawTool.onShapeComplete = desc => placeDrawnShape(desc)
    drawTool.onSizeChange = (w, h, m, screenXY) => {
      if (w == null) sizeLabel.hide()
      else           sizeLabel.show(`${metersToFeetInches(w)} × ${metersToFeetInches(h)}`, screenXY)
    }
  }
  drawTool.disable()
  drawMode = mode
  if (mode) {
    drawTool.enable(mode)
    controls.enabled = false
  } else {
    controls.enabled = true
    grid.hideHover()
    sizeLabel.hide()
  }
}

// ─── Size label overlay (used during draw + extrude) ─────────────────────────

const sizeLabel = (() => {
  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed; pointer-events: none; z-index: 1000;
    background: #000; color: #fff; padding: 3px 8px;
    font-family: 'Roboto Mono', monospace; font-size: 11px;
    transform: translate(12px, 12px); display: none; white-space: nowrap;
  `
  document.body.appendChild(el)
  return {
    show(text, xy) {
      el.textContent = text
      if (xy) { el.style.left = xy[0] + 'px'; el.style.top = xy[1] + 'px' }
      el.style.display = 'block'
    },
    hide() { el.style.display = 'none' },
  }
})()

// ─── UI wiring ────────────────────────────────────────────────────────────────

const roomSwitcher = new RoomSwitcher(
  document.getElementById('room-switcher'),
  slug => loadRoom(slug)
)

const sidebar = new Sidebar(
  document.getElementById('sidebar-icons'),
  document.getElementById('sidebar-panels')
)

const assetPanelEl = document.createElement('div')
const assetPanel = new AssetPanel(assetPanelEl, placeAsset)
sidebar.addPanel('assets', 'Assets', assetPanelEl)

const createPanelEl = document.createElement('div')
const createPanel = new CreatePanel(createPanelEl, ({ kind, primType, w, d, h, file }) => {
  if (kind === 'primitive') {
    placePrimitive({ primType, w, d, h })
  } else if (kind === 'upload' && file) {
    const url = URL.createObjectURL(file)
    gltfLoader.loadAsync(url).then(gltf => {
      const mesh = gltf.scene
      const box = new THREE.Box3().setFromObject(mesh)
      const size = new THREE.Vector3(); box.getSize(size)
      const scale = Math.min(w / size.x, h / size.y, d / size.z)
      mesh.scale.setScalar(scale)
      mesh.layers.set(1)
      promptLabel(name => {
        const id = uuidv4()
        upsertObject(id, {
          type: 'primitive', primType: 'upload',
          geometry: { w, d, h },
          name, description: '',
          position: [0, 0, 0], rotation: [0, 0, 0],
          createdBy: getAwareness()?.clientID?.toString() || '',
        })
        const obj = new AssetObject({ id, type: 'primitive', name, description: '', scene, mesh })
        liveObjects.set(id, obj)
        labelManager.add(id, [0, 0.3, 0], name, '', deleteObject)
      })
    })
  }
})
sidebar.addPanel('create', 'Create', createPanelEl)

const drawPanelEl = document.createElement('div')
const drawPanel = new DrawPanel(drawPanelEl, mode => enableDrawMode(mode))
sidebar.addPanel('draw', 'Draw', drawPanelEl, () => drawPanel.deactivate())

const visToggles = new VisibilityToggles(
  document.getElementById('visibility-toggles'),
  {
    grid: v => grid.setVisible(v),
    labels: v => labelManager.setVisible(v),
    objects: v => {
      for (const obj of liveObjects.values()) {
        const group = obj.group
        if (group) group.visible = v
      }
    },
  }
)

// ─── Render loop label update + awareness cursor ─────────────────────────────

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
roomScene.onFrame(() => {
  labelManager.render()

  const awareness = getAwareness()
  if (awareness) {
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(floorPlane, pt)) {
      awareness.setLocalStateField('user', {
        ...awareness.getLocalState()?.user,
        cursor: [pt.x, pt.y, pt.z],
      })
    }
  }
})

// ─── Debug panel ─────────────────────────────────────────────────────────────

function buildDebugPanel() {
  const panel = document.createElement('div')
  panel.id = 'debug-panel'
  panel.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; z-index: 999;
    background: rgba(255,255,255,0.95); border: 1px solid #000;
    font-family: 'Roboto Mono', monospace; font-size: 11px; min-width: 280px;
  `
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #000;cursor:pointer;user-select:none;'
  header.innerHTML = `<span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;">Colors</span><span id="dbg-toggle" style="font-size:10px;">[ − ]</span>`
  panel.appendChild(header)

  const body = document.createElement('div')
  body.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:6px;'
  panel.appendChild(body)

  let collapsed = false
  header.addEventListener('click', () => {
    collapsed = !collapsed
    body.style.display = collapsed ? 'none' : 'flex'
    panel.querySelector('#dbg-toggle').textContent = collapsed ? '[ + ]' : '[ − ]'
  })

  const hexFromColor = c => '#' + c.getHexString()

  function row(label, getHex, onChange) {
    const r = document.createElement('div')
    r.style.cssText = 'display:flex;align-items:center;gap:8px;'
    const lbl = document.createElement('span'); lbl.style.cssText = 'flex:1;'; lbl.textContent = label
    const code = document.createElement('span'); code.style.cssText = 'opacity:.6;font-size:10px;width:64px;text-align:right;'
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = getHex()
    inp.style.cssText = 'width:32px;height:20px;border:1px solid #000;background:none;cursor:pointer;padding:0;'
    code.textContent = inp.value
    inp.addEventListener('input', () => { onChange(inp.value); code.textContent = inp.value })
    r.appendChild(lbl); r.appendChild(code); r.appendChild(inp)
    body.appendChild(r)
  }

  row('Background',  () => hexFromColor(scene.background),                v => scene.background.set(v))
  row('Grid stroke', () => hexFromColor(grid._mat.uniforms.uColor.value),  v => grid._mat.uniforms.uColor.value.set(v))
  row('Grid hover',  () => hexFromColor(grid._hoverMat.color),             v => grid._hoverMat.color.set(v))
  row('Selection',   () => hexFromColor(SEL_MAT.color),                    v => SEL_MAT.color.set(v))
  row('Cursor',      () => hexFromColor(COLORS.cursor),                    v => {
    COLORS.cursor.set(v)
    for (const dot of cursorDots.values()) dot.material.color.set(v)
  })
  row('Drawn — Floor', () => hexFromColor(COLORS.drawnFloor), v => COLORS.drawnFloor.set(v))
  row('Drawn — Wall',  () => hexFromColor(COLORS.drawnWall),  v => COLORS.drawnWall.set(v))
  row('Primitive',     () => hexFromColor(COLORS.primitive),  v => COLORS.primitive.set(v))

  const note = document.createElement('div')
  note.style.cssText = 'margin-top:6px;font-size:9px;opacity:.55;line-height:1.4;'
  note.textContent = 'Drawn/Primitive: applies to NEW objects only.'
  body.appendChild(note)

  // Camera section
  const camHeader = document.createElement('div')
  camHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid #000;border-bottom:1px solid #000;cursor:pointer;user-select:none;'
  camHeader.innerHTML = `<span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;">Camera</span><span id="cam-toggle" style="font-size:10px;">[ + ]</span>`
  panel.appendChild(camHeader)

  const camBody = document.createElement('div')
  camBody.style.cssText = 'padding:10px 12px;display:none;flex-direction:column;gap:6px;'
  panel.appendChild(camBody)

  let camCollapsed = true
  camHeader.addEventListener('click', () => {
    camCollapsed = !camCollapsed
    camBody.style.display = camCollapsed ? 'none' : 'flex'
    panel.querySelector('#cam-toggle').textContent = camCollapsed ? '[ + ]' : '[ − ]'
  })

  function readout(label) {
    const r = document.createElement('div')
    r.style.cssText = 'display:flex;align-items:center;gap:8px;'
    const lbl = document.createElement('span'); lbl.style.cssText = 'flex:0 0 50px;'; lbl.textContent = label
    const val = document.createElement('span'); val.style.cssText = 'flex:1;font-size:10px;opacity:.8;'
    r.appendChild(lbl); r.appendChild(val)
    camBody.appendChild(r)
    return val
  }

  const camPosOut    = readout('pos')
  const camTargetOut = readout('target')
  const camUpdate = () => {
    const p = camera.position, t = controls.target
    camPosOut.textContent    = `${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}`
    camTargetOut.textContent = `${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)}`
  }
  camUpdate()
  controls.addEventListener('change', camUpdate)
  // Also update on every frame so WASD movement is reflected
  setInterval(camUpdate, 200)

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;'
  const copyBtn = document.createElement('button')
  copyBtn.textContent = 'copy values'
  copyBtn.style.cssText = 'flex:1;border:1px solid #000;background:#fff;cursor:pointer;font-family:inherit;font-size:10px;padding:4px 6px;text-transform:uppercase;letter-spacing:.05em;'
  copyBtn.addEventListener('click', () => {
    const p = camera.position, t = controls.target
    navigator.clipboard?.writeText(
      `position: [${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]\ntarget:   [${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)}]`
    )
    copyBtn.textContent = 'copied!'
    setTimeout(() => copyBtn.textContent = 'copy values', 900)
  })
  btnRow.appendChild(copyBtn)
  const logBtn = document.createElement('button')
  logBtn.textContent = 'log'
  logBtn.style.cssText = copyBtn.style.cssText
  logBtn.addEventListener('click', () => {
    const p = camera.position, t = controls.target
    console.log('camera position:', [p.x, p.y, p.z], 'target:', [t.x, t.y, t.z])
  })
  btnRow.appendChild(logBtn)
  camBody.appendChild(btnRow)

  // Controls help
  const help = document.createElement('div')
  help.style.cssText = 'margin-top:8px;font-size:9px;opacity:.55;line-height:1.5;'
  help.innerHTML = 'WASD/Arrows: move &nbsp; Q/Space: up &nbsp; E: down<br>Shift: faster &nbsp; LMB: orbit &nbsp; RMB: pan &nbsp; Wheel: zoom'
  camBody.appendChild(help)

  document.body.appendChild(panel)
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const res = await fetch('/api/rooms')
  const rooms = await res.json()
  if (!rooms.length) {
    document.getElementById('scene-container').innerHTML =
      '<p style="padding:40px;font-family:monospace">No rooms found. Run the processing pipeline first.</p>'
    return
  }
  roomSwitcher.render(rooms)
  await loadRoom(rooms[0].slug)
  await assetPanel.refresh()
  buildDebugPanel()
}

init()
