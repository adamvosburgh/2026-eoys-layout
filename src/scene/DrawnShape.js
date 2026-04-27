import * as THREE from 'three'
import { GRID_UNIT } from './Snapping.js'

const ACCENT = 0x00ff00

/**
 * A user-drawn rectangle on a wall or floor surface. Lives in world space:
 * `desc.centerWorld` and `desc.quat` define its position and orientation.
 * `desc.parentName` is kept only for drag (raycast against the same surface).
 *
 * The group's local axes after applying `quat`:
 *   +X = surface U (horizontal along wall, world +X for floors)
 *   +Y = surface V
 *   +Z = outward surface normal
 * Width along +X, height along +Y, extrude along +Z.
 */
export class DrawnShape {
  constructor({ id, scene, desc, colorRefs, parentMesh }) {
    this.id = id
    this.scene = scene
    this.parentMesh = parentMesh    // for drag raycast
    this.desc = { ...desc }
    this.colorRefs = colorRefs
    this.type = 'drawn'

    this.group = new THREE.Group()
    this.group.userData.assetObjectId = id
    this.group.userData.kind = 'drawn'
    scene.add(this.group)

    this._mesh = null
    this._wireframe = null
    this._extrudeHandle = null
    this.selected = false
    this.hovered = false

    this._applyTransform()
    this._rebuildMesh()
  }

  _applyTransform() {
    const d = this.desc
    if (d.centerWorld) this.group.position.set(...d.centerWorld)
    if (d.quat)        this.group.quaternion.set(...d.quat)
  }

  _rebuildMesh() {
    if (this._mesh) {
      this.group.remove(this._mesh)
      this._mesh.geometry.dispose()
      this._mesh.material.dispose()
    }
    if (this._wireframe) {
      this.group.remove(this._wireframe)
      this._wireframe.geometry.dispose()
    }

    const ext = Math.max(this.desc.extrude || 0, 0.005)
    const isFlat = (this.desc.extrude || 0) < 0.005

    const boxGeo = new THREE.BoxGeometry(this.desc.width, this.desc.height, ext)
    boxGeo.translate(0, 0, ext / 2)

    const colorRef = this.desc.surface === 'floor'
      ? this.colorRefs.drawnFloor : this.colorRefs.drawnWall
    const mat = new THREE.MeshStandardMaterial({
      color: colorRef.getHex(),
      roughness: 0.7,
      metalness: 0.0,
      transparent: isFlat,
      opacity: isFlat ? 0.5 : 1.0,
    })
    this._mesh = new THREE.Mesh(boxGeo, mat)
    this._mesh.castShadow = !isFlat
    this._mesh.receiveShadow = true
    this.group.add(this._mesh)

    const wireGeo = new THREE.EdgesGeometry(boxGeo)
    const wireMat = new THREE.LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0,
      depthTest: false,
    })
    this._wireframe = new THREE.LineSegments(wireGeo, wireMat)
    this._wireframe.renderOrder = 999
    this._wireframe.raycast = () => {}     // never picked
    this.group.add(this._wireframe)

    if (this._extrudeHandle) this._refreshExtrudeHandle()
    this._refreshOutlineVisibility()
  }

  setCenterWorld(x, y, z) {
    this.desc.centerWorld = [x, y, z]
    this.group.position.set(x, y, z)
  }

  setExtrude(extrude) {
    this.desc.extrude = Math.max(extrude, 0)
    this._rebuildMesh()
  }

  worldOutwardDir() {
    return new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()))
  }

  worldOrigin() {
    return this.group.getWorldPosition(new THREE.Vector3())
  }

  hoverOn() { this.hovered = true; this._refreshOutlineVisibility() }
  hoverOff() { this.hovered = false; this._refreshOutlineVisibility() }

  select() {
    this.selected = true
    this._refreshOutlineVisibility()
    if (!this._extrudeHandle) this._buildExtrudeHandle()
  }

  deselect() {
    this.selected = false
    this._refreshOutlineVisibility()
    this._removeExtrudeHandle()
  }

  _refreshOutlineVisibility() {
    if (!this._wireframe) return
    this._wireframe.material.opacity =
      this.selected ? 1.0 :
      this.hovered  ? 0.35 : 0
  }

  _buildExtrudeHandle() {
    // Small enough that clicks adjacent to the shape don't accidentally hit it,
    // but large enough to grab. Sticks out ~3cm from the outer face.
    const headGeo = new THREE.SphereGeometry(0.022, 16, 12)
    const stemGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8)
    stemGeo.rotateX(Math.PI / 2)
    stemGeo.translate(0, 0, 0.015)

    const mat = new THREE.MeshBasicMaterial({
      color: ACCENT, depthTest: false, transparent: true, opacity: 1,
    })
    const head = new THREE.Mesh(headGeo, mat)
    const stem = new THREE.Mesh(stemGeo, mat)
    head.position.set(0, 0, 0.03)

    const handle = new THREE.Group()
    handle.add(stem); handle.add(head)
    handle.userData.isExtrudeHandle = true
    handle.userData.targetId = this.id
    head.userData.isExtrudeHandle = true
    head.userData.targetId = this.id
    stem.userData.isExtrudeHandle = true
    stem.userData.targetId = this.id
    handle.renderOrder = 1000
    head.renderOrder = 1000
    stem.renderOrder = 1000

    this._extrudeHandle = handle
    this._refreshExtrudeHandle()
    this.group.add(handle)
  }

  _refreshExtrudeHandle() {
    if (!this._extrudeHandle) return
    const ext = Math.max(this.desc.extrude || 0, 0.005)
    this._extrudeHandle.position.set(0, 0, ext)
  }

  _removeExtrudeHandle() {
    if (this._extrudeHandle) {
      this.group.remove(this._extrudeHandle)
      this._extrudeHandle.traverse(c => {
        if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose() }
      })
      this._extrudeHandle = null
    }
  }

  static snap1D(v) { return Math.round(v / GRID_UNIT) * GRID_UNIT }

  dispose() {
    this.deselect()
    this.hoverOff()
    if (this.group.parent) this.group.parent.remove(this.group)
    this.group.traverse(c => {
      if (c.isMesh || c.isLineSegments) {
        c.geometry?.dispose()
        c.material?.dispose()
      }
    })
  }
}
