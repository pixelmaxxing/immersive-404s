import { BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute, SphereGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ARROW } from '../../world/archery'

/**
 * Procedural bow and arrow.
 *
 * Bow space: X runs along the limbs, Y is up (the limbs' flat width), +Z
 * points back at the archer and the arrow flies toward -Z. The bow is held
 * flat, like a slingshot, so it never hides what you're aiming at.
 */

/** Sweeps a rounded-rectangle section along a smooth curve; `up` sets which way is "width". */
function sweep(points: Vector3[], width: (s: number) => number, thick: (s: number) => number, up: Vector3, segments = 28, around = 14) {
  const curve = new CatmullRomCurve3(points, false, 'centripetal')
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const N = new Vector3()
  const B = new Vector3()
  const p = new Vector3()
  const T = new Vector3()
  const ring = around + 1
  for (let i = 0; i <= segments; i++) {
    const s = i / segments
    curve.getPointAt(s, p)
    curve.getTangentAt(s, T)
    N.crossVectors(T, up).normalize()
    B.crossVectors(N, T).normalize()
    const w = width(s) / 2
    const h = thick(s) / 2
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      // superellipse: a softly squared section, like a shaped limb
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 0.6)
      const ey = Math.sign(sn) * Math.pow(Math.abs(sn), 0.6)
      pos.push(p.x + B.x * ex * w + N.x * ey * h, p.y + B.y * ex * w + N.y * ey * h, p.z + B.z * ex * w + N.z * ey * h)
      const nx = (Math.sign(c) * Math.pow(Math.abs(c), 1.4)) / w
      const ny = (Math.sign(sn) * Math.pow(Math.abs(sn), 1.4)) / h
      const n = new Vector3().addScaledVector(B, nx).addScaledVector(N, ny).normalize()
      nor.push(n.x, n.y, n.z)
      uv.push(s, j / around)
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * ring + j
      const b = a + ring
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  // end caps
  for (const [i, sgn] of [
    [0, -1],
    [segments, 1],
  ] as const) {
    curve.getPointAt(i / segments, p)
    curve.getTangentAt(i / segments, T)
    const c = pos.length / 3
    pos.push(p.x, p.y, p.z)
    nor.push(T.x * sgn, T.y * sgn, T.z * sgn)
    uv.push(i / segments, 0.5)
    for (let j = 0; j < around; j++) {
      const a = i * ring + j
      if (sgn < 0) idx.push(c, a + 1, a)
      else idx.push(c, a, a + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return orientOutward(g)
}

/** Flips the winding if the first face points into the surface. */
function orientOutward(g: BufferGeometry) {
  const index = g.getIndex()!
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const v = (i: number) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
  const [a, b, c] = [index.getX(0), index.getX(1), index.getX(2)]
  const face = new Vector3().subVectors(v(b), v(a)).cross(new Vector3().subVectors(v(c), v(a)))
  const n = new Vector3(nor.getX(a), nor.getY(a), nor.getZ(a))
  if (face.dot(n) < 0) {
    const arr = index.array
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]
      arr[i + 1] = arr[i + 2]
      arr[i + 2] = t
    }
  }
  return g
}

const LIMB = [
  new Vector3(0.105, 0, 0.0),
  new Vector3(0.2, 0, 0.024),
  new Vector3(0.29, 0, 0.058),
  new Vector3(0.36, 0, 0.08),
  new Vector3(0.402, 0, 0.074),
  new Vector3(0.426, 0, 0.05),
]

export interface BowModel {
  limbs: BufferGeometry
  riser: BufferGeometry
  grip: BufferGeometry
  fittings: BufferGeometry
  tips: BufferGeometry
  /** string anchor points at the limb tips (unflexed) */
  tipLeft: Vector3
  tipRight: Vector3
  /** where the arrow lies across the riser */
  restY: number
}

export function buildBow(): BowModel {
  const width = (s: number) => 0.038 - 0.021 * s
  const thick = (s: number) => 0.017 - 0.009 * s
  const right = sweep(LIMB, width, thick, new Vector3(0, 1, 0))
  const left = sweep(
    LIMB.map((p) => new Vector3(-p.x, p.y, p.z)),
    width,
    thick,
    new Vector3(0, -1, 0),
  )
  const riser = sweep(
    [new Vector3(-0.13, 0, 0.006), new Vector3(-0.07, 0, -0.006), new Vector3(0, 0, -0.013), new Vector3(0.07, 0, -0.006), new Vector3(0.13, 0, 0.006)],
    (s) => 0.05 - 0.012 * Math.sin(s * Math.PI),
    (s) => 0.032 + 0.006 * Math.sin(s * Math.PI),
    new Vector3(0, 1, 0),
    20,
    16,
  )
  const grip = sweep(
    [new Vector3(-0.046, 0, -0.009), new Vector3(0, 0, -0.0145), new Vector3(0.046, 0, -0.009)],
    () => 0.046,
    () => 0.046,
    new Vector3(0, 1, 0),
    10,
    18,
  )
  // limb bolts and the arrow rest, in bronze
  const bolt = (x: number) => new CylinderGeometry(0.011, 0.011, 0.058, 12).translate(x, 0, 0.002)
  const rest = new CylinderGeometry(0.006, 0.008, 0.012, 10).translate(0, 0.027, -0.012)
  const fittings = mergeGeometries([bolt(-0.108), bolt(0.108), rest])!
  const tip = (p: Vector3) => new SphereGeometry(0.0085, 10, 8).translate(p.x, p.y, p.z)
  const last = LIMB[LIMB.length - 1]
  const tipRight = last.clone()
  const tipLeft = new Vector3(-last.x, last.y, last.z)
  return {
    limbs: mergeGeometries([right, left])!,
    riser,
    grip,
    fittings,
    tips: mergeGeometries([tip(tipLeft), tip(tipRight)])!,
    tipLeft,
    tipRight,
    restY: 0.033,
  }
}

// ---------------------------------------------------------------- arrow ----

export interface ArrowModel {
  shaft: BufferGeometry
  nock: BufferGeometry
  head: BufferGeometry
  fletching: BufferGeometry
}

/** The same surface facing both ways (thin vanes, without a double-sided shader). */
function twoFaced(g: BufferGeometry) {
  const back = g.clone()
  const idx = back.getIndex()!.array
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1]
    idx[i + 1] = idx[i + 2]
    idx[i + 2] = t
  }
  const n = back.getAttribute('normal')
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i))
  return mergeGeometries([g, back])!
}

/** An arrow pointing toward -Z with its tip at the origin; the nock is at +length. */
export function buildArrow(): ArrowModel {
  const L = ARROW.length
  // a leaf-shaped broadhead with a diamond section
  const w = 0.017
  const t = 0.005
  const ring = [
    [w, 0, 0.055],
    [0, t, 0.055],
    [-w, 0, 0.055],
    [0, -t, 0.055],
  ]
  const tipP = [0, 0, 0]
  const back = [0, 0, 0.088]
  const tris: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    tris.push(...tipP, ...b, ...a)
    tris.push(...back, ...a, ...b)
  }
  const head = new BufferGeometry()
  head.setAttribute('position', new Float32BufferAttribute(tris, 3))
  head.setAttribute('uv', new Float32BufferAttribute(new Array((tris.length / 3) * 2).fill(0), 2))
  head.computeVertexNormals()

  const shaft = new CylinderGeometry(0.0046, 0.0046, L - 0.075, 7, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.075 + (L - 0.075) / 2)
  const nock = new CylinderGeometry(0.0062, 0.0055, 0.022, 8).rotateX(Math.PI / 2).translate(0, 0, L - 0.004)

  // three swept vanes
  const vanes: BufferGeometry[] = []
  const z0 = L - 0.14
  const z1 = L - 0.02
  const steps = 8
  for (let k = 0; k < 3; k++) {
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= steps; i++) {
      const f = i / steps
      const z = z0 + (z1 - z0) * f
      const h = 0.005 + 0.019 * Math.sqrt(f) * (1 - 0.25 * f * f)
      pos.push(0.0045, 0, z, h, 0, z + 0.012 * f)
      if (i < steps) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    vanes.push(twoFaced(g).rotateZ((k / 3) * Math.PI * 2 + Math.PI / 2))
  }
  return { shaft, nock, head, fletching: mergeGeometries(vanes)! }
}
