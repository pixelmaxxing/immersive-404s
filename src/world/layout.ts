import type { V2 } from '../geometry/polygon'

/**
 * THE LOST WORLD — scene layout.
 *
 * You stand on a basalt causeway in a lake of lava. The causeway runs ahead
 * to a landing; from there, floating stepping stones climb toward a colossal
 * island hovering in the smoke. The 404 stands on its front edge, lava pours
 * off its corners into the lake, and its glowing underside hangs overhead.
 *
 * Everything with a place in the world is declared here so rendering, physics,
 * lava lighting and gameplay all agree. Units are roughly metres; +z points
 * back toward the viewer, the causeway's walking surface is y = 0.
 */

export type V3 = [number, number, number]

/** y of the lava lake surface */
export const LAVA_Y = -0.15

/** The player: eye height above the causeway, looking up at the monument. */
export const VIEWER = {
  position: [0.35, 1.62, 10.5] as V3,
  lookAt: [-0.3, 10.8, -50] as V3,
  /** vertical field of view on a 16:9 screen; widened on narrower screens */
  fov: 48,
}

// ---------------------------------------------------------------- causeway ----

export const CAUSEWAY = {
  seed: 707,
  cell: 1.3,
  gap: 0.07,
  /** centreline from behind the viewer out to the landing */
  line: [
    [0.8, 26],
    [0.3, 13],
    [-0.5, 3],
    [0.25, -8],
    [-0.3, -18],
    [0, -25],
  ] as V2[],
  /** half width: generous under the viewer's feet, narrowing over the lake */
  halfWidth(z: number) {
    const t = Math.min(1, Math.max(0, (4 - z) / 16))
    return 3.7 - 1.0 * t * t * (3 - 2 * t)
  },
  landing: { center: [0, -29.5] as V2, radius: 6.4 },
}

/** Floating stepping stones climbing from the landing to the island's edge. */
export const STAIRS = {
  seed: 909,
  from: [-8.4, 0.55, -32.6] as V3,
  to: [5.2, 10.6, -42.4] as V3,
  steps: 13,
}

// ------------------------------------------------------------------- island ----

export const ISLAND = {
  seed: 1971,
  center: [0, -58] as V2,
  top: 11,
  radiusX: 27.5,
  radiusZ: 14.6,
  cell: 2.0,
  gap: 0.1,
  /** detail scale relative to the original 1-unit basalt cells */
  detail: 2.0,
}

/** Island outline radius in the direction `theta` around its centre. */
export function islandRadius(theta: number): number {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const ellipse = 1 / Math.sqrt((c * c) / (ISLAND.radiusX * ISLAND.radiusX) + (s * s) / (ISLAND.radiusZ * ISLAND.radiusZ))
  const h =
    1 +
    0.055 * Math.cos(2 * theta + 0.7) +
    0.045 * Math.cos(3 * theta + 1.9) +
    0.03 * Math.cos(5 * theta + 0.3) +
    0.018 * Math.cos(7 * theta + 2.2)
  return ellipse * h
}

export interface RiverDef {
  id: string
  /** centreline across the island top, [x, z]; the last point lies beyond the rim */
  points: V2[]
  halfWidth: number
  /** surface speed in world units / second */
  speed: number
}

/** Lava wells up behind the monument… */
export const SOURCE_POOL = { center: [0, -65.6] as V2, radius: [6.4, 2.7] as V2 }

/** …and runs around it in two rivers that pour off the island's front corners. */
export const RIVERS: RiverDef[] = [
  {
    id: 'west',
    points: [
      [-3.2, -65.6],
      [-10.5, -66.6],
      [-16.8, -64.2],
      [-20.0, -58.8],
      [-20.9, -53.5],
      [-20.6, -49],
      [-21.4, -45],
      [-22.8, -41],
    ],
    halfWidth: 1.5,
    speed: 0.95,
  },
  {
    id: 'east',
    points: [
      [3.2, -65.6],
      [10.8, -66.8],
      [17.0, -64.5],
      [20.3, -59.0],
      [21.3, -53.8],
      [21.0, -49.3],
      [21.8, -45.2],
      [23.4, -41.2],
    ],
    halfWidth: 1.45,
    speed: 1.05,
  },
]

/** Molten pockets breaking through at the monument's feet. */
export const LAVA_SPOTS = [
  { center: [-5.3, -46.4] as V2, radius: 1.7 },
  { center: [5.4, -46.3] as V2, radius: 1.7 },
  { center: [-16.2, -46.8] as V2, radius: 1.5 },
]

export interface DigitDef {
  char: '4' | '0'
  /** base centre of the digit (bottom middle of the front-to-back slab) */
  position: V3
  /** yaw, pitch (positive leans toward the viewer), roll */
  rotation: V3
  scale: number
  seed: number
}

export const DIGITS: DigitDef[] = [
  { char: '4', position: [-10.4, 11.2, -48.3], rotation: [0.1, 0.03, -0.022], scale: 3.55, seed: 11 },
  { char: '0', position: [0, 11.25, -49.0], rotation: [0.012, 0.035, 0.012], scale: 3.65, seed: 23 },
  { char: '4', position: [10.5, 11.15, -48.2], rotation: [-0.11, 0.028, 0.026], scale: 3.5, seed: 37 },
]
export const DIGIT_HEIGHT = 3.3
export const DIGIT_DEPTH = 1.0

// --------------------------------------------------------------- lava lake ----

/** Molten currents running through the crusted lake, from the falls past the viewer. */
export const LAKE_CURRENTS = [
  {
    points: [
      [-22.4, -43],
      [-18, -34],
      [-12.4, -23],
      [-8.4, -12],
      [-6.9, -1],
      [-7.3, 9],
      [-8.6, 20],
      [-10.4, 34],
    ] as V2[],
    halfWidth: 1.25,
    speed: 0.85,
  },
  {
    points: [
      [23, -43],
      [18, -33],
      [12.6, -22],
      [8.8, -11],
      [7.3, 0],
      [7.6, 10],
      [8.9, 21],
      [10.8, 34],
    ] as V2[],
    halfWidth: 1.15,
    speed: 0.95,
  },
]

export interface FormationDef {
  id: string
  position: V3
  radius: number
  height: number
  seed: number
  ruin?: 'arch' | 'obelisk' | 'pillars'
}

/** Basalt formations rising out of the lake, framing the approach. */
export const FORMATIONS: FormationDef[] = [
  // low outcrops close by
  { id: 'near-left', position: [-19, 0, 5], radius: 2.2, height: 1.5, seed: 501 },
  { id: 'near-right', position: [20, 0, -2], radius: 2.6, height: 1.9, seed: 502 },
  { id: 'mid-left', position: [-15.5, 0, -17], radius: 3.0, height: 1.7, seed: 503, ruin: 'pillars' },
  { id: 'mid-right', position: [14, 0, -21], radius: 2.5, height: 1.3, seed: 504 },
  // taller silhouettes farther out, crowned with ruins
  { id: 'far-left', position: [-33, 0, -36], radius: 5.2, height: 5.0, seed: 505, ruin: 'obelisk' },
  { id: 'far-right', position: [35, 0, -29], radius: 4.6, height: 7.0, seed: 506, ruin: 'pillars' },
  { id: 'back-left', position: [-50, 0, -76], radius: 6.5, height: 11, seed: 507 },
  { id: 'back-right', position: [52, 0, -84], radius: 7.5, height: 14, seed: 508 },
  // stones breaking the crust close to the causeway
  { id: 'rock-1', position: [-5.6, 0, -6.5], radius: 0.95, height: 0.55, seed: 511 },
  { id: 'rock-2', position: [6.3, 0, -12.5], radius: 1.1, height: 0.8, seed: 512 },
  { id: 'rock-3', position: [-8.6, 0, -25], radius: 1.3, height: 1.2, seed: 513 },
  { id: 'rock-4', position: [5.6, 0, 3.8], radius: 0.8, height: 0.45, seed: 514 },
  { id: 'rock-5', position: [-4.9, 0, 6.5], radius: 0.7, height: 0.35, seed: 515 },
]

// ------------------------------------------------------------------ the sky ----

export interface IsletDef {
  id: string
  position: V3
  radius: number
  depth: number
  seed: number
  bob: number
}

/** Smaller floating islands drifting at different depths around the colossus. */
export const ISLETS: IsletDef[] = [
  { id: 'left-near', position: [-34, 9.5, -41], radius: 3.0, depth: 5, seed: 7, bob: 0.2 },
  { id: 'right-near', position: [37, 13, -56], radius: 3.6, depth: 6, seed: 13, bob: 0.18 },
  { id: 'left-far', position: [-44, 17, -92], radius: 5.0, depth: 8, seed: 21, bob: 0.25 },
  { id: 'right-far', position: [50, 23, -108], radius: 6.0, depth: 9, seed: 29, bob: 0.22 },
  { id: 'high', position: [-18, 29, -128], radius: 4.2, depth: 6.5, seed: 31, bob: 0.3 },
]

export interface FragmentDef {
  position: V3
  size: number
  seed: number
}

/** Small detached stones hanging in the air between you and the monument (hover / click). */
export const FRAGMENTS: FragmentDef[] = [
  { position: [3.6, 4.4, 1.0], size: 0.45, seed: 201 },
  { position: [-4.6, 5.6, -4], size: 0.7, seed: 202 },
  { position: [8.2, 5.2, -8], size: 0.85, seed: 203 },
  { position: [-14, 7.6, -10], size: 0.8, seed: 204 },
  { position: [15, 6.8, -14], size: 1.0, seed: 205 },
  { position: [-12.5, 9.2, -17], size: 1.1, seed: 206 },
  { position: [13.8, 8.6, -24], size: 1.3, seed: 207 },
  { position: [-1.6, 21, -30], size: 0.9, seed: 208 },
  { position: [-22, 18, -45], size: 2.0, seed: 209 },
  { position: [24, 21, -52], size: 2.2, seed: 210 },
  { position: [9, 32, -64], size: 1.6, seed: 211 },
  { position: [-12.5, 33.5, -72], size: 1.8, seed: 212 },
]

/** Loose rocks lying on the causeway; knock them into the lava. */
export const LOOSE_ROCKS: FragmentDef[] = [
  { position: [1.25, 0.45, 5.6], size: 0.32, seed: 301 },
  { position: [-1.7, 0.45, 2.4], size: 0.28, seed: 302 },
  { position: [2.3, 0.45, -1.6], size: 0.36, seed: 303 },
  { position: [-1.0, 0.45, -6.2], size: 0.3, seed: 304 },
  { position: [1.6, 0.45, -12.2], size: 0.34, seed: 305 },
  { position: [-2.0, 0.45, -17.5], size: 0.3, seed: 306 },
]
