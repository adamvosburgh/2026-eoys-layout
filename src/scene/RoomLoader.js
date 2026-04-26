import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

export class RoomLoader {
  constructor(scene) {
    this.scene = scene
    this._roomGroup = null
    this._wallMeshes = []
    this._floorMeshes = []
    this._allMeshes = []
  }

  async load(slug) {
    this._clear()
    const gltf = await loader.loadAsync(`/models/${slug}/room.glb`)
    const root = gltf.scene

    this._wallMeshes = []
    this._floorMeshes = []
    this._allMeshes = []

    const meshes = []
    root.traverse(child => { if (child.isMesh) meshes.push(child) })

    for (const child of meshes) {
      if (!child.geometry.attributes.normal) {
        child.geometry.computeVertexNormals()
      }
      if (this._isCeiling(child)) { child.visible = false; continue }

      child.castShadow = true
      child.receiveShadow = true

      const name = child.name.toLowerCase()
      if (name.startsWith('floor_')) {
        this._floorMeshes.push(child)
      } else if (name.startsWith('wall_') || name.startsWith('joint_')) {
        this._wallMeshes.push(child)
      }
      this._allMeshes.push(child)
    }

    this._roomGroup = root
    this.scene.add(root)
    return root
  }

  _isCeiling(mesh) {
    const normals = mesh.geometry.attributes.normal
    if (!normals) return false
    let sumY = 0
    for (let i = 0; i < normals.count; i++) sumY += normals.getY(i)
    return (sumY / normals.count) < -0.5
  }

  _clear() {
    if (this._roomGroup) {
      this.scene.remove(this._roomGroup)
      this._roomGroup.traverse(c => { if (c.isMesh) c.geometry.dispose() })
      this._roomGroup = null
    }
    this._wallMeshes = []
    this._floorMeshes = []
    this._allMeshes = []
  }

  getWallMeshes()   { return this._wallMeshes }
  getFloorMeshes()  { return this._floorMeshes }
  getAllRoomMeshes() { return this._allMeshes }
}
