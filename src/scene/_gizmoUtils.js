import * as THREE from 'three'

export const ACCENT = 0x00ff00

export const SEL_MAT = new THREE.LineBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
})

const AXIS_COLOR = { x: 0xff3333, y: 0x00ff00, z: 0x3399ff }

// Rotations to orient a Y-up arrow group along each world axis/direction
const ARROW_EULERS = [
  { axis: 'x', euler: [0, 0, -Math.PI / 2] },    // +X face
  { axis: 'x', euler: [0, 0,  Math.PI / 2] },    // -X face
  { axis: 'y', euler: [0, 0,  0]           },    // +Y face
  { axis: 'y', euler: [Math.PI, 0, 0]      },    // -Y face
  { axis: 'z', euler: [ Math.PI / 2, 0, 0] },    // +Z face
  { axis: 'z', euler: [-Math.PI / 2, 0, 0] },    // -Z face
]

// Arrow: shaft + cone pointing away from face
const SHAFT_LEN = 0.064
const CONE_LEN  = 0.044
const SHAFT_R   = 0.006
const CONE_R    = 0.020
const FACE_GAP  = 0.012  // gap between bbox face and arrow base
const ARC_TUBE  = 0.004
const ARC_ANGLE = Math.PI * 0.65  // ~117° arc

function makeArrow(mat) {
  const g = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, SHAFT_LEN, 5), mat)
  shaft.position.y = SHAFT_LEN / 2
  const cone  = new THREE.Mesh(new THREE.ConeGeometry(CONE_R, CONE_LEN, 7), mat)
  cone.position.y = SHAFT_LEN + CONE_LEN / 2
  g.add(shaft, cone)
  return g
}

function facePositions(box, center) {
  return [
    new THREE.Vector3(box.max.x + FACE_GAP, center.y,   center.z  ),  // +X
    new THREE.Vector3(box.min.x - FACE_GAP, center.y,   center.z  ),  // -X
    new THREE.Vector3(center.x,   box.max.y + FACE_GAP, center.z  ),  // +Y
    new THREE.Vector3(center.x,   box.min.y - FACE_GAP, center.z  ),  // -Y
    new THREE.Vector3(center.x,   center.y,   box.max.z + FACE_GAP),  // +Z
    new THREE.Vector3(center.x,   center.y,   box.min.z - FACE_GAP),  // -Z
  ]
}

function arcRadius(size, axis) {
  if (axis === 'y') return Math.min(Math.max(Math.max(size.x, size.z) * 0.5 + 0.026, 0.09), 0.28)
  if (axis === 'x') return Math.min(Math.max(Math.max(size.y, size.z) * 0.5 + 0.026, 0.09), 0.28)
  /* z */           return Math.min(Math.max(Math.max(size.x, size.y) * 0.5 + 0.026, 0.09), 0.28)
}

// Torus default lies in XY plane (rotates around Z).
// These eulers orient each arc to encircle its axis:
const ARC_EULERS = {
  y: [-Math.PI / 2, 0, 0],  // XZ plane → encircles Y
  x: [0, Math.PI / 2, 0],   // YZ plane → encircles X
  z: [0, 0, 0],             // XY plane → encircles Z
}

/**
 * Build the full transform gizmo and add meshes to scene.
 * Returns { translateHandles, rotateHandles, update(box) }
 * translateHandles[axis] is an array of 2 arrow Groups (+ and − face).
 */
export function buildGizmo(scene, id, box) {
  const center = new THREE.Vector3()
  box.getCenter(center)
  const size = new THREE.Vector3()
  box.getSize(size)

  const translateHandles = { x: [], y: [], z: [] }
  const rotateHandles    = {}

  // ── 6 translate arrows ───────────────────────────────────────────────
  const positions = facePositions(box, center)
  ARROW_EULERS.forEach(({ axis, euler }, i) => {
    const mat   = new THREE.MeshBasicMaterial({ color: AXIS_COLOR[axis], depthTest: false, transparent: true, opacity: 0.5 })
    const arrow = makeArrow(mat)
    arrow.rotation.set(...euler)
    arrow.position.copy(positions[i])
    arrow.renderOrder = 1000
    arrow.userData.isTranslateHandle = true
    arrow.userData.translateAxis     = axis
    arrow.userData.assetObjectId     = id
    scene.add(arrow)
    translateHandles[axis].push(arrow)
  })

  // ── 3 rotate arcs ────────────────────────────────────────────────────
  for (const axis of ['x', 'y', 'z']) {
    const r   = arcRadius(size, axis)
    const geo = new THREE.TorusGeometry(r, ARC_TUBE, 4, 24, ARC_ANGLE)
    const mat = new THREE.MeshBasicMaterial({
      color: AXIS_COLOR[axis], depthTest: false, transparent: true, opacity: 0.5,
    })
    const arc = new THREE.Mesh(geo, mat)
    arc.rotation.set(...ARC_EULERS[axis])
    arc.position.copy(center)
    arc.renderOrder = 1000
    arc.userData.isRotateHandle = true
    arc.userData.rotateAxis     = axis
    arc.userData.assetObjectId  = id
    scene.add(arc)
    rotateHandles[axis] = arc
  }

  // update() repositions handles without recreating geometry (cheap, called during drag)
  const update = (newBox) => {
    const nc = new THREE.Vector3()
    newBox.getCenter(nc)
    const newPositions = facePositions(newBox, nc)
    const allArrows = [...translateHandles.x, ...translateHandles.y, ...translateHandles.z]
    allArrows.forEach((a, i) => a.position.copy(newPositions[i]))
    for (const arc of Object.values(rotateHandles)) arc.position.copy(nc)
  }

  return { translateHandles, rotateHandles, update }
}

/** Remove all gizmo meshes from scene and dispose their geometry/materials. */
export function clearGizmo(scene, gizmo) {
  if (!gizmo) return
  for (const arrows of Object.values(gizmo.translateHandles)) {
    for (const g of arrows) {
      scene.remove(g)
      g.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose() } })
    }
  }
  for (const arc of Object.values(gizmo.rotateHandles)) {
    scene.remove(arc)
    arc.geometry.dispose()
    arc.material.dispose()
  }
}
