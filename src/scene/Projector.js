import * as THREE from 'three'
import { snap } from './Snapping.js'
import { SEL_MAT, buildGizmo, clearGizmo } from './_gizmoUtils.js'

const THROW_RATIO = 1.48   // Epson PowerLite 1288
const ASPECT = 16 / 10

export class Projector {
  constructor({ id, scene, getRoomMeshes, filePath, gltfLoader }) {
    this.id = id
    this.scene = scene
    this.getRoomMeshes = getRoomMeshes

    this._raycaster = new THREE.Raycaster()
    this._keystone = 0

    this.group = new THREE.Group()
    this.group.userData.assetObjectId = id
    this.group.layers.set(1)
    scene.add(this.group)

    // Placeholder body — replaced once GLB loads
    this._buildPlaceholder()

    if (filePath && gltfLoader) {
      gltfLoader.loadAsync(filePath).then(gltf => {
        const mesh = gltf.scene
        mesh.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true
            c.receiveShadow = true
            c.layers.set(1)
          }
        })
        const b = new THREE.Box3().setFromObject(mesh)
        const center = new THREE.Vector3()
        b.getCenter(center)
        mesh.position.x -= center.x
        mesh.position.y -= b.min.y
        mesh.position.z -= center.z

        this.group.remove(this._bodyMesh)
        this._bodyMesh.geometry?.dispose()
        this._bodyMesh.material?.dispose()
        this._bodyMesh = mesh
        this.group.add(mesh)
        this._updateProjection()
        this._refreshSelectionBox()
      }).catch(() => { /* keep placeholder on load failure */ })
    }

    const projMat = new THREE.MeshBasicMaterial({
      color: 0xfff9bd,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this._projPlane = new THREE.Mesh(this._buildTrapGeo(1, 1, 0), projMat)
    this._projPlane.layers.set(1)
    this._projPlane.visible = false
    scene.add(this._projPlane)

    this._selectionBox = null
    this._gizmo = null
    this._keystoneEl = null
    this.selected = false
    this.hovered  = false
  }

  _buildPlaceholder() {
    const geo = new THREE.BoxGeometry(0.3048, 0.1524, 0.4572)
    const mat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.1 })
    this._bodyMesh = new THREE.Mesh(geo, mat)
    this._bodyMesh.position.y = 0.1524 / 2
    this._bodyMesh.castShadow = true
    this._bodyMesh.layers.set(1)
    this.group.add(this._bodyMesh)
  }

  // Builds a trapezoid: k > 0 = top narrower, k < 0 = bottom narrower
  _buildTrapGeo(w, h, k) {
    const topW = w * (1 - Math.max(0,  k) * 0.7)
    const botW = w * (1 - Math.max(0, -k) * 0.7)
    const geo  = new THREE.BufferGeometry()
    const pos  = new Float32Array([
      -botW / 2, -h / 2, 0,
       botW / 2, -h / 2, 0,
      -topW / 2,  h / 2, 0,
       topW / 2,  h / 2, 0,
    ])
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setIndex([0, 1, 3, 0, 3, 2])
    return geo
  }

  setPosition(x, y, z) {
    this.group.position.set(snap(x), y, snap(z))
    this._updateProjection()
    this._refreshSelectionBox()
  }

  setRotationY(radY) {
    this.group.rotation.y = radY
    this._updateProjection()
    this._refreshSelectionBox()
  }

  setRotation(x, y, z) {
    this.group.rotation.set(x, y, z)
    this._updateProjection()
    this._refreshSelectionBox()
  }

  setKeystone(k) {
    this._keystone = Math.max(-1, Math.min(1, k))
    this._updateProjection()
    // Sync slider UI if open
    if (this._keystoneEl) {
      const slider = this._keystoneEl.querySelector('.keystone-slider')
      const valEl  = this._keystoneEl.querySelector('.keystone-val')
      const deg = Math.round(this._keystone * 30)
      if (slider) slider.value = deg
      if (valEl)  valEl.textContent = `${deg > 0 ? '+' : ''}${deg}°`
    }
  }

  // Show the floating keystone widget. onChange(k) fires on every slider change.
  showKeystoneUI(onChange) {
    if (this._keystoneEl) return
    const deg = Math.round(this._keystone * 30)
    const el = document.createElement('div')
    el.className = 'keystone-widget'
    el.innerHTML = `
      <div class="keystone-label">Keystone <span class="keystone-model">Epson 1288</span></div>
      <div class="keystone-row">
        <input type="range" min="-30" max="30" value="${deg}" step="1" class="keystone-slider" />
        <span class="keystone-val">${deg > 0 ? '+' : ''}${deg}°</span>
      </div>
    `
    document.body.appendChild(el)

    const slider = el.querySelector('.keystone-slider')
    const valEl  = el.querySelector('.keystone-val')
    slider.addEventListener('input', () => {
      const d = parseInt(slider.value)
      valEl.textContent = `${d > 0 ? '+' : ''}${d}°`
      this._keystone = d / 30
      this._updateProjection()
      onChange?.(this._keystone)
    })
    // Prevent slider drag from rotating the scene
    el.addEventListener('pointerdown', e => e.stopPropagation())

    this._keystoneEl = el
  }

  hideKeystoneUI() {
    if (this._keystoneEl) {
      this._keystoneEl.remove()
      this._keystoneEl = null
    }
  }

  // Call from render loop when this projector is selected
  updateKeystonePos(camera, renderer) {
    if (!this._keystoneEl) return
    const box = new THREE.Box3().setFromObject(this.group)
    const top = new THREE.Vector3()
    box.getCenter(top)
    top.y = box.max.y

    const ndc  = top.project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    const x = (ndc.x + 1) / 2 * rect.width  + rect.left
    const y = (1 - ndc.y) / 2 * rect.height + rect.top
    this._keystoneEl.style.left      = `${x}px`
    this._keystoneEl.style.top       = `${y}px`
    this._keystoneEl.style.transform = 'translate(-50%, calc(-100% - 10px))'
  }

  hoverOn()  { this.hovered = true;  this._refreshSelectionBox() }
  hoverOff() { this.hovered = false; this._refreshSelectionBox() }
  select()   { this.selected = true;  this._refreshSelectionBox() }
  deselect() { this.selected = false; this._refreshSelectionBox() }

  _refreshSelectionBox() {
    if (this._selectionBox) {
      this.scene.remove(this._selectionBox)
      this._selectionBox.geometry?.dispose()
      this._selectionBox.material?.dispose()
      this._selectionBox = null
    }

    const wantBox   = this.selected || this.hovered
    const wantGizmo = this.selected

    if (!wantBox) { clearGizmo(this.scene, this._gizmo); this._gizmo = null; return }

    const box = new THREE.Box3().setFromObject(this.group)
    this._selectionBox = new THREE.Box3Helper(box, 0x00ff00)
    this._selectionBox.material = new THREE.LineBasicMaterial({
      color: SEL_MAT.color.clone(),
      transparent: true,
      opacity: this.selected ? 1.0 : 0.35,
      depthTest: false,
    })
    this._selectionBox.renderOrder = 999
    this.scene.add(this._selectionBox)

    if (!wantGizmo) { clearGizmo(this.scene, this._gizmo); this._gizmo = null; return }

    if (this._gizmo) {
      this._gizmo.update(box)
    } else {
      this._gizmo = buildGizmo(this.scene, this.id, box)
    }
  }

  _updateProjection() {
    const origin = this.group.position.clone()
    origin.y += 0.1524

    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.group.rotation)
    this._raycaster.set(origin, dir)
    const hits = this._raycaster.intersectObjects(this.getRoomMeshes(), false)

    if (!hits.length) { this._projPlane.visible = false; return }

    const hit   = hits[0]
    const dist  = hit.distance
    const projW = dist / THROW_RATIO
    const projH = projW / ASPECT

    this._projPlane.geometry.dispose()
    this._projPlane.geometry = this._buildTrapGeo(projW, projH, this._keystone)
    this._projPlane.visible = true

    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    this._projPlane.position.copy(hit.point).addScaledVector(n, 0.005)
    this._projPlane.lookAt(this._projPlane.position.clone().add(n))
  }

  dispose() {
    this.selected = false
    this.hovered  = false
    this.hideKeystoneUI()
    if (this._selectionBox) {
      this.scene.remove(this._selectionBox)
      this._selectionBox.geometry?.dispose()
      this._selectionBox.material?.dispose()
      this._selectionBox = null
    }
    clearGizmo(this.scene, this._gizmo)
    this._gizmo = null
    this.scene.remove(this.group)
    this.scene.remove(this._projPlane)
    this._projPlane.geometry.dispose()
  }

  get projectionMesh() { return this._projPlane }
}
