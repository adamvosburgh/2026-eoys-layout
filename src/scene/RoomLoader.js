import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

const WHITE_MAT = new THREE.MeshStandardMaterial({
  color:     0xf2f2f2,
  roughness: 0.85,
  metalness: 0.0,
  side:      THREE.FrontSide,
})

const CEILING_MAT = new THREE.MeshStandardMaterial({
  color:     0xf2f2f2,
  roughness: 0.85,
  metalness: 0.0,
  side:      THREE.FrontSide,
})

export class RoomLoader {
  constructor(scene) {
    this.scene = scene
    this._roomGroup = null
    this._wallMeshes = []
    this._floorMeshes = []
    this._ceilingMeshes = []
    this._allMeshes = []
    this._originalMaterials = new WeakMap()  // mesh → polycam material
    this.useWhite = true
    this.floorTopY = 0  // top surface of the floor (Polycam exports thick floor slabs)
  }

  async load(slug) {
    this._clear()
    const gltf = await loader.loadAsync(`/models/${slug}/room.glb`)
    const root = gltf.scene

    this._wallMeshes = []
    this._floorMeshes = []
    this._ceilingMeshes = []
    this._allMeshes = []

    const meshes = []
    root.traverse(child => { if (child.isMesh) meshes.push(child) })

    for (const child of meshes) {
      if (!child.geometry.attributes.normal) {
        child.geometry.computeVertexNormals()
      }

      if (this._isCeiling(child)) {
        this._originalMaterials.set(child, child.material)
        child.material = CEILING_MAT
        child.castShadow = false
        child.receiveShadow = false
        this._ceilingMeshes.push(child)
        continue
      }

      child.castShadow = true
      child.receiveShadow = true

      // Stash polycam material; swap to white if requested
      this._originalMaterials.set(child, child.material)
      if (this.useWhite) child.material = WHITE_MAT

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

    // Compute floor TOP — the surface things should sit on. Polycam floor
    // meshes are thick slabs, so meta.floorY (bbox.min.y) is the underside.
    let topY = -Infinity
    for (const m of this._floorMeshes) {
      const box = new THREE.Box3().setFromObject(m)
      if (box.max.y > topY) topY = box.max.y
    }
    this.floorTopY = isFinite(topY) ? topY : 0

    return root
  }

  _isCeiling(mesh) {
    if (mesh.name.toLowerCase().startsWith('ceiling')) return true
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
    this._ceilingMeshes = []
    this._allMeshes = []
  }

  getWallMeshes()   { return this._wallMeshes }
  getFloorMeshes()  { return this._floorMeshes }
  getAllRoomMeshes() { return this._allMeshes }

  setUseWhite(v) {
    this.useWhite = !!v
    for (const m of this._allMeshes) {
      const orig = this._originalMaterials.get(m)
      m.material = this.useWhite ? WHITE_MAT : (orig || m.material)
    }
    for (const m of this._ceilingMeshes) {
      const orig = this._originalMaterials.get(m)
      if (!this.useWhite && orig) {
        orig.transparent = true
        orig.opacity = 0.5
        orig.depthWrite = false
        m.material = orig
      } else {
        m.material = CEILING_MAT
      }
    }
  }
}
