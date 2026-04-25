import * as THREE from 'three'
import { snap } from './Snapping.js'

const THROW_RATIO = 1.63
const ASPECT = 16 / 10

export class Projector {
  constructor({ id, scene, getRoomMeshes }) {
    this.id = id
    this.scene = scene
    this.getRoomMeshes = getRoomMeshes

    this._raycaster = new THREE.Raycaster()

    // Projector body (small box placeholder)
    const bodyGeo = new THREE.BoxGeometry(0.3048, 0.1524, 0.4572) // 1'×6"×18"
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x333333 })
    this.body = new THREE.Mesh(bodyGeo, bodyMat)
    this.body.layers.set(1)

    this.group = new THREE.Group()
    this.group.add(this.body)
    this.group.userData.assetObjectId = id
    this.group.layers.set(1)
    scene.add(this.group)

    // Projection rectangle
    const projGeo = new THREE.PlaneGeometry(1, 1)
    const projMat = new THREE.MeshBasicMaterial({
      color: 0xfffde7,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this._projPlane = new THREE.Mesh(projGeo, projMat)
    this._projPlane.layers.set(1)
    this._projPlane.visible = false
    scene.add(this._projPlane)
  }

  setPosition(x, y, z) {
    this.group.position.set(snap(x), y, snap(z))
    this._updateProjection()
  }

  setRotationY(radY) {
    this.group.rotation.y = radY
    this._updateProjection()
  }

  _updateProjection() {
    const origin = this.group.position.clone()
    origin.y += 0.1524 // approx lens height offset

    // Forward direction in projector local space is -Z
    const dir = new THREE.Vector3(0, 0, -1)
    dir.applyEuler(this.group.rotation)

    this._raycaster.set(origin, dir)
    const hits = this._raycaster.intersectObjects(this.getRoomMeshes(), false)

    if (hits.length === 0) {
      this._projPlane.visible = false
      return
    }

    const hit = hits[0]
    const dist = hit.distance
    const projW = dist / THROW_RATIO
    const projH = projW / ASPECT

    this._projPlane.visible = true
    this._projPlane.scale.set(projW, projH, 1)

    // Position slightly off the wall surface
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    this._projPlane.position.copy(hit.point).addScaledVector(n, 0.005)
    this._projPlane.lookAt(this._projPlane.position.clone().add(n))
  }

  dispose() {
    this.scene.remove(this.group)
    this.scene.remove(this._projPlane)
  }

  get projectionMesh() {
    return this._projPlane
  }
}
