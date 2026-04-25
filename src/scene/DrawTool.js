import * as THREE from 'three'
import { snap } from './Snapping.js'

export class DrawTool {
  constructor(scene, camera, renderer, getRoomMeshes) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.getRoomMeshes = getRoomMeshes
    this.mode = null // 'wall' | 'floor'
    this.active = false

    this._raycaster = new THREE.Raycaster()
    this._startPoint = null
    this._previewMesh = null

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
  }

  enable(mode) {
    this.mode = mode
    this.active = true
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerMove)
    el.addEventListener('pointerup', this._onPointerUp)
  }

  disable() {
    this.active = false
    this.mode = null
    this._removePreview()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('pointermove', this._onPointerMove)
    el.removeEventListener('pointerup', this._onPointerUp)
  }

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
  }

  _raycast(e) {
    this._raycaster.setFromCamera(this._ndc(e), this.camera)
    const meshes = this.getRoomMeshes()
    const hits = this._raycaster.intersectObjects(meshes, false)
    return hits.length ? hits[0] : null
  }

  _onPointerDown(e) {
    if (e.button !== 0) return
    const hit = this._raycast(e)
    if (!hit) return
    this._startPoint = hit.point.clone()
    this._startNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
  }

  _onPointerMove(e) {
    if (!this._startPoint) return
    const hit = this._raycast(e)
    if (!hit) return
    this._updatePreview(this._startPoint, hit.point)
  }

  _onPointerUp(e) {
    if (!this._startPoint) return
    const hit = this._raycast(e)
    if (hit) {
      const endPoint = hit.point.clone()
      const shape = this._computeShape(this._startPoint, endPoint)
      if (shape && this.onShapeComplete) {
        this.onShapeComplete(shape, this._startNormal, this.mode)
      }
    }
    this._startPoint = null
    this._startNormal = null
    this._removePreview()
  }

  _computeShape(a, b) {
    if (this.mode === 'floor') {
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
      const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z)
      const w = snap(maxX - minX) || 0.1524
      const d = snap(maxZ - minZ) || 0.1524
      const cx = snap((minX + maxX) / 2)
      const cz = snap((minZ + maxZ) / 2)
      return { type: 'floor', w, d, h: 0, cx, cy: a.y + 0.005, cz }
    } else {
      // wall drawing — project onto wall plane
      const w = snap(Math.abs(b.x - a.x) || Math.abs(b.z - a.z)) || 0.1524
      const h = snap(Math.abs(b.y - a.y)) || 0.1524
      const cy = snap((a.y + b.y) / 2)
      return { type: 'wall', w, h, d: 0, cx: snap((a.x + b.x) / 2), cy, cz: snap((a.z + b.z) / 2), normal: this._startNormal }
    }
  }

  _updatePreview(a, b) {
    this._removePreview()
    const shape = this._computeShape(a, b)
    if (!shape) return

    let geo
    if (shape.type === 'floor') {
      geo = new THREE.PlaneGeometry(shape.w, shape.d)
    } else {
      geo = new THREE.PlaneGeometry(shape.w, shape.h)
    }

    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    })
    this._previewMesh = new THREE.Mesh(geo, mat)

    if (shape.type === 'floor') {
      this._previewMesh.rotation.x = -Math.PI / 2
      this._previewMesh.position.set(shape.cx, shape.cy, shape.cz)
    } else {
      this._previewMesh.position.set(shape.cx, shape.cy, shape.cz)
      if (shape.normal) {
        this._previewMesh.lookAt(
          shape.cx + shape.normal.x,
          shape.cy + shape.normal.y,
          shape.cz + shape.normal.z
        )
      }
    }
    this._previewMesh.layers.set(1)
    this.scene.add(this._previewMesh)
  }

  _removePreview() {
    if (this._previewMesh) {
      this.scene.remove(this._previewMesh)
      this._previewMesh.geometry.dispose()
      this._previewMesh.material.dispose()
      this._previewMesh = null
    }
  }
}
