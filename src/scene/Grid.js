import * as THREE from 'three'
import { GRID_UNIT } from './Snapping.js'

const VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec3 offsetPos = position + normalize(normal) * 0.003;
    vec4 wp = modelMatrix * vec4(offsetPos, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform vec3  uColor;
  uniform float uGridSize;
  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;

  float gridLine(vec2 uv) {
    vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
    return 1.0 - min(min(g.x, g.y), 1.5);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n  = normalize(vWorldNormal);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 u, v;
    if (abs(n.y) > 0.9) {
      u = vec3(1.0, 0.0, 0.0);
    } else {
      u = normalize(cross(up, n));
    }
    v = normalize(cross(n, u));
    vec2 coord = vec2(dot(vWorldPos, u), dot(vWorldPos, v));
    float alpha = gridLine(coord / uGridSize) * 0.35;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

export class Grid {
  constructor(scene) {
    this.scene   = scene
    this.visible = true
    this._overlays = []

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: new THREE.Color(0xe8e8e8) },
        uGridSize: { value: GRID_UNIT },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
    })

    const hoverGeo = new THREE.PlaneGeometry(GRID_UNIT, GRID_UNIT)
    this._hoverMat = new THREE.MeshBasicMaterial({
      color:       0x00ff00,
      transparent: true,
      opacity:     0.5,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    })
    this._hover = new THREE.Mesh(hoverGeo, this._hoverMat)
    this._hover.renderOrder = 2
    this._hover.visible = false
    this.scene.add(this._hover)
  }

  build(roomMeshes = []) {
    for (const ov of this._overlays) ov.parent?.remove(ov)
    this._overlays = []
    for (const mesh of roomMeshes) {
      const ov = new THREE.Mesh(mesh.geometry, this._mat)
      ov.visible = this.visible
      ov.renderOrder = 1
      ov.frustumCulled = false
      mesh.add(ov)
      this._overlays.push(ov)
    }
  }

  showHover(hit) {
    if (!hit || !hit.face) { this.hideHover(); return }
    const obj = hit.object
    obj.updateWorldMatrix(true, false)

    const worldNormal = hit.face.normal.clone()
      .transformDirection(obj.matrixWorld).normalize()

    // World tangent basis matching the shader
    let U
    if (Math.abs(worldNormal.y) > 0.9) U = new THREE.Vector3(1, 0, 0)
    else U = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), worldNormal).normalize()
    const V = new THREE.Vector3().crossVectors(worldNormal, U).normalize()

    // Hit's (u, v) in world coords, snap to nearest grid CENTER
    const wp = hit.point
    const u = wp.dot(U), v = wp.dot(V)
    const su = (Math.floor(u / GRID_UNIT) + 0.5) * GRID_UNIT
    const sv = (Math.floor(v / GRID_UNIT) + 0.5) * GRID_UNIT

    // World point on the wall plane at (su, sv)
    const planeD = worldNormal.dot(wp)
    const pos = U.clone().multiplyScalar(su).addScaledVector(V, sv)
    const dN = planeD - worldNormal.dot(pos)
    pos.addScaledVector(worldNormal, dN + 0.006)

    this._hover.position.copy(pos)
    this._hover.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal)
    this._hover.visible = this.visible
  }

  hideHover() { this._hover.visible = false }

  setVisible(v) {
    this.visible = v
    for (const ov of this._overlays) ov.visible = v
    if (!v) this.hideHover()
  }
}
