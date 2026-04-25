import * as THREE from 'three'
import { GRID_UNIT } from './Snapping.js'

// World-space grid baked into the mesh material.
// Uses fract/step — no fwidth needed, works on all WebGL targets.
export const gridMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    gridUnit:     { value: GRID_UNIT },
    showGrid:     { value: 1.0 },
    surfaceColor: { value: new THREE.Color(0xffffff) },
    lineColor:    { value: new THREE.Color(0xbbbbbb) },
    lineHW:       { value: 0.05 }, // half-width as fraction of gridUnit
  },
  vertexShader: /* glsl */`
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 wp     = modelMatrix * vec4(position, 1.0);
      vWorldPos   = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float gridUnit;
    uniform float showGrid;
    uniform vec3  surfaceColor;
    uniform vec3  lineColor;
    uniform float lineHW;

    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    // 1.0 when coord falls within lineHW of a grid line, 0.0 otherwise
    float gridLine(float coord) {
      float c = fract(coord / gridUnit);          // 0..1 within each cell
      return max(step(c, lineHW), step(1.0 - lineHW, c));
    }

    void main() {
      vec3  n  = abs(normalize(vWorldNormal));
      float gx = gridLine(vWorldPos.x);
      float gy = gridLine(vWorldPos.y);
      float gz = gridLine(vWorldPos.z);

      // Each face shows the two grid axes that lie along its surface
      float onGrid =
        n.y * max(gx, gz) +   // floor / ceiling → X,Z lines
        n.x * max(gy, gz) +   // X-facing wall   → Y,Z lines
        n.z * max(gx, gy);    // Z-facing wall   → X,Y lines

      onGrid = clamp(onGrid * showGrid, 0.0, 1.0);
      gl_FragColor = vec4(mix(surfaceColor, lineColor, onGrid), 1.0);
    }
  `,
})

export function setGridVisible(v) {
  gridMaterial.uniforms.showGrid.value = v ? 1.0 : 0.0
}
