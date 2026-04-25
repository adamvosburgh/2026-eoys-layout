import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { v4 as uuidv4 } from 'uuid'

import { RoomScene } from './scene/RoomScene.js'
import { RoomLoader } from './scene/RoomLoader.js'
import { Grid } from './scene/Grid.js'
import { AssetObject } from './scene/AssetObject.js'
import { DrawTool } from './scene/DrawTool.js'
import { LabelManager } from './scene/LabelManager.js'
import { Projector } from './scene/Projector.js'
import { snap, GRID_UNIT } from './scene/Snapping.js'

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
const { scene, camera, renderer, controls, composer } = roomScene

const roomLoader = new RoomLoader(scene)
const grid = new Grid(scene)
const labelManager = new LabelManager(sceneContainer, camera, scene)
const tooltip = new Tooltip()

const gltfLoader = new GLTFLoader()

// Active objects tracked locally: id → AssetObject | Projector
const liveObjects = new Map()

let currentMeta = null
let drawTool = null
let drawMode = null

// ─── Rooms ──────────────────────────────────────────────────────────────────

async function loadRoom(slug) {
  // Disconnect old Yjs, clear scene objects
  disconnect()
  for (const obj of liveObjects.values()) obj.dispose()
  liveObjects.clear()
  labelManager._labels.forEach((_, id) => labelManager.remove(id))

  // Load meta first, then GLB (loader uses meta for ceiling detection)
  const meta = await fetch(`/models/${slug}/meta.json`).then(r => r.json())
  await roomLoader.load(slug)
  currentMeta = meta

  grid.build() // grid lives in the shader — no geometry to build
  roomScene.focusRoom(meta)

  // Connect Yjs
  const { objectsMap, visibilityMap } = connect(slug)

  // Observe scene objects
  objectsMap.observe(() => syncObjectsFromYjs())
  syncObjectsFromYjs()

  // Observe visibility
  visibilityMap.observe(e => {
    e.changes.keys.forEach((_, key) => {
      visToggles.sync(key, visibilityMap.get(key))
    })
  })

  // Awareness cursor rendering
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
    const pos = ymap.get('position') || [0, 0, 0]
    const rot = ymap.get('rotation') || [0, 0, 0]
    const name = ymap.get('name') || ''
    const desc = ymap.get('description') || ''
    const type = ymap.get('type')

    if (liveObjects.has(id)) {
      // Update existing
      const obj = liveObjects.get(id)
      if (obj instanceof Projector) {
        obj.setPosition(...pos)
        obj.setRotationY(rot[1])
      } else if (obj instanceof AssetObject) {
        obj.setPosition(...pos)
        obj.setRotationY(rot[1])
      }
      labelManager.update(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc)
    } else {
      // Create new
      spawnFromYjs(id, type, ymap, pos, rot, name, desc)
    }
  })

  // Remove deleted
  for (const id of liveIds) {
    liveObjects.get(id)?.dispose()
    liveObjects.delete(id)
    labelManager.remove(id)
  }
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
  } else if (type === 'primitive') {
    const geo = ymap.get('geometry') || { w: 0.6096, d: 0.6096, h: 0.9144 }
    const primType = ymap.get('primType') || 'box'
    const mesh = makePrimitiveMesh(primType, geo.w, geo.d, geo.h)
    const obj = new AssetObject({ id, type, name, desc, scene, mesh })
    obj.setPosition(...pos)
    obj.setRotationY(rot[1])
    liveObjects.set(id, obj)
  } else if (type === 'drawn') {
    const geo = ymap.get('geometry') || {}
    const mesh = makeDrawnMesh(geo)
    if (mesh) {
      const obj = new AssetObject({ id, type, name, desc, scene, mesh })
      obj.group.position.set(...pos)
      if (geo.normalDir) {
        obj.group.lookAt(
          pos[0] + geo.normalDir[0],
          pos[1] + geo.normalDir[1],
          pos[2] + geo.normalDir[2]
        )
      }
      liveObjects.set(id, obj)
    }
  } else if (type === 'label') {
    // Labels are just CSS2D — no 3D mesh
    liveObjects.set(id, { dispose: () => {} })
  } else if (type === 'asset') {
    // GLB asset — load from file_path (provided by server)
    const filePath = ymap.get('filePath')
    if (filePath) {
      gltfLoader.loadAsync(filePath).then(gltf => {
        const mesh = gltf.scene
        mesh.layers.set(1)
        const obj = new AssetObject({ id, type, name, description: desc, scene, mesh })
        obj.setPosition(...pos)
        obj.setRotationY(rot[1])
        liveObjects.set(id, obj)
        labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc)
      })
    }
    return
  }
  labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], name, desc)
}

function makePrimitiveMesh(primType, w, d, h) {
  let geo
  if (primType === 'cylinder') {
    geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 16)
  } else if (primType === 'sphere') {
    geo = new THREE.SphereGeometry(w / 2, 16, 12)
  } else {
    geo = new THREE.BoxGeometry(w, h, d)
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xcccccc })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  return mesh
}

function makeDrawnMesh(geo) {
  if (geo.type === 'floor') {
    const g = new THREE.BoxGeometry(geo.w, Math.max(geo.h || 0.01, 0.01), geo.d)
    const m = new THREE.MeshLambertMaterial({ color: 0xbbbbff, transparent: true, opacity: 0.5 })
    return new THREE.Mesh(g, m)
  } else if (geo.type === 'wall') {
    const g = new THREE.BoxGeometry(geo.w, geo.h, Math.max(geo.d || 0.01, 0.01))
    const m = new THREE.MeshLambertMaterial({ color: 0xffbbbb, transparent: true, opacity: 0.5 })
    return new THREE.Mesh(g, m)
  }
  return null
}

// ─── Placing Objects ─────────────────────────────────────────────────────────

function placeAsset(asset) {
  const id = uuidv4()
  const pos = [
    snap(camera.position.x),
    0,
    snap(camera.position.z),
  ]
  const fields = {
    type: asset.category === 'projector' ? 'projector' : 'asset',
    assetId: asset.id,
    filePath: asset.file_path ? `/api/asset-file/${asset.id}` : null,
    name: asset.name,
    description: asset.description || '',
    position: pos,
    rotation: [0, 0, 0],
    createdBy: getAwareness()?.clientID?.toString() || '',
  }
  upsertObject(id, fields)
}

function placePrimitive({ primType, w, d, h }) {
  promptLabel(name => {
    const id = uuidv4()
    const pos = [0, 0, 0]
    upsertObject(id, {
      type: 'primitive',
      primType,
      geometry: { w, d, h },
      name,
      description: '',
      position: pos,
      rotation: [0, 0, 0],
      createdBy: getAwareness()?.clientID?.toString() || '',
    })
  })
}

function placeDrawnShape(shape, normal, mode) {
  promptLabel(name => {
    const id = uuidv4()
    const pos = [shape.cx, shape.cy, shape.cz]
    const normalDir = normal ? [normal.x, normal.y, normal.z] : [0, 1, 0]
    upsertObject(id, {
      type: 'drawn',
      geometry: { ...shape, normalDir },
      name,
      description: '',
      position: pos,
      rotation: [0, 0, 0],
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
    if (!name) {
      overlay.querySelector('#dlg-name').focus()
      return
    }
    close()
    onConfirm(name)
  })
}

// ─── Interaction (drag, select, delete) ─────────────────────────────────────

let selected = null
let dragging = false
let dragFloorY = 0
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0) return
  if (drawMode) return
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)

  // Test layout objects
  const candidates = []
  for (const [id, obj] of liveObjects) {
    const group = obj.group || obj._group
    if (group) {
      const hits = raycaster.intersectObject(group, true)
      if (hits.length) candidates.push({ id, obj, dist: hits[0].distance })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)

  if (candidates.length) {
    const { id, obj } = candidates[0]
    if (selected && selected !== obj) selected.deselect?.()
    selected = obj
    obj.select?.()
    dragging = true
    controls.enabled = false

    // Compute floor Y for drag plane
    const group = obj.group || obj
    dragFloorY = group.position?.y || 0
    floorPlane.constant = -dragFloorY
  } else {
    selected?.deselect?.()
    selected = null
  }
})

renderer.domElement.addEventListener('pointermove', e => {
  if (!dragging || !selected) return
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)
  const pt = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(floorPlane, pt)) {
    const group = selected.group || selected
    if (!group) return
    const id = group.userData?.assetObjectId
    if (!id) return
    const pos = [snap(pt.x), dragFloorY, snap(pt.z)]
    if (selected.setPosition) selected.setPosition(...pos)
    upsertObject(id, { position: pos })
  }

  // Projector tooltip on hover
  checkProjectorTooltip(e)
})

renderer.domElement.addEventListener('pointerup', () => {
  dragging = false
  controls.enabled = !drawMode
})

renderer.domElement.addEventListener('contextmenu', e => {
  e.preventDefault()
  if (!selected) return
  const group = selected.group || selected
  const id = group?.userData?.assetObjectId
  if (!id) return
  if (confirm('Delete this object?')) {
    selected.dispose?.()
    liveObjects.delete(id)
    labelManager.remove(id)
    removeObject(id)
    selected = null
  }
})

function setMouse(e) {
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

// ─── Projector tooltip ────────────────────────────────────────────────────────

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
      const mat = new THREE.MeshBasicMaterial({ color: user.color || 0x00ff00 })
      dot = new THREE.Mesh(geo, mat)
      dot.layers.set(1)
      scene.add(dot)
      cursorDots.set(clientId, dot)
    }

    if (user.cursor) {
      dot.position.set(...user.cursor)
      dot.visible = true
    } else {
      dot.visible = false
    }
  })

  // Remove departed clients
  for (const [id, dot] of cursorDots) {
    if (!seenIds.has(id)) {
      scene.remove(dot)
      cursorDots.delete(id)
    }
  }
}

// ─── Draw tool ───────────────────────────────────────────────────────────────

function enableDrawMode(mode) {
  drawMode = mode
  if (!drawTool) {
    drawTool = new DrawTool(scene, camera, renderer, () => roomLoader.getAllRoomMeshes())
    drawTool.onShapeComplete = (shape, normal, mode) => {
      placeDrawnShape(shape, normal, mode)
    }
  }
  if (mode) {
    drawTool.enable(mode)
    controls.enabled = false
  } else {
    drawTool.disable()
    controls.enabled = true
  }
}

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
      // Scale to fit bounding box
      const box = new THREE.Box3().setFromObject(mesh)
      const size = new THREE.Vector3()
      box.getSize(size)
      const scale = Math.min(w / size.x, h / size.y, d / size.z)
      mesh.scale.setScalar(scale)
      mesh.layers.set(1)

      promptLabel(name => {
        const id = uuidv4()
        // Session-only: don't sync GLB data — just position/name
        upsertObject(id, {
          type: 'primitive',
          primType: 'upload',
          geometry: { w, d, h },
          name,
          description: '',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          createdBy: getAwareness()?.clientID?.toString() || '',
        })
        // Spawn locally (session-only)
        const obj = new AssetObject({ id, type: 'primitive', name, description: '', scene, mesh })
        liveObjects.set(id, obj)
        labelManager.add(id, [0, 0.3, 0], name)
      })
    })
  }
})
sidebar.addPanel('create', 'Create', createPanelEl)

const drawPanelEl = document.createElement('div')
const drawPanel = new DrawPanel(drawPanelEl, mode => enableDrawMode(mode))
sidebar.addPanel('draw', 'Draw', drawPanelEl)

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

// ─── Render loop label update ─────────────────────────────────────────────────

roomScene.onFrame(() => {
  labelManager.render()

  // Update awareness cursor position
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
    padding: 12px 16px; font-family: 'Roboto Mono', monospace; font-size: 11px;
    display: flex; flex-direction: column; gap: 6px; min-width: 260px;
  `

  const title = document.createElement('div')
  title.textContent = 'LIGHT DEBUG'
  title.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;border-bottom:1px solid #000;padding-bottom:4px;'
  panel.appendChild(title)

  function slider(label, min, max, step, getValue, setValue) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:8px;'
    const lbl = document.createElement('span')
    lbl.style.cssText = 'width:120px;flex-shrink:0;'
    const val = document.createElement('span')
    val.style.cssText = 'width:36px;text-align:right;'
    const inp = document.createElement('input')
    inp.type = 'range'
    inp.min = min; inp.max = max; inp.step = step
    inp.value = getValue()
    inp.style.cssText = 'flex:1;cursor:pointer;'
    val.textContent = Number(getValue()).toFixed(2)
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value)
      setValue(v)
      val.textContent = v.toFixed(2)
    })
    lbl.textContent = label
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(val)
    panel.appendChild(row)
  }

  slider('Exposure', 0, 2, 0.05, () => roomScene.renderer.toneMappingExposure, v => roomScene.renderer.toneMappingExposure = v)

  const close = document.createElement('button')
  close.textContent = 'close'
  close.style.cssText = 'margin-top:6px;border:1px solid #000;background:#fff;cursor:pointer;font-family:inherit;font-size:10px;padding:2px 8px;text-transform:uppercase;letter-spacing:.05em;align-self:flex-end;'
  close.addEventListener('click', () => panel.remove())
  panel.appendChild(close)

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
