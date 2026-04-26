import * as THREE from 'three'
import { snap } from './Snapping.js'

const ACCENT = 0x00ff00

export const SEL_MAT = new THREE.LineBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
})

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
    this.selected = false
    this.hovered = false

    scene.add(this.group)
  }

  setPosition(x, y, z) {
    this.group.position.set(snap(x), y, snap(z))
    this._refreshSelectionBox()
  }

  setRotationY(radY) {
    this.group.rotation.y = radY
    this._refreshSelectionBox()
  }

  hoverOn() { this.hovered = true; this._refreshSelectionBox() }
  hoverOff() { this.hovered = false; this._refreshSelectionBox() }

  select() {
    this.selected = true
    this._refreshSelectionBox()
  }

  deselect() {
    this.selected = false
    this._refreshSelectionBox()
  }

  _refreshSelectionBox() {
    const want = this.selected || this.hovered
    if (want && !this._selectionBox) {
      const box = new THREE.Box3().setFromObject(this.group)
      this._selectionBox = new THREE.Box3Helper(box, ACCENT)
      this._selectionBox.material = SEL_MAT
      this._selectionBox.renderOrder = 999
      this.scene.add(this._selectionBox)
    } else if (want && this._selectionBox) {
      this._selectionBox.box.setFromObject(this.group)
    } else if (!want && this._selectionBox) {
      this.scene.remove(this._selectionBox)
      this._selectionBox.geometry?.dispose()
      this._selectionBox = null
    }
  }

  dispose() {
    this.deselect()
    this.hoverOff()
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
