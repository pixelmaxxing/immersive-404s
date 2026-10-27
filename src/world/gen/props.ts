import { BufferGeometry, Euler, Matrix4, Vector3 } from 'three'
import { addColumn, MeshBuilder, randomFootprint } from '../../geometry/builder'
import { extrudeBlock } from '../../geometry/extrude'
import { createNoise3D } from '../../geometry/noise'
import { type V2 } from '../../geometry/polygon'
import { clamp, Rng, smoothstep } from '../../geometry/random'
import type { FormationDef, FragmentDef, IsletDef } from '../layout'
import { generateStoneField, radialRegion, type StoneField } from './stoneField'

const chisel = (seed: number, amp: number, freq = 0.9) => {
  const noise = createNoise3D(seed)
  return ([x, y, z]: [number, number, number]): [number, number, number] => [
    x + noise(x * freq, y * freq, z * freq) * amp,
    y + noise(x * freq + 5.2, y * freq, z * freq) * amp * 0.6,
    z + noise(x * freq, y * freq - 3.1, z * freq + 1.7) * amp,
  ]
}

const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz)).setPosition(x, y, z)

// -------------------------------------------------------------- stairs ----

export interface StairsModel {
  geometry: BufferGeometry
  hulls: Float32Array[]
  /** walkable top centres */
  tops: Vector3[]
}

/**
 * Floating stairs climbing from the landing to the island's edge: flat slab
 * treads, each with a short rough keel of rock beneath. Seen side-on from the
 * causeway they read as a stepped profile rising toward the monument.
 */
export function buildStairs(from: Vector3, to: Vector3, steps: number, seed: number): StairsModel {
  const rng = new Rng(seed)
  const b = new MeshBuilder()
  const hulls: Float32Array[] = []
  const tops: Vector3[] = []
  const run = new Vector3(to.x - from.x, 0, to.z - from.z).normalize()
  // a gentle bow toward the viewer so the flight isn't ruler-straight
  const side = new Vector3(-run.z, 0, run.x)
  const along = Math.atan2(run.z, run.x)
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const bow = Math.sin(t * Math.PI) * 1.1
    const x = from.x + (to.x - from.x) * t + side.x * bow + rng.range(-0.08, 0.08)
    const y = from.y + (to.y - from.y) * t
    const z = from.z + (to.z - from.z) * t + side.z * bow + rng.range(-0.08, 0.08)
    // treads longer along the climb than across, turned to follow it
    const a = rng.range(0.92, 1.02)
    const c = rng.range(1.0, 1.15)
    const yaw = along + rng.range(-0.08, 0.08)
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const turn = (pts: V2[], ox = 0, oz = 0) => pts.map(([px, pz]) => [x + ox + px * cos - pz * sin, z + oz + px * sin + pz * cos] as V2)
    const fp = turn(randomFootprint(() => rng.next(), rng.int(7, 8), a, c, 0.08, rng.range(0, 0.4)))
    const thick = rng.range(0.36, 0.44)
    b.seedValue = rng.next()
    b.heatValue = 0.05
    addColumn(b, {
      poly: fp,
      top: y,
      bottom: y - thick,
      bevel: 0.07,
      bottomBevel: 0.06,
      tilt: [rng.range(-0.02, 0.02), rng.range(-0.02, 0.02)],
      taper: rng.range(0.86, 0.92),
    })
    // a rough keel torn from the bedrock, blunt rather than pointed
    const keel = turn(randomFootprint(() => rng.next(), 6, a * 0.62, c * 0.55, 0.22), rng.range(-0.15, 0.15), rng.range(-0.12, 0.12))
    b.seedValue = rng.next()
    b.heatValue = 0.16
    addColumn(b, {
      poly: keel,
      top: y - thick * 0.6,
      bottom: y - thick - rng.range(0.18, 0.3),
      bevel: 0.05,
      bottomBevel: 0.08,
      taper: rng.range(0.55, 0.68),
      lean: [rng.range(-0.1, 0.1), rng.range(-0.1, 0.1)],
    })
    const h: number[] = []
    for (const [px, pz] of fp) h.push(px, y, pz, px, y - 0.4, pz)
    hulls.push(new Float32Array(h))
    tops.push(new Vector3(x, y, z))
  }
  return { geometry: b.build({ crease: 0.62, displace: chisel(seed, 0.03) }), hulls, tops }
}

// ----------------------------------------------------------- fragments ----

/** A single angular stone chunk centred on the origin (floating fragments, debris, rubble). */
export function buildChunk(size: number, seed: number, heat = 0): BufferGeometry {
  const rng = new Rng(seed)
  const b = new MeshBuilder()
  b.seedValue = rng.next()
  b.heatValue = heat
  const fp = randomFootprint(() => rng.next(), rng.int(5, 7), size, size * rng.range(0.7, 1), 0.22)
  addColumn(b, {
    poly: fp,
    top: size * rng.range(0.35, 0.55),
    bottom: -size * rng.range(0.25, 0.45),
    bevel: size * 0.11,
    bottomBevel: size * 0.08,
    tilt: [rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)],
    bottomTilt: [rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)],
    taper: rng.range(0.55, 0.85),
    tip: rng.chance(0.6) ? size * rng.range(0.3, 0.8) : 0,
    tipOffset: [rng.range(-0.15, 0.15) * size, rng.range(-0.15, 0.15) * size],
  })
  const g = b.build({ crease: 0.62, displace: chisel(seed, size * 0.05, 2.2 / Math.max(size, 0.1)) })
  g.computeBoundingSphere()
  const c = g.boundingSphere!.center
  g.translate(-c.x, -c.y, -c.z)
  g.computeBoundingSphere()
  if (heat > 0) {
    // heat pools in the underside, where molten rock still drips
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const pos = g.getAttribute('position')
    const h = g.getAttribute('aHeat')
    for (let i = 0; i < pos.count; i++) {
      const k = (pos.getY(i) - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y)
      h.setX(i, heat * (1 - k) * (1 - k) * 2.2)
    }
  }
  return g
}

export function buildFragments(defs: FragmentDef[]) {
  return defs.map((d) => buildChunk(d.size, d.seed, 0.12))
}

// --------------------------------------------------------------- ruins ----

function square(cx: number, cz: number, w: number, d = w): V2[] {
  return [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2],
  ]
}

function octagon(cx: number, cz: number, r: number): V2[] {
  const pts: V2[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r])
  }
  return pts
}

function addObelisk(b: MeshBuilder, rng: Rng) {
  let y = 0.02
  let ox = 0
  let oz = 0
  const tiers = [
    { w: 1.15, h: 0.42 },
    { w: 0.74, h: 1.25 },
    { w: 0.66, h: 1.1 },
    { w: 0.6, h: 0.7 },
  ]
  tiers.forEach((t, i) => {
    b.seedValue = rng.next()
    b.heatValue = i === 1 ? 0.22 : 0.05
    const last = i === tiers.length - 1
    addColumn(b, {
      poly: square(ox, oz, t.w),
      top: y + t.h,
      bottom: y + 0.01,
      bevel: 0.05,
      corner: 0.05,
      tilt: last ? [0.55, -0.25] : [rng.range(-0.02, 0.02), rng.range(-0.02, 0.02)],
      taper: 0.97,
      edgeBottom: 0.6,
    })
    y += t.h + 0.025
    ox += rng.range(-0.04, 0.06)
    oz += rng.range(-0.03, 0.03)
  })
}

function addPillars(b: MeshBuilder, rng: Rng) {
  const cols = [
    { x: -0.7, z: -0.2, h: 2.5 },
    { x: 0.5, z: -0.45, h: 1.55 },
    { x: 0.95, z: 0.55, h: 0.75 },
  ]
  for (const c of cols) {
    b.seedValue = rng.next()
    b.heatValue = 0.04
    addColumn(b, {
      poly: octagon(c.x, c.z, 0.32),
      top: c.h,
      bottom: 0.02,
      bevel: 0.04,
      corner: 0.03,
      tilt: [rng.range(-0.45, 0.45), rng.range(-0.4, 0.4)],
      taper: 1.05,
    })
  }
  // a fallen drum lying on its side
  b.seedValue = rng.next()
  b.addRaw(extrudeBlock(octagon(0, 0, 0.3), { depth: 0.9, bevelThickness: 0.04, bevelSize: 0.04 }, placed(-0.1, 0.3, 0.75, 0.08, 1.2, 0)))
}

/** A broken arch: two stacked piers carrying a ring of voussoirs, part of it fallen. */
function addArch(b: MeshBuilder, rng: Rng) {
  const span = 1.05
  const block = 0.62
  const depth = 0.62
  // two piers of three courses each
  const courses = (x: number, n: number) => {
    for (let i = 0; i < n; i++) {
      b.seedValue = rng.next()
      b.heatValue = 0.03
      addColumn(b, {
        poly: square(x + rng.range(-0.03, 0.03), rng.range(-0.03, 0.03), block, depth),
        top: (i + 1) * 0.66,
        bottom: i * 0.66 + 0.02,
        bevel: 0.05,
        corner: 0.05,
        tilt: [rng.range(-0.02, 0.02), rng.range(-0.02, 0.02)],
        taper: 0.98,
      })
    }
  }
  courses(-span - block / 2, 3)
  courses(span + block / 2, 3)

  // voussoirs (in the XY plane, extruded through Z)
  const cy = 3 * 0.66 + 0.02
  const rIn = span
  const rOut = span + block
  // the arch stands whole: a broken one reads as a stray letter beside the 404
  const n = 7
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (i / n) * Math.PI
    const a1 = Math.PI - ((i + 1) / n) * Math.PI
    const poly: V2[] = [
      [Math.cos(a0) * rIn, cy + Math.sin(a0) * rIn],
      [Math.cos(a0) * rOut, cy + Math.sin(a0) * rOut],
      [Math.cos(a1) * rOut, cy + Math.sin(a1) * rOut],
      [Math.cos(a1) * rIn, cy + Math.sin(a1) * rIn],
    ]
    b.seedValue = rng.next()
    b.heatValue = i === 3 ? 0.25 : 0.04
    b.addRaw(extrudeBlock(ensureCcw(poly), { depth, bevelThickness: 0.05, bevelSize: 0.045, gap: 0.03 }, placed(0, rng.range(-0.02, 0.0), 0, 0, 0, rng.range(-0.015, 0.015))))
  }
  // a block fallen from somewhere higher lies at its foot
  b.seedValue = rng.next()
  b.addRaw(
    extrudeBlock(
      [
        [-0.32, 0],
        [0.32, 0],
        [0.24, 0.5],
        [-0.24, 0.5],
      ],
      { depth, bevelThickness: 0.05, bevelSize: 0.045 },
      placed(1.75, 0.28, 0.85, 1.35, 0.6, 0.2),
    ),
  )
}

function ensureCcw(poly: V2[]): V2[] {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a < 0 ? [...poly].reverse() : poly
}

// -------------------------------------------------------------- islets ----

export interface IsletModel {
  field: StoneField
}

/** A small floating island: a stalactite mound of basalt columns, hot underneath. */
export function buildIslet(def: IsletDef): IsletModel {
  const rng = new Rng(def.seed)
  const a1 = rng.range(0, Math.PI * 2)
  const a2 = rng.range(0, Math.PI * 2)
  const R = def.radius
  const detail = clamp(R / 2.6, 0.7, 2)
  const field = generateStoneField({
    seed: def.seed * 31 + 1,
    ...radialRegion([0, 0], (th) => R * (1 + 0.13 * Math.cos(2 * th + a1) + 0.08 * Math.cos(3 * th + a2))),
    cell: clamp(R * 0.36, 0.62, 2),
    gap: 0.05 * detail,
    detail,
    depth: (rho, r) => (0.6 + (def.depth / detail) * Math.pow(Math.max(0, 1 - rho), 1.2) + r.gauss() * 0.2) * detail,
    rimVariation: 1.1,
    outcrops: R > 2 ? 2 : 0,
    hotUnderside: true,
  })
  return { field }
}

// ---------------------------------------------------------- formations ----

export interface FormationModel {
  field: StoneField
  ruin: BufferGeometry | null
  /** walkable top of the formation (where its ruin stands) */
  summit: Vector3
}

/**
 * Basalt formations rising out of the lava lake: stepped mounds of columns,
 * tallest at the heart, their feet sunk into the molten crust.
 */
export function buildFormation(def: FormationDef): FormationModel {
  const rng = new Rng(def.seed)
  const noise = createNoise3D(def.seed + 17)
  const [px, , pz] = def.position
  const R = def.radius
  const a1 = rng.range(0, Math.PI * 2)
  const a2 = rng.range(0, Math.PI * 2)
  const detail = clamp(R / 2.4, 0.45, 2.2)
  const region = radialRegion([px, pz], (th) => R * (1 + 0.16 * Math.cos(2 * th + a1) + 0.1 * Math.cos(3 * th + a2)))
  const heightAt = (x: number, z: number) => {
    const rho = region.rho(x, z)
    const n = noise(x * 0.45 / detail, 2.1, z * 0.45 / detail)
    return def.height * Math.pow(Math.max(0, 1 - Math.pow(rho, 1.5)), 0.65) * (0.72 + 0.4 * (0.5 + 0.5 * n)) + 0.12 * detail
  }
  const field = generateStoneField({
    seed: def.seed * 13 + 5,
    ...region,
    cell: clamp(R * 0.42, 0.55, 2.2),
    gap: 0.05 * detail,
    detail,
    tips: false,
    baseTop: heightAt,
    depth: () => 0,
    floor: -2.6,
    rimVariation: 0.8,
    topTilt: 0.16,
  })
  // the ruin stands on the highest stone
  let summit = new Vector3(px, def.height, pz)
  let best = -Infinity
  for (const c of field.cells) {
    if (c.top > best && region.rho(c.center[0], c.center[1]) < 0.55) {
      best = c.top
      summit = new Vector3(c.center[0], c.top, c.center[1])
    }
  }
  let ruin: BufferGeometry | null = null
  if (def.ruin) {
    const rb = new MeshBuilder()
    if (def.ruin === 'obelisk') addObelisk(rb, rng)
    if (def.ruin === 'arch') addArch(rb, rng)
    if (def.ruin === 'pillars') addPillars(rb, rng)
    ruin = rb.build({ crease: 0.62, displace: chisel(def.seed + 3, 0.025, 1.3) })
    const sc = clamp(def.radius / 2.8, 0.7, 1.7)
    ruin.applyMatrix4(new Matrix4().makeRotationY(rng.range(-0.6, 0.6)).premultiply(new Matrix4().makeScale(sc, sc, sc)))
    ruin.translate(summit.x, summit.y - 0.04, summit.z)
  }
  return { field, ruin, summit }
}

// ------------------------------------------------------------ far lands ----

export interface FarLandsModel {
  geometry: BufferGeometry
  /** smouldering craters (for glows and smoke) */
  craters: Vector3[]
}

/**
 * The edge of the world: dark basalt mesas on the horizon and a distant
 * volcano. The haze turns them into layered silhouettes against the glow.
 */
export function buildFarLands(seed: number): FarLandsModel {
  const rng = new Rng(seed)
  const b = new MeshBuilder()
  const mesas: [number, number, number, number][] = [
    // x, z, radius, height
    [-150, -215, 34, 22],
    [-128, -262, 26, 34],
    [-210, -170, 30, 14],
    [-260, -290, 50, 20],
    [118, -250, 30, 24],
    [135, -205, 38, 16],
    [205, -175, 26, 30],
    // the horizon right behind the island stays open: its glow is what makes it float
  ]
  for (const [mx, mz, r, h] of mesas) {
    const cols = rng.int(9, 16)
    for (let c = 0; c < cols; c++) {
      const a = rng.range(0, Math.PI * 2)
      const d = Math.sqrt(rng.next()) * r * 0.75
      const cx = mx + Math.cos(a) * d
      const cz = mz + Math.sin(a) * d * 0.6
      const w = rng.range(0.22, 0.4) * r
      const top = h * (1 - (d / r) * 0.55) * rng.range(0.75, 1.05)
      b.seedValue = rng.next()
      addColumn(b, {
        poly: randomFootprint(() => rng.next(), rng.int(5, 7), w, w * rng.range(0.7, 1), 0.15).map(([x, z]) => [x + cx, z + cz] as V2),
        top,
        bottom: -8,
        bevel: 0.8,
        tilt: [rng.range(-0.08, 0.08), rng.range(-0.08, 0.08)],
        taper: rng.range(1.05, 1.25),
        sideSegments: 2,
      })
    }
  }
  // a distant volcano, smouldering
  const vx = 170
  const vz = -330
  const vr = 70
  // the footprint is the crater rim; taper widens it into the cone's base
  const crater = vr / 6.2
  const cone: V2[] = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2
    const rr = crater * rng.range(0.9, 1.05)
    return [vx + Math.cos(a) * rr, vz + Math.sin(a) * rr * 0.8] as V2
  })
  b.seedValue = 0.3
  addColumn(b, { poly: cone, top: 74, bottom: -8, bevel: 1.5, taper: 6.2, tilt: [0, 0], sideSegments: 4 })
  const geometry = b.build({
    crease: 0.62,
    displace: (() => {
      const n = createNoise3D(seed + 9)
      return ([x, y, z]: [number, number, number]): [number, number, number] => [
        x + n(x * 0.02, y * 0.02, z * 0.02) * 6,
        y + n(x * 0.03 + 4, y * 0.02, z * 0.03) * 2 * smoothstep(0, 30, y),
        z + n(x * 0.02, y * 0.02 + 7, z * 0.02) * 6,
      ]
    })(),
  })
  return { geometry, craters: [new Vector3(vx, 74, vz)] }
}
