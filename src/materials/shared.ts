import { Color, DataTexture, FloatType, RGBAFormat, Vector3, Vector4 } from 'three'

/**
 * Uniforms shared by reference across every stone and lava material. Updating a
 * value here once per frame updates the whole world.
 */
export const MAX_EMITTERS = 18
export const MAX_RIPPLES = 4

/** A flow field as materials see it: a texture over world-space bounds. */
export interface FieldBinding {
  texture: DataTexture
  /** minX, minZ, sizeX, sizeZ */
  bounds: [number, number, number, number]
}

const blankTexture = new DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, RGBAFormat, FloatType)
blankTexture.needsUpdate = true
export const BLANK_FIELD: FieldBinding = { texture: blankTexture, bounds: [-1, -1, 2, 2] }

export const shared = {
  uTime: { value: 0 },
  /** lava light emitters as capsules: A = (start.xyz, radius), B = (end.xyz, intensity) */
  uLavaA: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4(0, 0, 0, 0)) },
  uLavaB: { value: Array.from({ length: MAX_EMITTERS }, () => new Vector4(0, 0, 0, 0)) },
  uLavaColor: { value: new Color('#ff5d1c') },
  /** the lava lake lights everything that faces it */
  uLakeY: { value: -0.15 },
  uLakeColor: { value: new Color('#ff5418') },
  uLakeStrength: { value: 3.0 },
  uHeatColor: { value: new Color('#8a1604') },
  /** lava ripples: (x, z, startTime, strength) */
  uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, -100, 0)) },
  /** local lava agitation driven by interaction: (x, z, radius, amount) */
  uHotSpot: { value: new Vector4(0, 0, 1, 0) },
  uKeyDir: { value: new Vector3(-0.42, 0.66, 0.62).normalize() },
  uKeyColor: { value: new Color('#dfe6f2').multiplyScalar(2.9) },
  uAmbient: { value: new Color('#20242c').multiplyScalar(0.6) },
}

export type SharedUniforms = typeof shared
