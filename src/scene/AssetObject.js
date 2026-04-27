import * as THREE from 'three'
import { snap } from './Snapping.js'

const ACCENT = 0x00ff00

export const SEL_MAT = new THREE.LineBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
})

const HANDLE_DEFS = [
  { axis: 'x', color: 0xff3333, euler: [0, Math.PI / 2, 0] },
  { axis: 'y', color: 0x00ff00, euler: [-Math.PI / 2, 0, 0] },
  { axis: 'z', color: 0x3399ff, euler: [0, 0, 0] },
]

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
    this._rotateHandles = null
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

  setRotation(x, y, z) {
    this.group.rotation.set(x, y, z)
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
    const wantBox     = this.selected || this.hovered
    const wantHandles = this.selected

    if (this._selectionBox) {
      this.scene.remove(this._selectionBox)
      this._selectionBox.geometry?.dispose()
      this._selectionBox.material?.dispose()
      this._selectionBox = null
    }

    if (!wantBox) {
      this._clearRotateHandles()
      return
    }

    const box = new THREE.Box3().setFromObject(this.group)

    this._selectionBox = new THREE.Box3Helper(box, ACCENT)
    this._selectionBox.material = new THREE.LineBasicMaterial({
      color: SEL_MAT.color.clone(),
      transparent: true,
      opacity: this.selected ? 1.0 : 0.35,
      depthTest: false,
    })
    this._selectionBox.renderOrder = 999
    this.scene.add(this._selectionBox)

    if (!wantHandles) {
      this._clearRotateHandles()
      return
    }

    const center = new THREE.Vector3()
    box.getCenter(center)
    const size = new THREE.Vector3()
    box.getSize(size)
    const r = (Math.max(size.x, size.y, size.z) * 0.5 + 0.14) * 0.25

    if (this._rotateHandles) {
      // Geometry already exists — just reposition
      for (const mesh of Object.values(this._rotateHandles)) {
        mesh.position.copy(center)
      }
    } else {
      this._buildRotateHandles(center, r)
    }
  }

  _buildRotateHandles(center, r) {
    const tube = Math.max(r * 0.025, 0.004)
    const handles = {}
    for (const { axis, color, euler } of HANDLE_DEFS) {
      const geo = new THREE.TorusGeometry(r, tube, 4, 64)
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(center)
      mesh.rotation.set(...euler)
      mesh.renderOrder = 1000
      mesh.userData.isRotateHandle = true
      mesh.userData.rotateAxis = axis
      mesh.userData.assetObjectId = this.id
      this.scene.add(mesh)
      handles[axis] = mesh
    }
    this._rotateHandles = handles
  }

  _clearRotateHandles() {
    if (!this._rotateHandles) return
    for (const mesh of Object.values(this._rotateHandles)) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this._rotateHandles = null
  }

  dispose() {
    this.deselect()
    this.hoverOff()
    this._clearRotateHandles()
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
