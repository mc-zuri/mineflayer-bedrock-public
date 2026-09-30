import { Vec3 } from 'vec3'
import * as math from './math.ts'
import type { Vec3Like } from './types/protocol.ts'

const euclideanMod = math.euclideanMod
const PI = Math.PI
const PI_2 = Math.PI * 2
const TO_RAD = PI / 180
const TO_DEG = 1 / TO_RAD
const FROM_NOTCH_BYTE = 360 / 256
// From minecraft.wiki: Velocity is believed to be in units of 1/8000 of a block per server tick (50ms)
const FROM_NOTCH_VEL = 1 / 8000

export const toNotchianYaw = (yaw: number): number => toDegrees(PI - yaw)
export const toNotchianPitch = (pitch: number): number => toDegrees(-pitch)
export const fromNotchianYawByte = (yaw: number): number => fromNotchianYaw(yaw * FROM_NOTCH_BYTE)
export const fromNotchianPitchByte = (pitch: number): number => fromNotchianPitch(pitch * FROM_NOTCH_BYTE)

function toRadians (degrees: number): number {
  return TO_RAD * degrees
}

function toDegrees (radians: number): number {
  return TO_DEG * radians
}

function fromNotchianYaw (yaw: number): number {
  return euclideanMod(PI - toRadians(yaw), PI_2)
}

function fromNotchianPitch (pitch: number): number {
  return euclideanMod(toRadians(-pitch) + PI, PI_2) - PI
}

function fromNotchVelocity (vel: Vec3Like): Vec3 {
  return new Vec3(vel.x * FROM_NOTCH_VEL, vel.y * FROM_NOTCH_VEL, vel.z * FROM_NOTCH_VEL)
}

export { toRadians, toDegrees, fromNotchianYaw, fromNotchianPitch, fromNotchVelocity }
