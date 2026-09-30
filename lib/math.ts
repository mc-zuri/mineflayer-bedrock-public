export const clamp = function clamp (min: number, x: number, max: number): number {
  return Math.max(min, Math.min(x, max))
}

export const euclideanMod = function euclideanMod (numerator: number, denominator: number): number {
  const result = numerator % denominator
  return result < 0 ? result + denominator : result
}

/**
 * Vanilla PositionMoveRotation.calculateAbsolute (1.21.2+): with the rotate-delta flag the kept
 * velocity turns with the rotation, by (current - new) pitch then yaw, in Notchian degrees
 * (Vec3.xRot then Vec3.yRot).
 */
export const rotateDeltaMovement = function rotateDeltaMovement (vel: { x: number, y: number, z: number }, pitchDiff: number, yawDiff: number): void {
  const pitchRad = pitchDiff * Math.PI / 180
  let cos = Math.cos(pitchRad)
  let sin = Math.sin(pitchRad)
  const y = vel.y * cos + vel.z * sin
  const z = vel.z * cos - vel.y * sin
  vel.y = y
  vel.z = z
  const yawRad = yawDiff * Math.PI / 180
  cos = Math.cos(yawRad)
  sin = Math.sin(yawRad)
  const x = vel.x * cos + vel.z * sin
  vel.z = vel.z * cos - vel.x * sin
  vel.x = x
}
