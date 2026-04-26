import * as THREE from 'three'
import { SurfaceFrame, makeShapeDesc } from './SurfaceFrame.js'
import { GRID_UNIT } from './Snapping.js'

export class DrawTool {
  constructor(scene, camera, renderer, getRoomMeshes) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.getRoomMeshes = getRoomMeshes
    this.mode = null
    this.active = false
    this.onShapeComplete = null
    this.onSizeChange = null  // (w, h, mode, screenXY) — for live size label

    this._raycaster = new THREE.Raycaster()
    this._raycaster.layers.enableAll()

    this._frame = null
    this._startUV = null
    this._endUV = null
    this._lastEvent = null

    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this._previewMesh = new THREE.Mesh(geo, mat)
    this._previewMesh.renderOrder = 3
    this._previewMesh.visible = false
    this.scene.add(this._previewMesh)

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
  }

  enable(mode) {
    if (this.active) { this.mode = mode; return }
    this.mode = mode
    this.active = true
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerMove)
    el.addEventListener('pointerup', this._onPointerUp)
  }

  disable() {
    if (!this.active) return
    this.active = false
    this.mode = null
    this._frame = null
    this._startUV = this._endUV = null
    this._previewMesh.visible = false
    this.onSizeChange?.(null, null, null, null)
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

  _onPointerDown(e) {
    if (e.button !== 0) return
    this._lastEvent = e
    this._raycaster.setFromCamera(this._ndc(e), this.camera)
    const hits = this._raycaster.intersectObjects(this.getRoomMeshes(), false)
    if (!hits.length) return
    const hit = hits[0]

    const frame = new SurfaceFrame(hit)
    if (this.mode === 'floor' && !frame.isFloor()) return
    if (this.mode === 'wall'  &&  frame.isFloor()) return

    this._frame = frame
    const [u, v] = frame.to2D(frame.worldHit)
    this._startUV = frame.snap2D(u, v)
    this._endUV = this._startUV.slice()
    this._renderPreview()
  }

  _onPointerMove(e) {
    if (!this._frame) return
    this._lastEvent = e
    this._raycaster.setFromCamera(this._ndc(e), this.camera)
    const hits = this._raycaster.intersectObject(this._frame.object, false)
    if (!hits.length) return
    const [u, v] = this._frame.to2D(hits[0].point)
    this._endUV = this._frame.snap2D(u, v)
    this._renderPreview()
  }

  _onPointerUp() {
    if (!this._frame || !this._startUV) {
      this._previewMesh.visible = false
      this.onSizeChange?.(null, null, null, null)
      return
    }
    const [u0, v0] = this._startUV
    const [u1, v1] = this._endUV

    if (Math.abs(u1 - u0) < GRID_UNIT * 0.5 && Math.abs(v1 - v0) < GRID_UNIT * 0.5) {
      this._previewMesh.visible = false
      this.onSizeChange?.(null, null, null, null)
      this._frame = null
      this._startUV = this._endUV = null
      return
    }

    if (this.onShapeComplete) {
      const desc = makeShapeDesc(this._frame, this.mode, u0, v0, u1, v1, 0)
      this.onShapeComplete(desc)
    }

    this._previewMesh.visible = false
    this.onSizeChange?.(null, null, null, null)
    this._frame = null
    this._startUV = this._endUV = null
  }

  _renderPreview() {
    if (!this._frame || !this._startUV || !this._endUV) {
      this._previewMesh.visible = false
      return
    }
    const f = this._frame
    const [u0, v0] = this._startUV
    const [u1, v1] = this._endUV

    const w = Math.max(Math.abs(u1 - u0), GRID_UNIT)
    const h = Math.max(Math.abs(v1 - v0), GRID_UNIT)
    const cu = (u0 + u1) / 2
    const cv = (v0 + v1) / 2

    const center = f.to3DWorld(cu, cv)
    // Lift slightly off the surface to avoid z-fight
    center.addScaledVector(f.worldNormal, 0.003)

    this._previewMesh.position.copy(center)
    this._previewMesh.quaternion.copy(f.worldQuaternion())
    this._previewMesh.scale.set(w, h, 1)
    this._previewMesh.visible = true

    if (this.onSizeChange && this._lastEvent) {
      this.onSizeChange(w, h, this.mode, [this._lastEvent.clientX, this._lastEvent.clientY])
    }
  }
}
