import { BufferAttribute, BufferGeometry } from 'three'
import {
  centroid,
  chamferPolygon,
  ensureCCW,
  insetPolygon,
  scalePolygon,
  type V2,
} from './polygon'

export type V3 = [number, number, number]

/**
 * Accumulates triangles for stylized stone geometry. Every vertex carries:
 *  - aEdge: 0..1 marks bevel crests (drives edge wear / highlights in the shader)
 *  - aSeed: per-stone random value (albedo variation)
 *  - aHeat: intrinsic heat (glowing cracks independent of nearby lava)
 * Normals are creased: smooth across bevels, crisp between large faces.
 */
export class MeshBuilder {
  readonly pos: number[] = []
  readonly edge: number[] = []
  readonly seed: number[] = []
  readonly heat: number[] = []
  seedValue = 0
  heatValue = 0

  tri(a: V3, b: V3, c: V3, inside: V3, ea = 0, eb = 0, ec = 0) {
    // orient so the face normal points away from `inside`
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const mx = (a[0] + b[0] + c[0]) / 3 - inside[0]
    const my = (a[1] + b[1] + c[1]) / 3 - inside[1]
    const mz = (a[2] + b[2] + c[2]) / 3 - inside[2]
    if (nx * mx + ny * my + nz * mz < 0) {
      this.push(a, ea)
      this.push(c, ec)
      this.push(b, eb)
    } else {
      this.push(a, ea)
      this.push(b, eb)
      this.push(c, ec)
    }
  }

  /** Appends raw triangle soup (e.g. from extrudeBlock). */
  addRaw(pos: Float32Array, edge = 0) {
    for (let i = 0; i < pos.length; i += 3) {
      this.pos.push(pos[i], pos[i + 1], pos[i + 2])
      this.edge.push(edge)
      this.seed.push(this.seedValue)
      this.heat.push(this.heatValue)
    }
  }

  private push(p: V3, e: number) {
    this.pos.push(p[0], p[1], p[2])
    this.edge.push(e)
    this.seed.push(this.seedValue)
    this.heat.push(this.heatValue)
  }

  get vertexCount() {
    return this.pos.length / 3
  }

  build(options: { crease?: number; displace?: (p: V3) => V3 } = {}): BufferGeometry {
    const position = new Float32Array(this.pos)
    if (options.displace) {
      // displacement is a pure function of position, so shared corners stay welded
      for (let i = 0; i < position.length; i += 3) {
        const d = options.displace([position[i], position[i + 1], position[i + 2]])
        position[i] = d[0]
        position[i + 1] = d[1]
        position[i + 2] = d[2]
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(position, 3))
    geometry.setAttribute('normal', new BufferAttribute(creasedNormals(position, options.crease ?? 0.9), 3))
    geometry.setAttribute('aEdge', new BufferAttribute(new Float32Array(this.edge), 1))
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(this.seed), 1))
    geometry.setAttribute('aHeat', new BufferAttribute(new Float32Array(this.heat), 1))
    geometry.setAttribute('aAO', new BufferAttribute(new Float32Array(this.heat.length).fill(1), 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
}

/**
 * Face-weighted normals (the hard-surface "weighted normals" technique): large
 * faces dominate shared vertices so they stay flat, while thin bevel strips
 * shade smoothly between them. Faces meeting beyond `creaseAngle` stay hard.
 */
export function creasedNormals(position: Float32Array, creaseAngle: number, precision = 1e4): Float32Array {
  const vCount = position.length / 3
  const fCount = vCount / 3
  const faceN = new Float32Array(fCount * 3)
  const cornerW = new Float32Array(vCount)
  for (let f = 0; f < fCount; f++) {
    const i = f * 9
    const ax = position[i], ay = position[i + 1], az = position[i + 2]
    const bx = position[i + 3], by = position[i + 4], bz = position[i + 5]
    const cx = position[i + 6], cy = position[i + 7], cz = position[i + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l
    ny /= l
    nz /= l
    faceN[f * 3] = nx
    faceN[f * 3 + 1] = ny
    faceN[f * 3 + 2] = nz
    // area weighting (twice the triangle area)
    cornerW[f * 3] = cornerW[f * 3 + 1] = cornerW[f * 3 + 2] = l
  }

  const groups = new Map<string, number[]>()
  for (let v = 0; v < vCount; v++) {
    const key = `${Math.round(position[v * 3] * precision)},${Math.round(position[v * 3 + 1] * precision)},${Math.round(position[v * 3 + 2] * precision)}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = []))
    g.push(v)
  }

  const out = new Float32Array(vCount * 3)
  const cosCrease = Math.cos(creaseAngle)
  for (const g of groups.values()) {
    for (const v of g) {
      const f = (v / 3) | 0
      const fx = faceN[f * 3], fy = faceN[f * 3 + 1], fz = faceN[f * 3 + 2]
      let sx = 0, sy = 0, sz = 0
      for (const u of g) {
        const h = (u / 3) | 0
        const hx = faceN[h * 3], hy = faceN[h * 3 + 1], hz = faceN[h * 3 + 2]
        if (fx * hx + fy * hy + fz * hz >= cosCrease) {
          const w = cornerW[u]
          sx += hx * w
          sy += hy * w
          sz += hz * w
        }
      }
      const l = Math.hypot(sx, sy, sz) || 1
      out[v * 3] = sx / l
      out[v * 3 + 1] = sy / l
      out[v * 3 + 2] = sz / l
    }
  }
  return out
}

export interface ColumnSpec {
  /** Footprint on the ground plane as [x, z]. Convex works best. */
  poly: V2[]
  /** y of the top face (at the footprint centroid) */
  top: number
  /** y where the sides end (the bottom bevel or tip starts here) */
  bottom: number
  bevel?: number
  bottomBevel?: number
  /** top plane gradient [dy/dx, dy/dz] */
  tilt?: V2
  bottomTilt?: V2
  /** footprint scale at the bottom */
  taper?: number
  /** horizontal drift of the bottom relative to the top */
  lean?: V2
  /** length of a pointed tip below `bottom`, 0 for a flat beveled base */
  tip?: number
  tipOffset?: V2
  /** corner chamfer for the vertical edges */
  corner?: number
  sideSegments?: number
  edgeTop?: number
  edgeBottom?: number
}

/** Adds a beveled stone prism: rounded top rim, chamfered vertical edges, tapered or pointed base. */
export function addColumn(b: MeshBuilder, spec: ColumnSpec) {
  const bevel = spec.bevel ?? 0.07
  const bb = spec.bottomBevel ?? Math.min(0.06, bevel)
  const tilt = spec.tilt ?? [0, 0]
  const bTilt = spec.bottomTilt ?? [0, 0]
  const taper = spec.taper ?? 1
  const lean = spec.lean ?? [0, 0]
  const tip = spec.tip ?? 0
  const base = roundCorners(ensureCCW(spec.poly), spec.corner ?? bevel * 1.1)
  const c = centroid(base)
  const K = base.length
  const topAt = (x: number, z: number) => spec.top + tilt[0] * (x - c[0]) + tilt[1] * (z - c[1])
  const botAt = (x: number, z: number) => spec.bottom + bTilt[0] * (x - c[0]) + bTilt[1] * (z - c[1])

  type Ring = { pts: V3[]; edge: number }
  const rings: Ring[] = []
  // rounded top rim: quarter circle in three segments
  const bevelAngles = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2]

  for (const th of bevelAngles) {
    const inset = bevel * (1 - Math.sin(th))
    const drop = bevel * (1 - Math.cos(th))
    const poly = inset > 1e-5 ? insetPolygon(base, inset) : base
    const crest = th > 0 && th < Math.PI / 2
    rings.push({
      pts: poly.map(([x, z]) => [x, topAt(x, z) - drop, z] as V3),
      edge: crest ? spec.edgeTop ?? 1 : 0,
    })
  }

  const height = spec.top - bevel - (spec.bottom + bb)
  const segs = spec.sideSegments ?? Math.max(1, Math.round(height / 1.3))
  for (let i = 1; i <= segs; i++) {
    const f = i / segs
    const s = 1 + (taper - 1) * f
    const poly = scalePolygon(base, s, c)
    rings.push({
      pts: poly.map(([x, z], k) => {
        const [bx, bz] = base[k]
        const yt = topAt(bx, bz) - bevel
        const yb = botAt(bx, bz) + bb
        return [x + lean[0] * f, yt + (yb - yt) * f, z + lean[1] * f] as V3
      }),
      edge: 0,
    })
  }

  const bottomPoly = scalePolygon(base, taper, c).map(([x, z]) => [x + lean[0], z + lean[1]] as V2)
  const bc: V2 = [c[0] + lean[0], c[1] + lean[1]]
  // bottom bevel: quarter circle from the side (φ=90°) to the base plane (φ=0)
  for (const phi of [Math.PI / 4, 0]) {
    const inset = bb * (1 - Math.sin(phi))
    const rise = bb * (1 - Math.cos(phi))
    rings.push({
      pts: insetPolygon(bottomPoly, inset).map(([x, z], k) => [x, botAt(base[k][0], base[k][1]) + rise, z] as V3),
      edge: phi > 0 ? spec.edgeBottom ?? 0.4 : 0,
    })
  }

  // side quads
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r]
    const B = rings[r + 1]
    const f = Math.min(1, Math.max(0, (r - 2) / Math.max(1, segs)))
    const yMid = (A.pts[0][1] + B.pts[0][1]) / 2
    const inside: V3 = [c[0] + lean[0] * f, yMid, c[1] + lean[1] * f]
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K
      b.tri(A.pts[k], B.pts[k], B.pts[k1], inside, A.edge, B.edge, B.edge)
      b.tri(A.pts[k], B.pts[k1], A.pts[k1], inside, A.edge, B.edge, A.edge)
    }
  }

  // top cap
  const top0 = rings[0].pts
  const topCenter: V3 = [c[0], topAt(c[0], c[1]), c[1]]
  const topInside: V3 = [c[0], topCenter[1] - 1, c[1]]
  for (let k = 0; k < K; k++) b.tri(topCenter, top0[k], top0[(k + 1) % K], topInside)

  // bottom: pointed tip or flat cap
  const last = rings[rings.length - 1].pts
  const bottomY = botAt(c[0], c[1])
  const apex: V3 = tip > 0
    ? [bc[0] + (spec.tipOffset?.[0] ?? 0), bottomY - tip, bc[1] + (spec.tipOffset?.[1] ?? 0)]
    : [bc[0], bottomY, bc[1]]
  const botInside: V3 = [bc[0], bottomY + Math.max(0.3, bevel * 3), bc[1]]
  for (let k = 0; k < K; k++) b.tri(apex, last[(k + 1) % K], last[k], botInside)
}

/** Replaces each corner with a small two-segment rounded chamfer (3 points). */
export function roundCorners(poly: readonly V2[], size: number): V2[] {
  const cut = chamferPolygon(poly, size)
  const out: V2[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = cut[i * 2]
    const b = cut[i * 2 + 1]
    const v = poly[i]
    // midpoint pulled toward the original corner → a soft round
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    out.push(a, [mx + (v[0] - mx) * 0.42, mz + (v[1] - mz) * 0.42], b)
  }
  return out
}

/** A random convex footprint: `sides` points around an ellipse with jittered radii. */
export function randomFootprint(
  rand: () => number,
  sides: number,
  rx: number,
  rz: number,
  jitter = 0.18,
  rotation = rand() * Math.PI * 2,
): V2[] {
  const pts: V2[] = []
  for (let i = 0; i < sides; i++) {
    const a = rotation + ((i + (rand() - 0.5) * 0.55) / sides) * Math.PI * 2
    const r = 1 - jitter * rand()
    pts.push([Math.cos(a) * rx * r, Math.sin(a) * rz * r])
  }
  return ensureCCW(pts)
}
