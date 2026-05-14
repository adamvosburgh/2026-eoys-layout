import * as THREE from 'three'
import { snap } from './Snapping.js'
import { SEL_MAT, buildGizmo, clearGizmo } from './_gizmoUtils.js'

export { SEL_MAT }

export class AssetObject {
  constructor({ id, type, name, description, position, rotation, scene, mesh }) {
    this.id = id
    this.type = type
    this.name = name
    this.description = description || ''
    this.scene = scene

    this.group = new THREE.Group()
    this.group.userData.assetObjectId = id
    this.group.layers.set(1)

    if (mesh) {
      mesh.layers.set(1)
      this.group.add(mesh)
      this._mesh = mesh
    }

    if (position) this.group.position.set(...position)
    if (rotation) this.group.rotation.set(...rotation)

    this._selectionBox = null
    this._gizmo = null
    this.selected = false
    this.hovered = false

    scene.add(this.group)
  }

  setPosition(x, y, z) {
    // Outlets ride on wall surfaces — snapping X/Z to a floor grid would
    // pull them off the wall.
    if (this.type === 'outlet') {
      this.group.position.set(x, y, z)
    } else {
      this.group.position.set(snap(x), y, snap(z))
    }
    this._refreshSelectionBox()
  }

  setRotationY(radY) {
    this.group.rotation.y = radY
    this._refreshSelectionBox()
  }

  setRotation(x, y, z) {
    this.group.rotation.set(x, y, z)
    this._refreshSelectionBox()
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

  dispose() {
    this.selected = false
    this.hovered  = false
    if (this._selectionBox) {
      this.scene.remove(this._selectionBox)
      this._selectionBox.geometry?.dispose()
      this._selectionBox.material?.dispose()
      this._selectionBox = null
    }
    clearGizmo(this.scene, this._gizmo)
    this._gizmo = null
    this.scene.remove(this.group)
    this.group.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose())
        else child.material?.dispose()
      }
    })
  }
}
