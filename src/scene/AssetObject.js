import * as THREE from 'three'
import { snap } from './Snapping.js'

const SEL_MAT = new THREE.MeshBasicMaterial({
  color: 0x00ff00,
  wireframe: true,
  transparent: true,
  opacity: 0.5,
})

export class AssetObject {
  constructor({ id, type, name, description, geometry, position, rotation, scene, mesh }) {
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

    if (position) {
      this.group.position.set(...position)
    }
    if (rotation) {
      this.group.rotation.set(...rotation)
    }

    this._selectionBox = null
    this.selected = false

    scene.add(this.group)
    this._buildLabel()
  }

  _buildLabel() {
    // Label is managed by LabelManager via CSS2DRenderer; we just expose the name
  }

  setPosition(x, y, z) {
    this.group.position.set(snap(x), y, snap(z))
  }

  setRotationY(radY) {
    this.group.rotation.y = radY
  }

  select() {
    if (this.selected) return
    this.selected = true
    if (this._mesh) {
      const box = new THREE.BoxHelper(this._mesh, 0x00ff00)
      box.layers.set(1)
      this.group.add(box)
      this._selectionBox = box
    }
  }

  deselect() {
    if (!this.selected) return
    this.selected = false
    if (this._selectionBox) {
      this.group.remove(this._selectionBox)
      this._selectionBox.geometry.dispose()
      this._selectionBox = null
    }
  }

  dispose() {
    this.deselect()
    this.scene.remove(this.group)
    this.group.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }
}
