import * as THREE from 'three'
import { snap } from './Snapping.js'
import { SEL_MAT, buildGizmo, clearGizmo } from './_gizmoUtils.js'

const THROW_RATIO = 1.63
const ASPECT = 16 / 10

export class Projector {
  constructor({ id, scene, getRoomMeshes, filePath, gltfLoader }) {
    this.id = id
    this.scene = scene
    this.getRoomMeshes = getRoomMeshes

    this._raycaster = new THREE.Raycaster()

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
        // Center XZ, bottom-align Y (same as regular asset spawn)
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

    // Projection rectangle
    const projMat = new THREE.MeshBasicMaterial({
      color: 0xfffde7,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this._projPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), projMat)
    this._projPlane.layers.set(1)
    this._projPlane.visible = false
    scene.add(this._projPlane)

    this._selectionBox = null
    this._gizmo = null
    this.selected = false
    this.hovered  = false
  }

  _buildPlaceholder() {
    const geo = new THREE.BoxGeometry(0.3048, 0.1524, 0.4572)
    const mat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.1 })
    this._bodyMesh = new THREE.Mesh(geo, mat)
    this._bodyMesh.position.y = 0.1524 / 2  // bottom-align
    this._bodyMesh.castShadow = true
    this._bodyMesh.layers.set(1)
    this.group.add(this._bodyMesh)
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

    const hit = hits[0]
    const dist = hit.distance
    const projW = dist / THROW_RATIO
    const projH = projW / ASPECT

    this._projPlane.visible = true
    this._projPlane.scale.set(projW, projH, 1)

    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    this._projPlane.position.copy(hit.point).addScaledVector(n, 0.005)
    this._projPlane.lookAt(this._projPlane.position.clone().add(n))
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
    this.scene.remove(this._projPlane)
  }

  get projectionMesh() { return this._projPlane }
}
