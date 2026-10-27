import { BufferGeometry, Mesh, Raycaster, Sphere, Vector3, type Intersection } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { shared } from '../materials/shared'
import { DIGIT_DEPTH, DIGITS, LAVA_Y, VIEWER } from './layout'
import { getWorld } from './world'

/**
 * Archery: ballistics, the shared bow / game state and exact hit testing.
 *
 * Arrows are tested against the very meshes you see (BVH-accelerated
 * raycasts along each flight segment), so the reticle's predicted impact and
 * the real one are the same point.
 */

// every raycast in the app (pointer events included) gets a BVH once its geometry has one
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
Mesh.prototype.raycast = acceleratedRaycast

export const GRAVITY = 9.8
export const ARROW = {
  /** world length of an arrow */
  length: 0.62,
  minSpeed: 20,
  maxSpeed: 86,
  /** draws weaker than this don't loose an arrow */
  minDraw: 0.14,
}
export const arrowSpeed = (draw: number) => ARROW.minSpeed + (ARROW.maxSpeed - ARROW.minSpeed) * Math.pow(draw, 0.85)

/** Position on the flight path after `t` seconds. */
export function ballistic(p0: Vector3, v0: Vector3, t: number, out: Vector3) {
  out.copy(p0).addScaledVector(v0, t)
  out.y -= 0.5 * GRAVITY * t * t
  return out
}

// ------------------------------------------------------------- aiming ----

const UP = new Vector3(0, 1, 0)
const BASE_DIR = new Vector3(...VIEWER.lookAt).sub(new Vector3(...VIEWER.position)).normalize()
const _right = new Vector3()

/** The viewer's base direction turned by yaw (about up) then pitch (about the right axis). */
export function lookDirection(yaw: number, pitch: number, out: Vector3) {
  out.copy(BASE_DIR).applyAxisAngle(UP, yaw)
  _right.crossVectors(out, UP).normalize()
  return out.applyAxisAngle(_right, pitch)
}

/** Mutable bow state shared by the input, the camera and the monument. */
export const bow = {
  /** the string is held */
  aiming: false,
  /** 0..1 how far the string is drawn */
  draw: 0,
  /** aim, as offsets from the viewer's base direction (radians) */
  yaw: 0,
  pitch: 0,
  /** the camera's own look offsets this frame, before it leans into the shot */
  camYaw: 0,
  camPitch: 0,
  /** digit the drawn arrow would strike, or -1 */
  lock: -1,
}

/** The game: one good shot at the 404 and you're going home. */
export const game = {
  won: false,
  /** when, in world time (slows down with it) and in real time (performance.now, ms) */
  wonAt: 0,
  wonAtReal: 0,
  digit: -1,
  point: new Vector3(),
  normal: new Vector3(),
}

export function winGame(digit: number, point: Vector3, normal: Vector3) {
  if (game.won) return false
  game.won = true
  game.wonAt = shared.uTime.value
  game.wonAtReal = performance.now()
  game.digit = digit
  game.point.copy(point)
  game.normal.copy(normal)
  return true
}

/** Hands a drawn arrow to the flight system (set by <Arrows />). */
export const launcher: { fire: ((tip: Vector3, velocity: Vector3, draw: number) => void) | null } = { fire: null }

// --------------------------------------------------------- hit testing ----

export type ArrowSurface = 'monument' | 'stone' | 'prop' | 'lava'

export interface Hittable {
  mesh: Mesh
  surface: Exclude<ArrowSurface, 'lava'>
  /** meshes that move get their bounds refreshed every frame */
  moving?: boolean
  /** which digit / fragment / rock */
  index?: number
  /** counts as a hit, but arrows fly straight on through (the hole of the 0) */
  passThrough?: boolean
  onHit?: (hit: ArrowHit, velocity: Vector3) => void
}

export interface ArrowHit {
  point: Vector3
  normal: Vector3
  /** along the tested segment */
  distance: number
  surface: ArrowSurface
  target: Hittable | null
  /** triangle of the target's geometry that was struck */
  faceIndex?: number
}

const entries = new Map<Hittable, Sphere>()
const pendingTrees: BufferGeometry[] = []
let treeTimer = 0

function ensureTree(g: BufferGeometry) {
  if (!g.boundsTree) g.computeBoundsTree()
}

/** Builds the BVHs one by one in idle time (with a deadline, so a busy page still gets them before the first shot). */
function buildTreesWhenIdle() {
  if (treeTimer || !pendingTrees.length) return
  const next = () => {
    treeTimer = 0
    const g = pendingTrees.shift()
    if (g) ensureTree(g)
    buildTreesWhenIdle()
  }
  treeTimer = window.requestIdleCallback ? window.requestIdleCallback(next, { timeout: 1500 }) : window.setTimeout(next, 60)
}

/** Makes a mesh something arrows can strike. Returns the unregister function. */
export function registerHittable(h: Hittable) {
  const g = h.mesh.geometry
  if (!g.boundingSphere) g.computeBoundingSphere()
  entries.set(h, new Sphere(new Vector3(), -1))
  if (!g.boundsTree && !pendingTrees.includes(g)) pendingTrees.push(g)
  buildTreesWhenIdle()
  return () => void entries.delete(h)
}

let refreshedFrame = -1
/** Updates world bounds of moving targets; cheap, call freely once per frame. */
export function refreshHittables(frame: number) {
  if (frame === refreshedFrame) return
  refreshedFrame = frame
  for (const [h, s] of entries) {
    if (!h.moving && s.radius >= 0) continue
    if (s.radius < 0) h.mesh.updateWorldMatrix(true, false)
    s.copy(h.mesh.geometry.boundingSphere!).applyMatrix4(h.mesh.matrixWorld)
  }
}

const raycaster = new Raycaster()
raycaster.firstHitOnly = true
const found: Intersection[] = []
const _dir = new Vector3()
const _to = new Vector3()

function segmentNearSphere(a: Vector3, dir: Vector3, len: number, s: Sphere) {
  if (s.radius < 0) return false
  _to.subVectors(s.center, a)
  const t = Math.min(len, Math.max(0, _to.dot(dir)))
  return _to.addScaledVector(dir, -t).lengthSq() <= s.radius * s.radius
}

/** First thing a straight segment from a to b runs into: a registered mesh or the lava. */
export function sweep(a: Vector3, b: Vector3): ArrowHit | null {
  _dir.subVectors(b, a)
  const len = _dir.length()
  if (len < 1e-6) return null
  _dir.divideScalar(len)
  raycaster.set(a, _dir)
  raycaster.near = 0
  raycaster.far = len

  let best: ArrowHit | null = null
  let bestDist = len
  for (const [h, s] of entries) {
    if (!h.mesh.visible || !segmentNearSphere(a, _dir, len, s)) continue
    ensureTree(h.mesh.geometry)
    found.length = 0
    h.mesh.raycast(raycaster, found)
    const i = found[0]
    if (!i || i.distance >= bestDist) continue
    bestDist = i.distance
    const normal = (i.face?.normal ?? UP).clone().transformDirection(h.mesh.matrixWorld)
    best = { point: i.point.clone(), normal, distance: i.distance, surface: h.surface, target: h, faceIndex: i.faceIndex ?? undefined }
  }

  // molten surfaces are planes: the island's channels and pool, then the lake
  const w = getWorld()
  const lava = (y: number, open: (p: Vector3) => boolean) => {
    if (a.y < y || b.y >= y) return
    const d = ((a.y - y) / (a.y - b.y)) * len
    if (d >= bestDist) return
    const p = a.clone().addScaledVector(_dir, d)
    if (!open(p)) return
    bestDist = d
    best = { point: p, normal: UP.clone(), distance: d, surface: 'lava', target: null }
  }
  const [ix, iz, iw, ih] = w.islandField.bounds
  lava(w.islandLavaY, (p) => p.x > ix && p.x < ix + iw && p.z > iz && p.z < iz + ih && w.islandField.sample(p.x, p.z).molten > 0.55)
  lava(LAVA_Y, () => true)
  return best
}

/** A plane just behind the monument: shots that cross it have missed the 404. */
const BEYOND_Z = Math.min(...DIGITS.map((d) => d.position[2])) - DIGIT_DEPTH * 3

export interface Prediction {
  hit: ArrowHit | null
  /** where the path ends: the impact, where it passed the monument, or its last sampled point */
  point: Vector3
  /** the arrow flew on past the monument without striking anything first */
  passed: boolean
  /** flight time to that point */
  time: number
}

const _prev = new Vector3()
const _cur = new Vector3()

/** Traces the flight of an arrow loosed from `tip` with `velocity`. */
export function predict(tip: Vector3, velocity: Vector3, out: Prediction, maxTime = 5, step = 1 / 40) {
  _prev.copy(tip)
  out.hit = null
  out.passed = false
  for (let t = step; t <= maxTime + 1e-6; t += step) {
    ballistic(tip, velocity, t, _cur)
    const hit = sweep(_prev, _cur)
    if (hit) {
      out.hit = hit
      out.point.copy(hit.point)
      out.time = t - step + (hit.distance / Math.max(1e-3, _prev.distanceTo(_cur))) * step
      return out
    }
    if (_cur.z < BEYOND_Z && _prev.z >= BEYOND_Z) {
      const f = (_prev.z - BEYOND_Z) / (_prev.z - _cur.z)
      out.passed = true
      out.point.lerpVectors(_prev, _cur, f)
      out.time = t - step + f * step
      return out
    }
    _prev.copy(_cur)
  }
  out.point.copy(_cur)
  out.time = maxTime
  return out
}
