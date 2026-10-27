import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Matrix4, Shape, Vector2, Vector3, Euler } from 'three'
import { creasedNormals } from '../../geometry/builder'
import { createNoise3D } from '../../geometry/noise'
import { cleanPolygon, ensureCCW, splitConvex, type V2 } from '../../geometry/polygon'
import { Rng } from '../../geometry/random'
import { DIGIT_DEPTH, DIGIT_HEIGHT } from '../layout'

/**
 * The 404 monument glyphs. Each digit is built like real masonry: a few heavy
 * stone blocks with rounded bevels, slightly misaligned, with molten light
 * leaking through the joints between them.
 */

export interface DigitBlock {
  poly: V2[]
  /** local offset applied when the block is jostled (interaction) */
  center: V3
}
type V3 = [number, number, number]

export interface DigitModel {
  geometry: BufferGeometry
  /** thin emissive plates sitting inside the joints */
  joints: BufferGeometry
  blocks: DigitBlock[]
  /** convex hulls of the blocks for physics */
  hulls: Float32Array[]
  /** points on the front/back faces where debris and embers can break loose */
  surfacePoints: Vector3[]
  width: number
  height: number
}

const H = DIGIT_HEIGHT

function octagon(x0: number, y0: number, x1: number, y1: number, c: number): V2[] {
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ]
}

function rayHit(poly: V2[], c: V2, angle: number): V2 {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den
    const u = ((a[0] - c[0]) * dy - (a[1] - c[1]) * dx) / den
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t)
  }
  return [c[0] + dx * best, c[1] + dy * best]
}

const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)

/** Ring sector between two rays from `c` — a voussoir. */
function voussoir(outer: V2[], inner: V2[], c: V2, a1: number, a2: number): V2[] {
  const span = norm(a2 - a1)
  const within = (p: V2) => {
    const d = norm(Math.atan2(p[1] - c[1], p[0] - c[0]) - a1)
    return d > 1e-4 && d < span - 1e-4
  }
  const sortBy = (pts: V2[], dirSign: number) =>
    pts
      .filter(within)
      .sort((p, q) => dirSign * (norm(Math.atan2(p[1] - c[1], p[0] - c[0]) - a1) - norm(Math.atan2(q[1] - c[1], q[0] - c[0]) - a1)))
  const pts: V2[] = [rayHit(outer, c, a1), ...sortBy(outer, 1), rayHit(outer, c, a2), rayHit(inner, c, a2), ...sortBy(inner, -1), rayHit(inner, c, a1)]
  return cleanPolygon(pts)
}

const ZERO_W = 2.3
const zeroInner = () => octagon(0.72, 0.72, ZERO_W - 0.72, H - 0.72, 0.24)

/** The hole through the 0, in the digit's local space (an arrow can thread it). */
export function zeroHole(): V2[] {
  return zeroInner().map(([x, y]) => [x - ZERO_W / 2, y] as V2)
}

function glyphZero(): { blocks: V2[][]; joints: [V2, V2][] } {
  const W = ZERO_W
  const outer = octagon(0, 0, W, H, 0.66)
  const inner = zeroInner()
  const c: V2 = [W / 2, H / 2]
  const cuts = [6, 52, 128, 174, 212, 258, 296, 336].map((d) => (d * Math.PI) / 180)
  const blocks: V2[][] = []
  const joints: [V2, V2][] = []
  for (let i = 0; i < cuts.length; i++) {
    const a1 = cuts[i]
    const a2 = cuts[(i + 1) % cuts.length]
    blocks.push(ensureCCW(voussoir(outer, inner, c, a1, a2)))
    joints.push([rayHit(inner, c, a1), rayHit(outer, c, a1)])
  }
  return { blocks: blocks.map((b) => b.map(([x, y]) => [x - W / 2, y] as V2)), joints: joints.map(([p, q]) => [[p[0] - W / 2, p[1]], [q[0] - W / 2, q[1]]]) }
}

function glyphFour(): { blocks: V2[][]; joints: [V2, V2][] } {
  const W = 2.45
  const stroke = 0.72
  const sx0 = 1.5 // stem
  const sx1 = sx0 + stroke
  const by0 = 0.74 // crossbar
  const by1 = by0 + stroke
  const split = 2.38 // joint between the two upper stem blocks
  const rect = (x0: number, y0: number, x1: number, y1: number): V2[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  // diagonal stroke: outer edge from the crossbar's left end to the top of the stem
  const ox = sx0
  const oy = H - by1
  const ol = Math.hypot(ox, oy)
  const along: V2 = [ox / ol, oy / ol]
  const inward: V2 = [along[1], -along[0]]
  const p0: V2 = [inward[0] * stroke, by1 + inward[1] * stroke]
  const atY = (y: number): V2 => [p0[0] + (along[0] * (y - p0[1])) / along[1], y]
  const atX = (x: number): V2 => [x, p0[1] + (along[1] * (x - p0[0])) / along[0]]
  const tipX = sx0 - 0.15
  const diag: V2[] = [[0, by1], atY(by1), atX(sx0), [sx0, H - 0.04], [tipX, by1 + (tipX * oy) / ox - 0.03]]
  const mid: V2 = [(atY(by1)[0] / 2 + sx0) / 2, (by1 + (atX(sx0)[1] + H) / 2) / 2]
  const [diagUp, diagLow] = splitConvex(diag, mid, along)
  const blocks: V2[][] = [
    rect(sx0, 0, sx1, by0),
    rect(0, by0, sx0, by1),
    rect(sx0, by0, W, by1),
    rect(sx0, by1, sx1, split),
    [
      [sx0, split],
      [sx1, split],
      [sx1, H - 0.13],
      [sx1 - 0.13, H],
      [sx0, H],
    ],
    ensureCCW(cleanPolygon(diagLow)),
    ensureCCW(cleanPolygon(diagUp)),
  ]
  const joints: [V2, V2][] = [
    [[sx0, by0], [sx0, by1]],
    [[sx0, by0], [sx1, by0]],
    [[sx0, by1], [sx1, by1]],
    [[sx0, split], [sx1, split]],
    [[sx0, atX(sx0)[1]], [sx0, H]],
    [[0, by1], atY(by1)],
    [
      [mid[0] - inward[0] * stroke * 0.5, mid[1] - inward[1] * stroke * 0.5],
      [mid[0] + inward[0] * stroke * 0.5, mid[1] + inward[1] * stroke * 0.5],
    ],
  ]
  return { blocks: blocks.map((b) => b.map(([x, y]) => [x - W / 2, y] as V2)), joints: joints.map(([p, q]) => [[p[0] - W / 2, p[1]], [q[0] - W / 2, q[1]]]) }
}

export function buildDigit(char: '4' | '0', seed: number): DigitModel {
  const rng = new Rng(seed)
  const noise = createNoise3D(seed * 13 + 5)
  const glyph = char === '0' ? glyphZero() : glyphFour()
  const D = DIGIT_DEPTH
  const bevelT = 0.085
  const bevelS = 0.075
  const gap = 0.032

  const parts: { pos: Float32Array; seed: number; block: number }[] = []
  const blocks: DigitBlock[] = []
  const hulls: Float32Array[] = []
  const surfacePoints: Vector3[] = []

  for (const poly of glyph.blocks) {
    const shape = new Shape(poly.map(([x, y]) => new Vector2(x, y)))
    const geo = new ExtrudeGeometry(shape, {
      depth: D - bevelT * 2,
      bevelEnabled: true,
      bevelThickness: bevelT,
      bevelSize: bevelS,
      bevelOffset: -bevelS - gap / 2,
      bevelSegments: 3,
      curveSegments: 1,
      steps: 1,
    })
    geo.translate(0, 0, -(D - bevelT * 2) / 2)
    const flat = geo.index ? geo.toNonIndexed() : geo
    const pos = (flat.getAttribute('position').array as Float32Array).slice()
    geo.dispose()

    // each block sits a little differently: hand-laid, ancient masonry
    let cx = 0
    let cy = 0
    for (const [x, y] of poly) {
      cx += x
      cy += y
    }
    cx /= poly.length
    cy /= poly.length
    const m = new Matrix4()
      .makeTranslation(cx, cy, 0)
      .multiply(
        new Matrix4().makeRotationFromEuler(new Euler(rng.range(-0.025, 0.025), rng.range(-0.03, 0.03), rng.range(-0.018, 0.018))),
      )
      .multiply(new Matrix4().makeTranslation(-cx + rng.range(-0.012, 0.012), -cy + rng.range(-0.01, 0.006), rng.range(-0.05, 0.05)))
    const v = new Vector3()
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m)
      pos[i] = v.x
      pos[i + 1] = v.y
      pos[i + 2] = v.z
    }
    parts.push({ pos, seed: rng.next(), block: blocks.length })
    blocks.push({ poly, center: [cx, cy, 0] })

    const hull: number[] = []
    for (const [x, y] of poly) hull.push(x, y, -D / 2, x, y, D / 2)
    hulls.push(new Float32Array(hull))

    for (let k = 0; k < 5; k++) {
      const a = poly[rng.int(0, poly.length - 1)]
      const t = rng.range(0.2, 0.8)
      surfacePoints.push(new Vector3(cx + (a[0] - cx) * t, cy + (a[1] - cy) * t, (rng.sign() * D) / 2))
    }
  }

  // merge + chisel: low-frequency displacement keeps faces planar-ish but irregular
  const total = parts.reduce((s, p) => s + p.pos.length, 0)
  const position = new Float32Array(total)
  const seedArr = new Float32Array(total / 3)
  const blockArr = new Float32Array(total / 3)
  let off = 0
  for (const p of parts) {
    position.set(p.pos, off)
    seedArr.fill(p.seed, off / 3, (off + p.pos.length) / 3)
    blockArr.fill(p.block, off / 3, (off + p.pos.length) / 3)
    off += p.pos.length
  }
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i]
    const y = position[i + 1]
    const z = position[i + 2]
    const f = 1.1
    position[i] += noise(x * f, y * f, z * f) * 0.022
    position[i + 1] += noise(x * f + 7.1, y * f, z * f) * 0.018
    position[i + 2] += noise(x * f, y * f + 3.7, z * f - 1.3) * 0.03
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(creasedNormals(position, 0.7), 3))
  geometry.setAttribute('aEdge', new BufferAttribute(new Float32Array(position.length / 3), 1))
  geometry.setAttribute('aSeed', new BufferAttribute(seedArr, 1))
  geometry.setAttribute('aBlock', new BufferAttribute(blockArr, 1))
  // a touch of intrinsic heat low on the monument, where the lava licks it
  const heat = new Float32Array(position.length / 3)
  for (let i = 0; i < heat.length; i++) heat[i] = 0.18 * Math.max(0, 1 - position[i * 3 + 1] / 1.4)
  geometry.setAttribute('aHeat', new BufferAttribute(heat, 1))
  // baked contact occlusion where the monument meets the ground
  const ao = new Float32Array(position.length / 3)
  for (let i = 0; i < ao.length; i++) {
    const y = position[i * 3 + 1]
    ao[i] = 0.5 + 0.5 * Math.min(1, Math.max(0, y / 0.75)) ** 0.8
  }
  geometry.setAttribute('aAO', new BufferAttribute(ao, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  // joints: thin glowing plates hidden inside the gaps
  const jp: number[] = []
  const jn: number[] = []
  const jd = D * 0.82
  for (const [p0, q0] of glyph.joints) {
    const dx = q0[0] - p0[0]
    const dy = q0[1] - p0[1]
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    // stop short of the outline so the plates only show inside the joints
    const shrink = Math.min(0.11, l * 0.3)
    const p: V2 = [p0[0] + (dx / l) * shrink, p0[1] + (dy / l) * shrink]
    const q: V2 = [q0[0] - (dx / l) * shrink, q0[1] - (dy / l) * shrink]
    const t = 0.012
    const quad = (sx: number) => {
      const a = [p[0] + nx * t * sx, p[1] + ny * t * sx]
      const b = [q[0] + nx * t * sx, q[1] + ny * t * sx]
      jp.push(a[0], a[1], -jd / 2, b[0], b[1], -jd / 2, b[0], b[1], jd / 2, a[0], a[1], -jd / 2, b[0], b[1], jd / 2, a[0], a[1], jd / 2)
      for (let k = 0; k < 6; k++) jn.push(nx * sx, ny * sx, 0)
    }
    quad(1)
    quad(-1)
  }
  const joints = new BufferGeometry()
  joints.setAttribute('position', new BufferAttribute(new Float32Array(jp), 3))
  joints.setAttribute('normal', new BufferAttribute(new Float32Array(jn), 3))

  const bb = geometry.boundingBox!
  return { geometry, joints, blocks, hulls, surfacePoints, width: bb.max.x - bb.min.x, height: bb.max.y - bb.min.y }
}

/** World-space footprint of a placed digit (for the dais and heat map). */
export function digitFootprint(position: V3, yaw: number, width: number, depth: number, margin = 0.3): V2[] {
  const hw = width / 2 + margin
  const hd = depth / 2 + margin
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return ensureCCW(
    ([
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as V2[]).map(([x, z]) => [position[0] + x * c + z * s, position[2] - x * s + z * c] as V2),
  )
}
