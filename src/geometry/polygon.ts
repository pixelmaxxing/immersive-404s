/** 2D polygon helpers. Polygons are arrays of [x, y] (or [x, z] on the ground plane). */
export type V2 = [number, number]

export function signedArea(poly: readonly V2[]): number {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % n]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function ensureCCW(poly: V2[]): V2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

export function centroid(poly: readonly V2[]): V2 {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % n]
    const cross = x0 * y1 - x1 * y0
    a += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(a) < 1e-9) {
    const sx = poly.reduce((s, p) => s + p[0], 0) / poly.length
    const sy = poly.reduce((s, p) => s + p[1], 0) / poly.length
    return [sx, sy]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** Remove vertices that are (nearly) duplicated or collinear. */
export function cleanPolygon(poly: V2[], eps = 1e-4): V2[] {
  const out: V2[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p)
  }
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop()
  }
  const res: V2[] = []
  for (let i = 0, n = out.length; i < n; i++) {
    const p = out[(i + n - 1) % n]
    const c = out[i]
    const q = out[(i + 1) % n]
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0])
    if (Math.abs(cross) > eps * 0.1) res.push(c)
  }
  return res
}

/**
 * Offsets a CCW polygon inward by `d` along the vertex bisectors (miter offset).
 * Works well for convex and mildly concave outlines with small offsets.
 */
export function insetPolygon(poly: readonly V2[], d: number): V2[] {
  const n = poly.length
  const out: V2[] = []
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n]
    const c = poly[i]
    const q = poly[(i + 1) % n]
    let e0x = c[0] - p[0]
    let e0y = c[1] - p[1]
    let e1x = q[0] - c[0]
    let e1y = q[1] - c[1]
    const l0 = Math.hypot(e0x, e0y) || 1
    const l1 = Math.hypot(e1x, e1y) || 1
    e0x /= l0
    e0y /= l0
    e1x /= l1
    e1y /= l1
    // inward normals of a CCW polygon point to the left of each edge
    const n0x = -e0y
    const n0y = e0x
    const n1x = -e1y
    const n1y = e1x
    let bx = n0x + n1x
    let by = n0y + n1y
    const bl = Math.hypot(bx, by) || 1
    bx /= bl
    by /= bl
    const cosHalf = Math.max(0.35, bx * n1x + by * n1y)
    const m = d / cosHalf
    out.push([c[0] + bx * m, c[1] + by * m])
  }
  return out
}

/** Cuts every corner of a polygon, replacing it with two points `size` along the adjacent edges. */
export function chamferPolygon(poly: readonly V2[], size: number, sizeJitter?: (i: number) => number): V2[] {
  const n = poly.length
  const out: V2[] = []
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n]
    const c = poly[i]
    const q = poly[(i + 1) % n]
    const lp = Math.hypot(c[0] - p[0], c[1] - p[1])
    const lq = Math.hypot(q[0] - c[0], q[1] - c[1])
    const s = size * (sizeJitter ? sizeJitter(i) : 1)
    const a = Math.min(s, lp * 0.32)
    const b = Math.min(s, lq * 0.32)
    out.push([c[0] + ((p[0] - c[0]) / lp) * a, c[1] + ((p[1] - c[1]) / lp) * a])
    out.push([c[0] + ((q[0] - c[0]) / lq) * b, c[1] + ((q[1] - c[1]) / lq) * b])
  }
  return out
}

export function scalePolygon(poly: readonly V2[], s: number, about: V2 = centroid(poly)): V2[] {
  return poly.map(([x, y]) => [about[0] + (x - about[0]) * s, about[1] + (y - about[1]) * s])
}

export function pointInPolygon(pt: V2, poly: readonly V2[]): boolean {
  let inside = false
  const [x, y] = pt
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside
  }
  return inside
}

/** Splits a convex polygon with the line through `p` with normal `n`. Returns [front, back]. */
export function splitConvex(poly: readonly V2[], p: V2, n: V2): [V2[], V2[]] {
  const front: V2[] = []
  const back: V2[] = []
  const side = (q: V2) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = side(a)
    const sb = side(b)
    if (sa >= 0) front.push(a)
    if (sa <= 0) back.push(a)
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb)
      const q: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      front.push(q)
      back.push(q)
    }
  }
  return [front, back]
}

export interface PolylineHit {
  dist: number
  /** arc length position of the closest point */
  s: number
  point: V2
  tangent: V2
  segment: number
}

export function closestOnPolyline(pt: V2, line: readonly V2[]): PolylineHit {
  let best: PolylineHit = { dist: Infinity, s: 0, point: line[0], tangent: [1, 0], segment: 0 }
  let acc = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1e-12
    const len = Math.sqrt(len2)
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = a[0] + dx * t
    const py = a[1] + dy * t
    const d = Math.hypot(pt[0] - px, pt[1] - py)
    if (d < best.dist) best = { dist: d, s: acc + t * len, point: [px, py], tangent: [dx / len, dy / len], segment: i }
    acc += len
  }
  return best
}

/** Centripetal-ish Catmull-Rom resampling of a 2D polyline at roughly uniform spacing. */
export function smoothPolyline(points: readonly V2[], spacing = 0.2): V2[] {
  const pts = points
  const dense: V2[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const steps = 24
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      const x =
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const y =
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      dense.push([x, y])
    }
  }
  dense.push(pts[pts.length - 1])
  // resample uniformly
  const out: V2[] = [dense[0]]
  let carry = 0
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]
    const b = dense[i]
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    let start = 0
    while (carry + seg - start >= spacing) {
      const need = spacing - carry
      start += need
      const t = start / seg
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      carry = 0
    }
    carry += seg - start
    seg = 0
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.35) out.push(last)
  else out[out.length - 1] = last
  return out
}
