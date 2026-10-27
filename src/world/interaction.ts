import { Ray, Vector3 } from 'three'

/**
 * Mutable, frame-shared interaction state (no React re-renders).
 * Scene systems write into it; shaders and particles read from it.
 */
export const pointer = {
  /** the pointer ray in world space, refreshed every frame */
  ray: new Ray(new Vector3(), new Vector3(0, 0, -1)),
  /** pointer projected onto a plane through the monument, facing the camera */
  world: new Vector3(0, 1.5, 0),
  /** 0..1, how close the pointer is to any digit */
  monumentProximity: 0,
  /** has the user moved the pointer at all yet */
  active: false,
}

export const cameraShake = { amount: 0 }

export function shake(amount: number) {
  cameraShake.amount = Math.min(0.18, cameraShake.amount + amount)
}
