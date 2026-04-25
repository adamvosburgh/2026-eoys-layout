export const GRID_UNIT = 0.1524 // 6 inches in meters

export function snap(v) {
  return Math.round(v / GRID_UNIT) * GRID_UNIT
}

export function snapVec3(v) {
  v.x = snap(v.x)
  v.y = snap(v.y)
  v.z = snap(v.z)
  return v
}

export function metersToFeetInches(m) {
  const totalInches = m / 0.0254
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches % 12)
  return `${feet}'-${inches}"`
}
