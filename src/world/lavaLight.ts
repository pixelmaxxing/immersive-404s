import { Vector3 } from 'three'
import { shared } from '../materials/shared'

/** Short-lived lava light flashes (impacts, splashes). Two slots, recycled. */
export interface Flash {
  position: Vector3
  start: number
  duration: number
  intensity: number
  radius: number
}

export const flashes: Flash[] = [
  { position: new Vector3(), start: -100, duration: 1, intensity: 0, radius: 1 },
  { position: new Vector3(), start: -100, duration: 1, intensity: 0, radius: 1 },
]
let next = 0

export function flash(position: Vector3, intensity = 2.5, radius = 1.6, duration = 0.9) {
  const f = flashes[next]
  next = (next + 1) % flashes.length
  f.position.copy(position)
  f.start = shared.uTime.value
  f.duration = duration
  f.intensity = intensity
  f.radius = radius
}

/** Starts a ripple on the molten sheet. */
let rippleSlot = 0
export function ripple(x: number, z: number, strength = 1) {
  shared.uRipples.value[rippleSlot].set(x, z, shared.uTime.value, strength)
  rippleSlot = (rippleSlot + 1) % shared.uRipples.value.length
}
