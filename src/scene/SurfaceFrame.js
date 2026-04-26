import * as THREE from 'three'
import { GRID_UNIT } from './Snapping.js'

const _up = new THREE.Vector3(0, 1, 0)

/**
 * Surface coordinate frame in WORLD SPACE. Independent of how the underlying
 * mesh's local axes happen to be oriented — works for diagonal walls (Polycam
 * sometimes bakes the diagonal directly into local geometry rather than using
 * a node rotation, so local axes don't align with the surface).
 *
 * Convention:
 *   U  — surface tangent, "horizontal" along the wall (world-up × normal),
 *        or world +X for floors/ceilings
 *   V  — the other surface tangent, perpendicular to U on the surface plane
 *   N  — outward world normal at hit
 *   (U, V, N) is right-handed: U × V = N
 */
export class SurfaceFrame {
  constructor(hit) {
    this.object = hit.object
    this.object.updateWorldMatrix(true, false)

    this.worldNormal = hit.face.normal.clone()
      .transformDirection(this.object.matrixWorld).normalize()

    if (Math.abs(this.worldNormal.y) > 0.9) {
      // Floor or ceiling — pick a fixed world tangent
      this.worldU = new THREE.Vector3(1, 0, 0)
    } else {
      this.worldU = new THREE.Vector3().crossVectors(_up, this.worldNormal).normalize()
    }
    this.worldV = new THREE.Vector3().crossVectors(this.worldNormal, this.worldU).normalize()

    this.worldHit = hit.point.clone()
    // Plane equation: N · X = planeD
    this.planeD = this.worldNormal.dot(this.worldHit)
  }

  to2D(worldPoint) {
    return [worldPoint.dot(this.worldU), worldPoint.dot(this.worldV)]
  }

  /** Convert (u, v) back to a world point on this surface plane. */
  to3DWorld(u, v) {
    const p = this.worldU.clone().multiplyScalar(u)
    p.addScaledVector(this.worldV, v)
    // Pin to the plane: add the normal component so N · p = planeD
    const dN = this.planeD - this.worldNormal.dot(p)
    p.addScaledVector(this.worldNormal, dN)
    return p
  }

  snap2D(u, v) {
    return [
      Math.round(u / GRID_UNIT) * GRID_UNIT,
      Math.round(v / GRID_UNIT) * GRID_UNIT,
    ]
  }

  isFloor() { return this.worldNormal.y > 0.7 }

  /** Quaternion taking +X→U, +Y→V, +Z→N. Right-handed by construction. */
  worldQuaternion() {
    const m = new THREE.Matrix4().makeBasis(this.worldU, this.worldV, this.worldNormal)
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }
}

/**
 * Serializable descriptor for a drawn rectangle. Stored in Yjs and used to
 * respawn the shape on remote clients.
 */
export function makeShapeDesc(frame, surface, u0, v0, u1, v1, extrude = 0) {
  // Snap each corner so edges always land on grid lines, regardless of width
  const su = Math.round(u0 / GRID_UNIT) * GRID_UNIT
  const eu = Math.round(u1 / GRID_UNIT) * GRID_UNIT
  const sv = Math.round(v0 / GRID_UNIT) * GRID_UNIT
  const ev = Math.round(v1 / GRID_UNIT) * GRID_UNIT
  const width  = Math.max(Math.abs(eu - su), GRID_UNIT)
  const height = Math.max(Math.abs(ev - sv), GRID_UNIT)
  const cu = (su + eu) / 2
  const cv = (sv + ev) / 2

  const center = frame.to3DWorld(cu, cv)
  const quat   = frame.worldQuaternion()

  return {
    surface,
    parentName: frame.object.name,
    centerWorld: [center.x, center.y, center.z],
    quat: [quat.x, quat.y, quat.z, quat.w],
    width, height, extrude,
  }
}
