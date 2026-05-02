// ─── Feature flags ───────────────────────────────────────────────────────────
const ENABLE_DEBUG_PANEL = false
const ENABLE_KEYSTONE    = false

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
import { CommentPanel } from './ui/CommentPanel.js'
import { VisibilityToggles } from './ui/VisibilityToggles.js'
import { Tooltip } from './ui/Tooltip.js'

import {
  connect, disconnect, getObjects, getVisibility, getAwareness,
  upsertObject, removeObject,
  undo, redo, canUndo, canRedo,
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
  drawnFloor:  new THREE.Color(0xbbbbff),
  drawnWall:   new THREE.Color(0xffbbbb),
  primitive:   new THREE.Color(0xcccccc),
  cursor:      new THREE.Color(0x00ff00),
  projSurface: new THREE.Color(0xfffde7),
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
  updateFloorPlane()

  const gridSurfaces = roomLoader.getAllRoomMeshes()
    .filter(m => !m.name.toLowerCase().startsWith('door_'))
  grid.build(gridSurfaces)
  roomScene.focusRoom(meta)
  saveRoomState(slug)
  restoreCamState(slug)

  const { objectsMap, visibilityMap } = connect(slug)
  objectsMap.observeDeep(() => syncObjectsFromYjs())
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
    const type    = ymap.get('type')
    const name    = ymap.get('name') || ''
    const desc    = ymap.get('description') || ''
    const creator = ymap.get('creator') || ''
    const pos     = ymap.get('position') || [0, 0, 0]
    const rot     = ymap.get('rotation') || [0, 0, 0]
    const label   = formatLabel(creator, name)

    const locked = ymap.get('locked') === true

    if (liveObjects.has(id)) {
      const obj = liveObjects.get(id)
      if (obj?.type === 'comment') {
        labelManager.update(id, commentLabelPos(ymap), creator || name, desc)
      } else if (obj instanceof DrawnShape) {
        const g = ymap.get('geometry') || {}
        if (g.centerWorld) obj.setCenterWorld(...g.centerWorld)
        if ((g.extrude || 0) !== (obj.desc.extrude || 0)) obj.setExtrude(g.extrude || 0)
        labelManager.update(id, labelPosFor(obj), label, desc)
      } else if (obj instanceof Projector || obj instanceof AssetObject) {
        obj.setPosition(...pos)
        obj.setRotation ? obj.setRotation(...rot) : obj.setRotationY(rot[1])
        if (obj instanceof Projector) obj.setKeystone(ymap.get('keystone') || 0)
        labelManager.update(id, [pos[0], pos[1] + 0.3, pos[2]], label, desc)
      }
      labelManager.setLocked(id, locked)
    } else {
      spawnFromYjs(id, type, ymap, pos, rot, name, desc, creator)
      labelManager.setLocked(id, locked)
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
  updateUndoButtons()
}

function deleteObject(id) {
  // Delete any comments parented to this object first
  const om = getObjects()
  if (om) {
    const parented = []
    om.forEach((ymap, cid) => {
      if (ymap.get('type') === 'comment' && ymap.get('parentId') === id) parented.push(cid)
    })
    parented.forEach(cid => deleteObject(cid))
  }

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

function commentLabelPos(ymap) {
  const parentId = ymap.get('parentId')
  if (parentId) {
    // Read from Yjs directly — avoids async GLTF timing issues where the
    // Three.js group may not exist yet when syncObjectsFromYjs first runs.
    const parentYmap = getObjects()?.get(parentId)
    if (parentYmap) {
      let px, py, pz
      if (parentYmap.get('type') === 'drawn') {
        const g = parentYmap.get('geometry') || {}
        ;[px, py, pz] = g.centerWorld || [0, 0, 0]
      } else {
        ;[px, py, pz] = parentYmap.get('position') || [0, 0, 0]
      }
      const off = ymap.get('parentOffset') || [0, 0, 0]
      return [px + off[0], py + off[1], pz + off[2]]
    }
  }
  const pos = ymap.get('position') || [0, 0, 0]
  return [pos[0], pos[1], pos[2]]
}

function updateParentedComments(parentId, groupPos) {
  const om = getObjects()
  if (!om) return
  om.forEach((ymap, cid) => {
    if (ymap.get('type') !== 'comment' || ymap.get('parentId') !== parentId) return
    const off = ymap.get('parentOffset') || [0, 0, 0]
    const pos = [groupPos.x + off[0], groupPos.y + off[1], groupPos.z + off[2]]
    labelManager.update(cid, pos, ymap.get('creator') || ymap.get('name') || '', ymap.get('description') || '')
  })
}

function spawnFromYjs(id, type, ymap, pos, rot, name, desc, creator = '') {
  const label = formatLabel(creator, name)

  if (type === 'comment') {
    const commentObj = { dispose: () => labelManager.remove(id), type: 'comment', id }
    liveObjects.set(id, commentObj)
    labelManager.add(
      id, commentLabelPos(ymap),
      creator || name,
      desc,
      deleteObject,
      null,
      {
        background: '#ede7f6',
        isComment: true,
        onOpen: () => commentModal.show(creator || name, desc),
      }
    )
    return
  }

  if (type === 'projector') {
    const filePath = ymap.get('filePath')
    const proj = new Projector({
      id, scene,
      getRoomMeshes: () => roomLoader.getAllRoomMeshes(),
      filePath: filePath || null,
      gltfLoader,
    })
    proj.setPosition(...pos)
    proj.setRotationY(rot[1])
    const ks0 = ymap.get('keystone') || 0
    if (ks0) proj.setKeystone(ks0)
    liveObjects.set(id, proj)
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], label, desc, deleteObject, toggleLock)
    return
  }

  if (type === 'primitive') {
    const geo = ymap.get('geometry') || { w: 0.6096, d: 0.6096, h: 0.9144 }
    const primType = ymap.get('primType') || 'box'
    const mesh = makePrimitiveMesh(primType, geo.w, geo.d, geo.h)
    const obj = new AssetObject({ id, type, name, desc, scene, mesh })
    obj.setPosition(...pos)
    obj.setRotation(...rot)
    liveObjects.set(id, obj)
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], label, desc, deleteObject, toggleLock)
    if (id === pendingSelectId) {
      pendingSelectId = null
      if (selected) selected.deselect?.()
      selected = obj
      obj.select()
    }
    return
  }

  if (type === 'drawn') {
    const g = ymap.get('geometry') || {}
    const parentMesh = roomLoader.getAllRoomMeshes().find(m => m.name === g.parentName) || null
    const obj = new DrawnShape({ id, scene, desc: g, colorRefs: COLORS, parentMesh })
    liveObjects.set(id, obj)
    labelManager.add(id, labelPosFor(obj), label, desc, deleteObject, toggleLock)
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
    labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], label, desc, deleteObject, toggleLock)
    return
  }

  if (type === 'asset') {
    const filePath = ymap.get('filePath')
    const bbox     = ymap.get('boundingBox')

    const finishSpawn = (mesh) => {
      mesh.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
      const obj = new AssetObject({ id, type, name, description: desc, scene, mesh })
      obj.setPosition(...pos)
      obj.setRotation(...rot)
      liveObjects.set(id, obj)
      labelManager.add(id, [pos[0], pos[1] + 0.3, pos[2]], label, desc, deleteObject, toggleLock)
      if (id === pendingSelectId) {
        pendingSelectId = null
        if (selected) selected.deselect?.()
        selected = obj
        obj.select()
      }
    }

    if (filePath) {
      gltfLoader.loadAsync(filePath).then(gltf => {
        const mesh = gltf.scene
        // Center XZ so the asset sits at the group's drag handle, and
        // bottom-align Y so it rests on the floor at the group position.
        const meshBox = new THREE.Box3().setFromObject(mesh)
        if (isFinite(meshBox.min.y)) {
          const c = new THREE.Vector3()
          meshBox.getCenter(c)
          mesh.position.x -= c.x
          mesh.position.y -= meshBox.min.y
          mesh.position.z -= c.z
        }
        finishSpawn(mesh)
      })
    } else if (bbox && bbox.min && bbox.max) {
      // Scan-only asset (no GLB attached) — placeholder box from scan bbox
      const w = Math.max(bbox.max[0] - bbox.min[0], 0.05)
      const h = Math.max(bbox.max[1] - bbox.min[1], 0.05)
      const d = Math.max(bbox.max[2] - bbox.min[2], 0.05)
      const geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(0, h / 2, 0)  // bottom at local y=0
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.primitive.getHex(),
        roughness: 0.7, metalness: 0.0,
        transparent: true, opacity: 0.65,
      })
      finishSpawn(new THREE.Mesh(geo, mat))
    }
    return
  }
}

function makePrimitiveMesh(primType, w, d, h) {
  let geo
  if (primType === 'cylinder') geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 16)
  else if (primType === 'sphere') geo = new THREE.SphereGeometry(w / 2, 16, 12)
  else geo = new THREE.BoxGeometry(w, h, d)
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.primitive.getHex(),
    roughness: 0.7,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ─── Placing Objects ─────────────────────────────────────────────────────────

function placeAsset(asset, worldPos) {
  const id = uuidv4()
  pendingSelectId = id

  let bbox = null
  if (asset.bounding_box) {
    try { bbox = JSON.parse(asset.bounding_box) } catch (_) { /* ignore */ }
  }

  // If a world position was passed (e.g. from drag-and-drop), use that;
  // otherwise place where the camera target is (what the user is looking at).
  // Y always = floor TOP surface so the bottom of the asset rests on it.
  const floorY = roomLoader.floorTopY
  const t = worldPos || controls.target
  const pos = [snap(t.x), floorY, snap(t.z)]

  upsertObject(id, {
    type: asset.category === 'projector' ? 'projector' : 'asset',
    assetId: asset.id,
    filePath: asset.file_path ? `/api/asset-file/${asset.id}` : null,
    boundingBox: bbox,
    creator: asset.is_global ? '' : (asset.creator || ''),
    name: asset.name,
    description: asset.description || '',
    position: pos,
    rotation: [0, 0, 0],
    createdBy: getAwareness()?.clientID?.toString() || '',
  })
}

function placePrimitive({ primType, w, d, h }) {
  promptLabel(({ creator, name, description }) => {
    const id = uuidv4()
    pendingSelectId = id
    const target = controls.target
    const floorY = roomLoader.floorTopY
    upsertObject(id, {
      type: 'primitive',
      primType,
      geometry: { w, d, h },
      creator, name, description,
      position: [snap(target.x), floorY, snap(target.z)],
      rotation: [0, 0, 0],
      createdBy: getAwareness()?.clientID?.toString() || '',
    })
  })
}

let pendingSelectId = null

function placeDrawnShape(geo) {
  promptLabel(({ creator, name, description }) => {
    const id = uuidv4()
    pendingSelectId = id
    upsertObject(id, {
      type: 'drawn',
      geometry: geo,
      creator, name, description,
      position: [0, 0, 0], rotation: [0, 0, 0],
      createdBy: getAwareness()?.clientID?.toString() || '',
    })
  })
}

// ─── Label dialog ────────────────────────────────────────────────────────────

function saveRoomState(slug) {
  sessionStorage.setItem('eoys_lastRoom', slug)
}
function saveCamState() {
  sessionStorage.setItem('eoys_camState', JSON.stringify({
    pos: camera.position.toArray(),
    target: controls.target.toArray(),
  }))
}
function restoreCamState(slug) {
  try {
    const lastRoom = sessionStorage.getItem('eoys_lastRoom')
    const raw = sessionStorage.getItem('eoys_camState')
    if (lastRoom !== slug || !raw) return
    const { pos, target } = JSON.parse(raw)
    camera.position.fromArray(pos)
    controls.target.fromArray(target)
    controls.update()
  } catch (_) {}
}

function getSavedCreator() { return localStorage.getItem('eoys_creator') || '' }
function setSavedCreator(v) { localStorage.setItem('eoys_creator', v) }

/** Prompts for creator + name + description. Both creator and name required.
 *  Calls onConfirm({ creator, name, description }). */
function promptLabel(onConfirm) {
  const overlay = document.createElement('div')
  overlay.className = 'dialog-overlay'
  const saved = getSavedCreator()
  overlay.innerHTML = `
    <div class="dialog">
      <h2>Name this object</h2>
      <label>Creator (you)</label>
      <input type="text" id="dlg-creator" placeholder="firstname lastname" />
      <label>Name</label>
      <input type="text" id="dlg-name" placeholder="Drawing 1" />
      <label>Description (optional)</label>
      <input type="text" id="dlg-desc" placeholder="" />
      <div class="dialog-actions">
        <button class="btn" id="dlg-cancel">Cancel</button>
        <button class="btn primary" id="dlg-ok">Place</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  const creatorInp = overlay.querySelector('#dlg-creator')
  const nameInp    = overlay.querySelector('#dlg-name')
  creatorInp.value = saved
  ;(saved ? nameInp : creatorInp).focus()

  const close = () => document.body.removeChild(overlay)
  overlay.querySelector('#dlg-cancel').addEventListener('click', close)
  overlay.querySelector('#dlg-ok').addEventListener('click', () => {
    const creator = creatorInp.value.trim()
    const name    = nameInp.value.trim()
    const description = overlay.querySelector('#dlg-desc').value.trim()
    if (!creator) { creatorInp.focus(); return }
    if (!name)    { nameInp.focus();    return }
    setSavedCreator(creator)
    close()
    onConfirm({ creator, name, description })
  })
}

/** Compose the visible label text from creator + name. */
function formatLabel(creator, name) {
  return creator ? `${creator} - ${name}` : (name || '')
}

function isLocked(id) {
  return getObjects()?.get(id)?.get('locked') === true
}

function toggleLock(id) {
  upsertObject(id, { locked: !isLocked(id) })
}

// ─── Interaction ─────────────────────────────────────────────────────────────

let selected = null
let hovered  = null
let dragging = false        // moving an object
let extruding = null        // { shape, initialOffset, initialExtrude }
let rotating = null         // { obj, axis, center, lastAngle, accumulated, initX, initY, initZ }
let translating = null      // { obj, axis, axisVec, dragPlane, startOffset, startPos }
let hoveredGizmoHandle = null

function setGizmoOpacity(handle, opacity) {
  handle.traverse(c => { if (c.isMesh) { c.material.opacity = opacity } })
}
let dragSurface = null      // for non-drawn assets: { plane, y } for floor-plane drag
const raycaster = new THREE.Raycaster()
raycaster.layers.enableAll()
const mouse = new THREE.Vector2()

function setMouse(e) {
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

/** Angle of the cursor on the plane perpendicular to `axis` through `center`. */
function getAngleOnAxis(axis, center) {
  const pt = new THREE.Vector3()
  let plane
  if (axis === 'y') {
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -center.y)
    if (!raycaster.ray.intersectPlane(plane, pt)) return null
    return Math.atan2(pt.z - center.z, pt.x - center.x)
  } else if (axis === 'x') {
    plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -center.x)
    if (!raycaster.ray.intersectPlane(plane, pt)) return null
    return Math.atan2(pt.y - center.y, pt.z - center.z)
  } else {
    plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -center.z)
    if (!raycaster.ray.intersectPlane(plane, pt)) return null
    return Math.atan2(pt.y - center.y, pt.x - center.x)
  }
}

/** Best drag plane for axis-constrained translation: contains the axis, faces camera. */
function bestDragPlane(axisVec, center) {
  const camToCenter = center.clone().sub(camera.position).normalize()
  let n = camToCenter.clone().sub(axisVec.clone().multiplyScalar(camToCenter.dot(axisVec)))
  if (n.lengthSq() < 1e-6) n.set(axisVec.x === 0 ? 1 : 0, axisVec.y === 0 ? 1 : 0, 0).normalize()
  else n.normalize()
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, center)
}

function wrapAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
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
  setMouse(e)

  if (placingComment) {
    raycaster.setFromCamera(mouse, camera)

    // Find nearest hit across room meshes and live object groups
    const roomHits = raycaster.intersectObjects(roomLoader.getAllRoomMeshes(), false)
    let best = roomHits.length ? { point: roomHits[0].point, dist: roomHits[0].distance, parentId: null } : null

    for (const [oid, obj] of liveObjects) {
      if (!obj.group) continue
      const hits = raycaster.intersectObject(obj.group, true)
      if (!hits.length) continue
      if (!best || hits[0].distance < best.dist)
        best = { point: hits[0].point, dist: hits[0].distance, parentId: oid, parentGroup: obj.group }
    }

    if (best) {
      const pt = best.point
      const id = uuidv4()
      const creator = commentPanelEl.querySelector('input')?.value?.trim() || ''
      const description = commentPanelEl.querySelector('textarea')?.value?.trim() || ''
      const fields = {
        type: 'comment',
        name: creator,
        creator,
        description,
        position: [pt.x, pt.y + 0.05, pt.z],
        rotation: [0, 0, 0],
      }
      if (best.parentId) {
        const pp = best.parentGroup.position
        fields.parentId = best.parentId
        fields.parentOffset = [pt.x - pp.x, pt.y - pp.y, pt.z - pp.z]
        fields.position = [pt.x, pt.y, pt.z]
      }
      upsertObject(id, fields)
      commentPanel.reset()
    }
    placingComment = false
    renderer.domElement.style.cursor = ''
    return
  }

  if (drawMode) return
  raycaster.setFromCamera(mouse, camera)

  // Gizmo handles (only visible on selected object)
  const gizmo = selected?._gizmo
  const selectedId0 = selected?.group?.userData?.assetObjectId || selected?.id
  if (gizmo && !isLocked(selectedId0)) {
    // Translate arrows (each axis has 2 arrow groups)
    const AXES = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) }
    outer: for (const [axis, arrows] of Object.entries(gizmo.translateHandles)) {
      for (const arrowGroup of arrows) {
        if (!raycaster.intersectObject(arrowGroup, true).length) continue
        const axisVec = AXES[axis]
        const center = new THREE.Vector3()
        new THREE.Box3().setFromObject(selected.group).getCenter(center)
        const dragPlane = bestDragPlane(axisVec, center)
        const pt = new THREE.Vector3()
        raycaster.ray.intersectPlane(dragPlane, pt)
        translating = {
          obj: selected, axis, axisVec, dragPlane,
          startOffset: pt ? pt.dot(axisVec) : 0,
          startPos: selected.group.position.clone(),
        }
        controls.enabled = false
        break outer
      }
    }
    if (translating) return
    // Rotate rings
    for (const [axis, mesh] of Object.entries(gizmo.rotateHandles)) {
      if (!raycaster.intersectObject(mesh, false).length) continue
      const center = new THREE.Vector3()
      new THREE.Box3().setFromObject(selected.group).getCenter(center)
      const angle = getAngleOnAxis(axis, center)
      if (angle !== null) {
        rotating = {
          obj: selected, axis, center, lastAngle: angle, accumulated: 0,
          initX: selected.group.rotation.x,
          initY: selected.group.rotation.y,
          initZ: selected.group.rotation.z,
        }
        controls.enabled = false
      }
      return
    }
  }

  const pick = pickUserObject()
  if (!pick) {
    if (selected) {
      hoveredGizmoHandle = null
      selected.deselect?.()
      if (selected instanceof Projector) selected.hideKeystoneUI()
      selected = null
    }
    return
  }

  // Extrude handle?
  if (pick.hit.object.userData?.isExtrudeHandle) {
    const target = liveObjects.get(pick.hit.object.userData.targetId)
    if (target instanceof DrawnShape && !isLocked(target.id)) {
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
  if (selected && selected !== pick.obj) {
    hoveredGizmoHandle = null
    selected.deselect?.()
    if (selected instanceof Projector) selected.hideKeystoneUI()
  }
  selected = pick.obj
  selected.select?.()
  if (ENABLE_KEYSTONE && selected instanceof Projector) {
    selected.showKeystoneUI(k => upsertObject(selected.id, { keystone: k }))
  }

  const selectedId1 = selected?.group?.userData?.assetObjectId || selected?.id
  if (!isLocked(selectedId1)) {
    dragging = true
    controls.enabled = false
    if (!(selected instanceof DrawnShape)) {
      const y = roomLoader.floorTopY
      dragSurface = { plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), y }
    } else {
      dragSurface = null
    }
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
          ymapLabel(extruding.shape.id), '')
        upsertObject(extruding.shape.id, { geometry: extruding.shape.desc })
      }
      sizeLabel.show(`extrude: ${metersToFeetInches(extruding.shape.desc.extrude)}`, [e.clientX, e.clientY])
    }
    return
  }

  // Translate drag (axis-constrained)
  if (translating) {
    const { obj, axis, axisVec, dragPlane, startOffset, startPos } = translating
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(dragPlane, pt)) {
      const raw = pt.dot(axisVec) - startOffset
      const snapped = Math.round(raw / GRID_UNIT) * GRID_UNIT
      const newPos = startPos.clone().addScaledVector(axisVec, snapped)
      obj.setPosition(newPos.x, newPos.y, newPos.z)
      const id = obj.group.userData.assetObjectId
      if (id) {
        labelManager.update(id, [newPos.x, newPos.y + 0.3, newPos.z], ymapLabel(id), '')
        updateParentedComments(id, newPos)
      }
      const ft = (snapped / 0.3048)
      sizeLabel.show(`${axis.toUpperCase()}: ${ft >= 0 ? '+' : ''}${ft.toFixed(2)}'`, [e.clientX, e.clientY])
    }
    return
  }

  // Rotate drag
  if (rotating) {
    const { obj, axis, center } = rotating
    const angle = getAngleOnAxis(axis, center)
    if (angle !== null) {
      const delta = wrapAngle(angle - rotating.lastAngle)
      rotating.accumulated += delta
      rotating.lastAngle = angle
      const SNAP = 45 * Math.PI / 180
      const snapped = Math.round(rotating.accumulated / SNAP) * SNAP
      const rx = axis === 'x' ? rotating.initX + snapped : obj.group.rotation.x
      const ry = axis === 'y' ? rotating.initY + snapped : obj.group.rotation.y
      const rz = axis === 'z' ? rotating.initZ + snapped : obj.group.rotation.z
      obj.setRotation(rx, ry, rz)
      const deg = Math.round(snapped * 180 / Math.PI)
      sizeLabel.show(`${axis.toUpperCase()}: ${deg >= 0 ? '+' : ''}${deg}°`, [e.clientX, e.clientY])
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
        labelManager.update(selected.id, labelPosFor(selected), ymapLabel(selected.id), '')
        updateParentedComments(selected.id, selected.group.position)
        upsertObject(selected.id, { geometry: selected.desc })
      }
    } else if (dragSurface) {
      const pt = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(dragSurface.plane, pt)) {
        const id = selected.group?.userData?.assetObjectId
        if (id) {
          const pos = [snap(pt.x), dragSurface.y, snap(pt.z)]
          selected.setPosition?.(...pos)
          labelManager.update(id, [pos[0], pos[1] + 0.3, pos[2]], ymapLabel(id), '')
          updateParentedComments(id, selected.group.position)
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
    hovered?.hoverOff?.()
    hovered = newHover
    hovered?.hoverOn?.()
  }
  // Cursor
  let newGizmoHandle = null
  if (selected?._gizmo) {
    gizmoCheck: {
      for (const arrows of Object.values(selected._gizmo.translateHandles)) {
        for (const g of arrows) {
          if (raycaster.intersectObject(g, true).length) { newGizmoHandle = g; break gizmoCheck }
        }
      }
      for (const m of Object.values(selected._gizmo.rotateHandles)) {
        if (raycaster.intersectObject(m, false).length) { newGizmoHandle = m; break gizmoCheck }
      }
    }
  }
  if (newGizmoHandle !== hoveredGizmoHandle) {
    if (hoveredGizmoHandle) setGizmoOpacity(hoveredGizmoHandle, 0.5)
    if (newGizmoHandle)     setGizmoOpacity(newGizmoHandle, 0.85)
    hoveredGizmoHandle = newGizmoHandle
  }
  const overGizmo = !!newGizmoHandle
  if (placingComment) {
    renderer.domElement.style.cursor = 'crosshair'
  } else if (overGizmo) {
    renderer.domElement.style.cursor = 'crosshair'
  } else if (pick?.hit?.object?.userData?.isExtrudeHandle) {
    renderer.domElement.style.cursor = 'ns-resize'
  } else if (pick) {
    renderer.domElement.style.cursor = 'grab'
  } else {
    renderer.domElement.style.cursor = ''
  }
  checkProjectorTooltip(e)
})

renderer.domElement.addEventListener('pointerup', () => {
  if (translating) {
    const { obj } = translating
    const id = obj.group.userData.assetObjectId
    if (id) {
      const p = obj.group.position
      upsertObject(id, { position: [p.x, p.y, p.z] })
    }
    obj._refreshSelectionBox()
    translating = null
  }
  if (rotating) {
    const { obj } = rotating
    const id = obj.group.userData.assetObjectId
    if (id) {
      upsertObject(id, {
        rotation: [obj.group.rotation.x, obj.group.rotation.y, obj.group.rotation.z],
      })
    }
    obj._refreshSelectionBox()
    rotating = null
  }
  dragging = false
  extruding = null
  dragSurface = null
  sizeLabel.hide()
  controls.enabled = !drawMode
  saveCamState()
})

renderer.domElement.addEventListener('pointerleave', () => {
  grid.hideHover()
  if (hovered && hovered !== selected) { hovered.hoverOff?.(); hovered = null }
})

// Drag-and-drop assets from the panel onto the canvas
renderer.domElement.addEventListener('dragover', e => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
renderer.domElement.addEventListener('drop', e => {
  e.preventDefault()
  const json = e.dataTransfer?.getData('application/json')
  if (!json) return
  let asset
  try { asset = JSON.parse(json) } catch (_) { return }
  if (!asset) return

  // Raycast from drop point onto the floor plane to choose where to spawn
  setMouse(e)
  raycaster.setFromCamera(mouse, camera)
  const pt = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(floorPlane, pt)) {
    placeAsset(asset, pt)
  } else {
    placeAsset(asset)
  }
})

window.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return

  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault(); undo(); updateUndoButtons(); return
  }
  if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
    e.preventDefault(); redo(); updateUndoButtons(); return
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    const id = selected.group?.userData?.assetObjectId || selected.id
    if (id && !isLocked(id)) deleteObject(id)
  }
  if (e.key === 'Escape' && selected) {
    selected.deselect?.()
    if (selected instanceof Projector) selected.hideKeystoneUI()
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

function ymapLabel(id) {
  const m = getObjects()?.get(id)
  if (!m) return ''
  return formatLabel(m.get('creator') || '', m.get('name') || '')
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
    drawTool.onShapeComplete = desc => {
      drawPanel.deactivate()
      enableDrawMode(null)
      placeDrawnShape(desc)
    }
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
sidebar.addPanel('assets', 'Library', assetPanelEl)

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
      promptLabel(({ creator, name, description }) => {
        const id = uuidv4()
        upsertObject(id, {
          type: 'primitive', primType: 'upload',
          geometry: { w, d, h },
          creator, name, description,
          position: [0, 0, 0], rotation: [0, 0, 0],
          createdBy: getAwareness()?.clientID?.toString() || '',
        })
        const obj = new AssetObject({ id, type: 'primitive', name, description, scene, mesh })
        liveObjects.set(id, obj)
        labelManager.add(id, [0, 0.3, 0], formatLabel(creator, name), description, deleteObject, toggleLock)
      })
    })
  }
})
sidebar.addPanel('create', 'Create', createPanelEl)

const drawPanelEl = document.createElement('div')
const drawPanel = new DrawPanel(drawPanelEl, mode => enableDrawMode(mode))
sidebar.addPanel('draw', 'Draw', drawPanelEl, () => drawPanel.deactivate())

let placingComment = false

const commentPanelEl = document.createElement('div')
const commentPanel = new CommentPanel(commentPanelEl, ({ creator, description }) => {
  placingComment = true
  renderer.domElement.style.cursor = 'crosshair'
})
sidebar.addPanel('comment', 'Comment', commentPanelEl)

const visToggles = new VisibilityToggles(
  document.getElementById('visibility-toggles'),
  {
    grid: v => grid.setVisible(v),
    labels: v => labelManager.setVisible(v),
    comments: v => labelManager.setCommentsVisible(v),
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
function updateFloorPlane() {
  const y = roomLoader.floorTopY ?? 0
  floorPlane.set(new THREE.Vector3(0, 1, 0), -y)
}
roomScene.onFrame(() => {
  labelManager.render()
  if (selected instanceof Projector) selected.updateKeystonePos(camera, roomScene.renderer)

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

// ─── Comment detail modal ────────────────────────────────────────────────────

const commentModal = (() => {
  const backdrop = document.createElement('div')
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;'
  document.body.appendChild(backdrop)

  const panel = document.createElement('div')
  panel.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 1000; display: none;
    background: rgba(255,255,255,0.95); border: 1px solid #000;
    font-family: 'Roboto Mono', monospace; font-size: 11px;
    min-width: 280px; max-width: 420px; width: 90%;
  `

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #000;'

  const authorEl = document.createElement('span')
  authorEl.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.1em;'

  const closeBtn = document.createElement('span')
  closeBtn.textContent = '[ × ]'
  closeBtn.style.cssText = 'font-size:10px;cursor:pointer;user-select:none;'
  closeBtn.addEventListener('click', hide)

  header.appendChild(authorEl)
  header.appendChild(closeBtn)

  const body = document.createElement('div')
  body.style.cssText = 'padding:12px;white-space:pre-wrap;line-height:1.6;font-size:11px;max-height:60vh;overflow-y:auto;'

  panel.appendChild(header)
  panel.appendChild(body)
  document.body.appendChild(panel)

  backdrop.addEventListener('click', hide)

  function hide() {
    panel.style.display = 'none'
    backdrop.style.display = 'none'
  }

  function show(author, message) {
    authorEl.textContent = author
    body.textContent = message || ''
    backdrop.style.display = 'block'
    panel.style.display = 'block'
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.style.display !== 'none') hide()
  })

  return { show, hide }
})()

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
  row('Projection surface', () => hexFromColor(COLORS.projSurface), v => {
    COLORS.projSurface.set(v)
    for (const obj of liveObjects.values()) {
      if (obj instanceof Projector) obj._projPlane.material.color.set(v)
    }
  })

  const note = document.createElement('div')
  note.style.cssText = 'margin-top:6px;font-size:9px;opacity:.55;line-height:1.4;'
  note.textContent = 'Drawn/Primitive: applies to NEW objects only.'
  body.appendChild(note)

  // ── Lights section ──────────────────────────────────────────────────────
  const lightHeader = document.createElement('div')
  lightHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid #000;border-bottom:1px solid #000;cursor:pointer;user-select:none;margin-top:8px;margin-left:-12px;margin-right:-12px;'
  lightHeader.innerHTML = `<span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;">Lights</span><span id="light-toggle" style="font-size:10px;">[ + ]</span>`
  body.appendChild(lightHeader)

  const lightBody = document.createElement('div')
  lightBody.style.cssText = 'padding:8px 0;display:none;flex-direction:column;gap:8px;'
  body.appendChild(lightBody)

  let lightCollapsed = true
  lightHeader.addEventListener('click', () => {
    lightCollapsed = !lightCollapsed
    lightBody.style.display = lightCollapsed ? 'none' : 'flex'
    lightHeader.querySelector('#light-toggle').textContent = lightCollapsed ? '[ + ]' : '[ − ]'
  })

  function slider(parent, label, min, max, step, getValue, setValue) {
    const r = document.createElement('div')
    r.style.cssText = 'display:flex;align-items:center;gap:8px;'
    const lbl = document.createElement('span'); lbl.style.cssText = 'flex:0 0 110px;font-size:10px;'; lbl.textContent = label
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step
    inp.value = getValue(); inp.style.cssText = 'flex:1;'
    const val = document.createElement('span'); val.style.cssText = 'flex:0 0 36px;text-align:right;font-size:10px;opacity:.7;'
    val.textContent = (+getValue()).toFixed(2)
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value); setValue(v); val.textContent = v.toFixed(2)
    })
    r.appendChild(lbl); r.appendChild(inp); r.appendChild(val)
    parent.appendChild(r)
  }

  slider(lightBody, 'Direct (sun)', 0, 4, 0.05,
    () => roomScene.dirLight.intensity,
    v => roomScene.dirLight.intensity = v)

  slider(lightBody, 'Ambient (IBL)', 0, 3, 0.05,
    () => scene.environmentIntensity ?? 1,
    v => scene.environmentIntensity = v)

  slider(lightBody, 'Exposure', 0, 2, 0.05,
    () => renderer.toneMappingExposure,
    v => renderer.toneMappingExposure = v)

  // Shadow on/off
  const shadowRow = document.createElement('div')
  shadowRow.style.cssText = 'display:flex;align-items:center;gap:8px;'
  const shadowLbl = document.createElement('span'); shadowLbl.style.cssText = 'flex:1;font-size:10px;'; shadowLbl.textContent = 'Cast shadows'
  const shadowInp = document.createElement('input'); shadowInp.type = 'checkbox'; shadowInp.checked = true
  shadowInp.addEventListener('change', () => roomScene.dirLight.castShadow = shadowInp.checked)
  shadowRow.appendChild(shadowLbl); shadowRow.appendChild(shadowInp)
  lightBody.appendChild(shadowRow)

  // White-walls toggle
  const toggleRow = document.createElement('div')
  toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;'
  const toggleLbl = document.createElement('span'); toggleLbl.style.cssText = 'flex:1;'; toggleLbl.textContent = 'White walls'
  const toggleInp = document.createElement('input'); toggleInp.type = 'checkbox'; toggleInp.checked = true
  toggleInp.addEventListener('change', () => roomLoader.setUseWhite(toggleInp.checked))
  toggleRow.appendChild(toggleLbl); toggleRow.appendChild(toggleInp)
  body.appendChild(toggleRow)

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

// ─── Undo / Redo buttons ─────────────────────────────────────────────────────

let _btnUndo = null
let _btnRedo = null

function updateUndoButtons() {
  if (!_btnUndo) return
  _btnUndo.style.opacity = canUndo() ? '1' : '0.35'
  _btnRedo.style.opacity = canRedo() ? '1' : '0.35'
}

function buildUndoButtons() {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:100;display:flex;gap:6px;'

  _btnUndo = document.createElement('button')
  _btnUndo.className = 'btn'
  _btnUndo.title = 'Undo (⌘Z)'
  _btnUndo.textContent = '↩ Undo'
  _btnUndo.addEventListener('click', () => { undo(); updateUndoButtons() })

  _btnRedo = document.createElement('button')
  _btnRedo.className = 'btn'
  _btnRedo.title = 'Redo (⌘⇧Z)'
  _btnRedo.textContent = '↪ Redo'
  _btnRedo.addEventListener('click', () => { redo(); updateUndoButtons() })

  wrap.appendChild(_btnUndo)
  wrap.appendChild(_btnRedo)

  const btnHelp = document.createElement('button')
  btnHelp.className = 'btn'
  btnHelp.textContent = '? Help'
  btnHelp.title = 'How to use'
  btnHelp.addEventListener('click', () => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:500;display:flex;align-items:center;justify-content:center;'
    const box = document.createElement('div')
    box.style.cssText = 'background:#fff;border:1.5px solid #000;border-radius:16px;padding:28px 32px;max-width:480px;width:90%;font-family:Roboto Mono,monospace;font-size:12px;max-height:80vh;overflow-y:auto;'
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <span style="font-size:13px;text-transform:uppercase;letter-spacing:.1em;">How to use</span>
        <span id="help-close" style="cursor:pointer;font-size:18px;line-height:1;">×</span>
      </div>
      <div style="display:grid;gap:16px;">
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Navigation</div>
          <div style="display:grid;gap:4px;line-height:1.6;">
            <div><b>WASD / Arrows</b> — fly camera</div>
            <div><b>Q / Space</b> — move up &nbsp; <b>E</b> — move down</div>
            <div><b>Shift</b> — move faster</div>
            <div><b>Left drag</b> — orbit &nbsp; <b>Right drag</b> — pan</div>
            <div><b>Scroll</b> — zoom</div>
          </div>
        </div>
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Objects</div>
          <div style="display:grid;gap:4px;line-height:1.6;">
            <div><b>Click</b> — select &nbsp; <b>Drag</b> — move on floor</div>
            <div><b>Gizmo arrows</b> — move along axis</div>
            <div><b>Gizmo rings</b> — rotate in 45° steps</div>
            <div><b>Delete / Backspace</b> — delete selected</div>
            <div><b>Escape</b> — deselect</div>
          </div>
        </div>
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Draw</div>
          <div style="line-height:1.6;">Open the Draw panel → choose Wall or Floor → click and drag on a surface. Drag the extrude handle to add depth.</div>
        </div>
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Comments</div>
          <div style="line-height:1.6;">Open the Comment panel → fill in name + note → click Place → click anywhere in the scene.</div>
        </div>
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Lock</div>
          <div style="line-height:1.6;">Click 🔓 in any label to lock an object. Locked objects can be selected but not moved or deleted.</div>
        </div>
        <div>
          <div style="text-transform:uppercase;letter-spacing:.08em;font-size:10px;color:#888;margin-bottom:6px;">Undo / Redo</div>
          <div style="line-height:1.6;"><b>⌘Z / Ctrl+Z</b> — undo &nbsp; <b>⌘⇧Z / Ctrl+Y</b> — redo</div>
        </div>
      </div>
    `
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
    box.querySelector('#help-close').addEventListener('click', () => overlay.remove())
  })
  wrap.appendChild(btnHelp)

  document.body.appendChild(wrap)
  updateUndoButtons()
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
  buildUndoButtons()
  if (ENABLE_DEBUG_PANEL) buildDebugPanel()
}

init()
