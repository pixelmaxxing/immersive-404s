import { ShapeUtils, Vector2, Vector3 } from 'three'

/**
 * Voronoi fracture for closed triangle meshes.
 *
 * Each piece is the source solid cut down by the planes bisecting its seed
 * and every other seed. Every cut is capped, so pieces are closed solids too
 * (they can break again): their outer skin keeps the source's normals and
 * attributes, while freshly broken faces get flat normals and the scalar
 * values given for the interior (hot, unweathered stone).
 */

/** A closed triangle soup and its per-vertex attributes. */
export interface Solid {
  position: Float32Array
  normal: Float32Array
  /** per-vertex scalar attributes, carried across cuts */
  scalars: Record<string, Float32Array>
}

export interface Piece extends Solid {
  /** centre of mass (uniform density) */
  center: Vector3
  volume: number
  /** the seed the piece grew around */
  seed: Vector3
}

/** Topology welded by position; attributes live on triangle corners (hard edges stay hard). */
interface Work {
  x: number[]
  y: number[]
  z: number[]
  /** three vertex ids per triangle */
  tv: number[]
  /** three corner ids per triangle */
  tc: number[]
  /** corner attributes: normal (3) then scalars, `stride` per corner */
  ca: number[]
}

const KEY = 4194304 // 2^22: edge keys stay exact in a double

function weld(s: Solid, names: string[]): Work {
  const w: Work = { x: [], y: [], z: [], tv: [], tc: [], ca: [] }
  const ids = new Map<string, number>()
  const p = s.position
  for (let i = 0, n = p.length / 3; i < n; i++) {
    const key = `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = w.x.length
      ids.set(key, id)
      w.x.push(p[i * 3])
      w.y.push(p[i * 3 + 1])
      w.z.push(p[i * 3 + 2])
    }
    w.tv.push(id)
    w.tc.push(i)
    w.ca.push(s.normal[i * 3], s.normal[i * 3 + 1], s.normal[i * 3 + 2])
    for (const name of names) w.ca.push(s.scalars[name][i])
  }
  return w
}

const copyWork = (w: Work): Work => ({ x: w.x.slice(), y: w.y.slice(), z: w.z.slice(), tv: w.tv.slice(), tc: w.tc.slice(), ca: w.ca.slice() })

/** 2D convex hull (monotone chain), counter-clockwise. */
function hull2(pts: { u: number; v: number; id: number }[]) {
  const s = [...pts].sort((a, b) => a.u - b.u || a.v - b.v)
  const cross = (o: (typeof s)[0], a: (typeof s)[0], b: (typeof s)[0]) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u)
  const lower: typeof s = []
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: typeof s = []
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Keeps the part of `w` on the negative side of the plane n·p = d and caps
 * the cut. Returns `w` itself if the plane misses, null if nothing is left.
 */
function cut(w: Work, nx: number, ny: number, nz: number, d: number, stride: number, capCorner: number[]): Work | null {
  const nv = w.x.length
  const s = new Float64Array(nv)
  for (let i = 0; i < nv; i++) s[i] = w.x[i] * nx + w.y[i] * ny + w.z[i] * nz - d
  let inside = false
  let outside = false
  for (const v of w.tv) {
    if (s[v] > 0) outside = true
    else inside = true
  }
  if (!outside) return w
  if (!inside) return null

  const out: Work = { x: w.x, y: w.y, z: w.z, tv: [], tc: [], ca: w.ca }
  const edges = new Map<number, number>()
  const vertexOn = (a: number, b: number) => {
    const key = a < b ? a * KEY + b : b * KEY + a
    let v = edges.get(key)
    if (v === undefined) {
      const t = s[a] / (s[a] - s[b])
      v = out.x.length
      out.x.push(w.x[a] + (w.x[b] - w.x[a]) * t)
      out.y.push(w.y[a] + (w.y[b] - w.y[a]) * t)
      out.z.push(w.z[a] + (w.z[b] - w.z[a]) * t)
      edges.set(key, v)
    }
    return v
  }
  const cornerOn = (ca: number, cb: number, t: number) => {
    const id = out.ca.length / stride
    for (let k = 0; k < stride; k++) out.ca.push(w.ca[ca * stride + k] + (w.ca[cb * stride + k] - w.ca[ca * stride + k]) * t)
    return id
  }
  const tri = (a: number, b: number, c: number, ka: number, kb: number, kc: number) => {
    out.tv.push(a, b, c)
    out.tc.push(ka, kb, kc)
  }

  // boundary of the cap: each split triangle contributes the segment it left open, oriented so the
  // cap faces +n (out of the kept solid). Segments are chained by position, not id: an earlier cap
  // can leave a T-junction on an edge, and the plane then crosses both sides of it at one point.
  const next = new Map<string, string>()
  const rep = new Map<string, number>()
  const keyOf = (id: number) => `${Math.round(out.x[id] * 1e7)},${Math.round(out.y[id] * 1e7)},${Math.round(out.z[id] * 1e7)}`
  const segment = (a: number, b: number) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka === kb) return
    next.set(ka, kb)
    if (!rep.has(ka)) rep.set(ka, a)
    if (!rep.has(kb)) rep.set(kb, b)
  }
  const tv = w.tv
  const tc = w.tc
  for (let t = 0; t < tv.length; t += 3) {
    const v = [tv[t], tv[t + 1], tv[t + 2]]
    const k = [tc[t], tc[t + 1], tc[t + 2]]
    const inn = v.map((i) => s[i] <= 0)
    const count = (inn[0] ? 1 : 0) + (inn[1] ? 1 : 0) + (inn[2] ? 1 : 0)
    if (count === 3) {
      tri(v[0], v[1], v[2], k[0], k[1], k[2])
      continue
    }
    if (count === 0) continue
    // rotate (keeping the winding) so the odd one out comes first
    const lone = count === 1 ? inn.indexOf(true) : inn.indexOf(false)
    const v0 = v[lone]
    const v1 = v[(lone + 1) % 3]
    const v2 = v[(lone + 2) % 3]
    const c0 = k[lone]
    const c1 = k[(lone + 1) % 3]
    const c2 = k[(lone + 2) % 3]
    const p01 = vertexOn(v0, v1)
    const k01 = cornerOn(c0, c1, s[v0] / (s[v0] - s[v1]))
    const p20 = vertexOn(v2, v0)
    const k20 = cornerOn(c2, c0, s[v2] / (s[v2] - s[v0]))
    if (count === 1) {
      tri(v0, p01, p20, c0, k01, k20)
      segment(p20, p01)
    } else {
      tri(p01, v1, v2, k01, c1, c2)
      tri(p01, v2, p20, k01, c2, k20)
      segment(p01, p20)
    }
  }

  // --- cap: chain the segments into loops, triangulate them in the plane ---
  const helper = Math.abs(nx) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  const n = new Vector3(nx, ny, nz)
  const u = new Vector3().crossVectors(n, helper).normalize()
  const wv = new Vector3().crossVectors(n, u)
  const to2 = (id: number) => new Vector2(out.x[id] * u.x + out.y[id] * u.y + out.z[id] * u.z, out.x[id] * wv.x + out.y[id] * wv.y + out.z[id] * wv.z)

  const loops: number[][] = []
  const seen = new Set<string>()
  let open = false
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let cur: string | undefined = start
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur)
      loop.push(rep.get(cur)!)
      cur = next.get(cur)
    }
    if (cur !== start) open = true
    if (loop.length >= 3) loops.push(loop)
  }

  const cap = out.ca.length / stride
  out.ca.push(nx, ny, nz, ...capCorner)
  const emit = (ids: number[], pts: Vector2[], faces: number[][]) => {
    for (const [a, b, c] of faces) {
      const area = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x)
      if (area >= 0) tri(ids[a], ids[b], ids[c], cap, cap, cap)
      else tri(ids[a], ids[c], ids[b], cap, cap, cap)
    }
  }

  if (open) {
    // not a clean manifold: cap with the hull of everything the plane touched
    const pts = [...rep.values()].map((id) => {
      const p = to2(id)
      return { u: p.x, v: p.y, id }
    })
    const h = hull2(pts)
    if (h.length >= 3) {
      const ids = h.map((p) => p.id)
      const p2 = h.map((p) => new Vector2(p.u, p.v))
      emit(ids, p2, ids.slice(2).map((_, i) => [0, i + 1, i + 2]))
    }
    return out
  }

  // outer boundaries run counter-clockwise seen from +n, holes clockwise
  const shapes = loops
    .map((loop) => {
      // drop repeated points: the triangulator would quietly renumber around them
      const ids: number[] = []
      const pts: Vector2[] = []
      for (const id of loop) {
        const p = to2(id)
        if (pts.length && pts[pts.length - 1].distanceToSquared(p) < 1e-18) continue
        ids.push(id)
        pts.push(p)
      }
      while (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-18) {
        ids.pop()
        pts.pop()
      }
      return { ids, pts, area: ShapeUtils.area(pts) }
    })
    .filter((l) => l.pts.length >= 3)
  const outers = shapes.filter((l) => l.area > 0).sort((a, b) => a.area - b.area)
  const holes = shapes.filter((l) => l.area < 0)
  const inside2 = (p: Vector2, poly: Vector2[]) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
    }
    return c
  }
  const holesOf = new Map<(typeof outers)[0], typeof holes>()
  for (const h of holes) {
    const host = outers.find((o) => inside2(h.pts[0], o.pts))
    if (host) holesOf.set(host, [...(holesOf.get(host) ?? []), h])
  }
  for (const o of outers) {
    const hs = holesOf.get(o) ?? []
    const faces = ShapeUtils.triangulateShape(
      o.pts.map((p) => p.clone()),
      hs.map((h) => h.pts.map((p) => p.clone())),
    )
    emit([...o.ids, ...hs.flatMap((h) => h.ids)], [...o.pts, ...hs.flatMap((h) => h.pts)], faces)
  }
  return out
}

/** Volume and centre of mass of a closed triangle soup (or of welded work). */
function massOf(tri: (t: number, out: number[]) => void, count: number) {
  const c = new Vector3()
  let vol = 0
  const p: number[] = new Array(9)
  for (let t = 0; t < count; t++) {
    tri(t, p)
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p
    const v = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    vol += v
    c.x += (ax + bx + cx) * v
    c.y += (ay + by + cy) * v
    c.z += (az + bz + cz) * v
  }
  return { volume: vol / 6, center: Math.abs(vol) > 1e-12 ? c.divideScalar(vol * 4) : c }
}

export function solidMass(s: Solid) {
  const p = s.position
  return massOf((t, out) => {
    for (let k = 0; k < 9; k++) out[k] = p[t * 9 + k]
  }, p.length / 9)
}

/** Is `p` inside the closed solid (ray parity)? */
export function solidContains(s: Solid, p: Vector3) {
  // an odd direction, so the ray never runs along an edge
  const dx = 0.5773
  const dy = 0.5816
  const dz = 0.5731
  const a = s.position
  let hits = 0
  for (let i = 0; i < a.length; i += 9) {
    const e1x = a[i + 3] - a[i]
    const e1y = a[i + 4] - a[i + 1]
    const e1z = a[i + 5] - a[i + 2]
    const e2x = a[i + 6] - a[i]
    const e2y = a[i + 7] - a[i + 1]
    const e2z = a[i + 8] - a[i + 2]
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-12) continue
    const inv = 1 / det
    const tx = p.x - a[i]
    const ty = p.y - a[i + 1]
    const tz = p.z - a[i + 2]
    const uu = (tx * px + ty * py + tz * pz) * inv
    if (uu < 0 || uu > 1) continue
    const qx = ty * e1z - tz * e1y
    const qy = tz * e1x - tx * e1z
    const qz = tx * e1y - ty * e1x
    const vv = (dx * qx + dy * qy + dz * qz) * inv
    if (vv < 0 || uu + vv > 1) continue
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) hits++
  }
  return hits % 2 === 1
}

export interface FractureOptions {
  /** scalar attribute values on freshly broken faces (attributes not listed are interpolated) */
  interior: Record<string, number>
  /** pieces smaller than this share of the source volume are dropped as dust */
  minShare?: number
}

/** Breaks a closed solid into one piece per seed (seeds should lie inside it). */
export function fracture(source: Solid, seeds: Vector3[], o: FractureOptions): Piece[] {
  const names = Object.keys(source.scalars)
  const stride = 3 + names.length
  const base = weld(source, names)
  const total = Math.abs(solidMass(source).volume)
  const capCorner = names.map((name) => o.interior[name] ?? source.scalars[name][0])
  const pieces: Piece[] = []
  const nrm = new Vector3()

  for (const seed of seeds) {
    let w: Work | null = copyWork(base)
    // farthest point of the piece from its seed: planes beyond twice that can't touch it
    const reach = (m: Work) => {
      let r = 0
      for (const v of m.tv) r = Math.max(r, (m.x[v] - seed.x) ** 2 + (m.y[v] - seed.y) ** 2 + (m.z[v] - seed.z) ** 2)
      return Math.sqrt(r)
    }
    let r = reach(w)
    const others = seeds.filter((q) => q !== seed).sort((a, b) => a.distanceToSquared(seed) - b.distanceToSquared(seed))
    for (const q of others) {
      const dist = q.distanceTo(seed)
      if (dist < 1e-6) continue
      if (dist / 2 > r) break
      nrm.subVectors(q, seed).divideScalar(dist)
      const d = nrm.x * (seed.x + q.x) * 0.5 + nrm.y * (seed.y + q.y) * 0.5 + nrm.z * (seed.z + q.z) * 0.5
      const before: Work = w
      w = cut(before, nrm.x, nrm.y, nrm.z, d, stride, capCorner)
      if (!w) break
      if (w !== before) r = reach(w)
    }
    if (!w || !w.tv.length) continue

    const m = w
    const mass = massOf((t, out) => {
      for (let k = 0; k < 3; k++) {
        const v = m.tv[t * 3 + k]
        out[k * 3] = m.x[v]
        out[k * 3 + 1] = m.y[v]
        out[k * 3 + 2] = m.z[v]
      }
    }, m.tv.length / 3)
    if (mass.volume < total * (o.minShare ?? 0.004)) continue

    const count = m.tv.length
    const position = new Float32Array(count * 3)
    const normal = new Float32Array(count * 3)
    const scalars: Record<string, Float32Array> = Object.fromEntries(names.map((name) => [name, new Float32Array(count)]))
    for (let i = 0; i < count; i++) {
      const v = m.tv[i]
      const c = m.tc[i] * stride
      position[i * 3] = m.x[v]
      position[i * 3 + 1] = m.y[v]
      position[i * 3 + 2] = m.z[v]
      normal[i * 3] = m.ca[c]
      normal[i * 3 + 1] = m.ca[c + 1]
      normal[i * 3 + 2] = m.ca[c + 2]
      names.forEach((name, k) => (scalars[name][i] = m.ca[c + 3 + k]))
    }
    pieces.push({ position, normal, scalars, center: mass.center, volume: mass.volume, seed: seed.clone() })
  }
  return pieces
}

/**
 * Seeds for a fracture: scattered through the solid, with a share of them
 * packed around `focus` (where the blow landed) so the pieces there are small.
 */
export function scatterSeeds(s: Solid, count: number, random: () => number, focus?: { point: Vector3; radius: number; share: number }) {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  const p = s.position
  for (let i = 0; i < p.length; i += 3) {
    min.min(new Vector3(p[i], p[i + 1], p[i + 2]))
    max.max(new Vector3(p[i], p[i + 1], p[i + 2]))
  }
  const seeds: Vector3[] = []
  const near = focus ? Math.round(count * focus.share) : 0
  for (let tries = 0; seeds.length < count && tries < count * 60; tries++) {
    const q = new Vector3()
    if (focus && seeds.length < near) {
      // a rough gaussian ball around the point of impact
      const g = () => (random() + random() + random() - 1.5) * 1.15
      q.set(g(), g(), g()).multiplyScalar(focus.radius).add(focus.point)
    } else {
      q.set(min.x + (max.x - min.x) * random(), min.y + (max.y - min.y) * random(), min.z + (max.z - min.z) * random())
    }
    if (solidContains(s, q)) seeds.push(q)
  }
  return seeds
}
