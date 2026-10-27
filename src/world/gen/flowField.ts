import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three'
import { pointInPolygon, smoothPolyline, type V2 } from '../../geometry/polygon'

/**
 * A baked 2D field over a lava surface that drives the molten-sheet shader:
 *  r,g  surface velocity (world units / s)
 *  b    heat (glow of seams between stones, crack heat)
 *  a    openness: 0 = hidden under stone (seams only) … 1 = open, flowing lava;
 *       in between = crust-covered lava
 * The same data is sampled on the CPU for gameplay (debris sinking, heat).
 */
export interface FlowField {
  texture: DataTexture
  /** minX, minZ, sizeX, sizeZ */
  bounds: [number, number, number, number]
  width: number
  height: number
  data: Float32Array
  sample(x: number, z: number): { vx: number; vz: number; heat: number; molten: number }
}

export interface FlowFieldSpec {
  bounds: [number, number, number, number]
  res: number
  /** openness of lava not otherwise described (0 for an island top, ~0.3 for a crusted lake) */
  baseOpen?: number
  /** heat of open lava not otherwise described */
  baseHeat?: number
  /** polygons of open molten lava */
  open?: V2[][]
  /** polygons covered by stone: openness 0, heat decays with distance from open lava */
  covered?: V2[][]
  /** currents: velocity along the line, openness falling off across it */
  streams?: { line: V2[]; halfWidth: number; speed: number }[]
  /** upwelling pools: outflow + slow swirl */
  pools?: { center: V2; radius: V2; speed: number }[]
  /** polygons radiating extra heat (e.g. the monument's feet) */
  hot?: V2[][]
  /** how fast seam heat fades with distance from open lava */
  heatFalloff?: number
  /** default drift velocity */
  drift?: V2
}

export function buildFlowField(spec: FlowFieldSpec): FlowField {
  const [bx, bz, sx, sz] = spec.bounds
  const res = spec.res
  const W = Math.round(sx / res)
  const H = Math.round(sz / res)
  const N = W * H
  const toWorld = (i: number, j: number): V2 => [bx + ((i + 0.5) / W) * sx, bz + ((j + 0.5) / H) * sz]
  const rasterize = (poly: V2[], fn: (k: number, p: V2) => void) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of poly) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    const i0 = Math.max(0, Math.floor(((x0 - bx) / sx) * W) - 1)
    const i1 = Math.min(W - 1, Math.ceil(((x1 - bx) / sx) * W) + 1)
    const j0 = Math.max(0, Math.floor(((z0 - bz) / sz) * H) - 1)
    const j1 = Math.min(H - 1, Math.ceil(((z1 - bz) / sz) * H) + 1)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const p = toWorld(i, j)
        if (pointInPolygon(p, poly)) fn(j * W + i, p)
      }
  }

  // --- openness ---
  const open = new Float32Array(N).fill(spec.baseOpen ?? 0)
  for (const poly of spec.open ?? []) rasterize(poly, (k) => (open[k] = 1))

  // --- velocity + stream openness, rasterised segment by segment ---
  const vel = new Float32Array(N * 2)
  const wsum = new Float32Array(N)
  for (const st of spec.streams ?? []) {
    const line = smoothPolyline(st.line, Math.max(res * 2, 0.4))
    const R = st.halfWidth * 3
    for (let s = 0; s < line.length - 1; s++) {
      const a = line[s]
      const b = line[s + 1]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len2 = dx * dx + dz * dz || 1e-9
      const len = Math.sqrt(len2)
      const tx = dx / len
      const tz = dz / len
      const i0 = Math.max(0, Math.floor(((Math.min(a[0], b[0]) - R - bx) / sx) * W))
      const i1 = Math.min(W - 1, Math.ceil(((Math.max(a[0], b[0]) + R - bx) / sx) * W))
      const j0 = Math.max(0, Math.floor(((Math.min(a[1], b[1]) - R - bz) / sz) * H))
      const j1 = Math.min(H - 1, Math.ceil(((Math.max(a[1], b[1]) + R - bz) / sz) * H))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const [px, pz] = toWorld(i, j)
          const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2))
          const d = Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t)
          if (d > R) continue
          const k = j * W + i
          const w = Math.exp(-((d / st.halfWidth) ** 2))
          const profile = 0.45 + 0.55 * Math.max(0, 1 - (d / (st.halfWidth * 1.6)) ** 2)
          vel[k * 2] += tx * st.speed * profile * w
          vel[k * 2 + 1] += tz * st.speed * profile * w
          wsum[k] += w
          const o = 1 - Math.min(1, Math.max(0, (d - st.halfWidth * 0.35) / (st.halfWidth * 1.1)))
          open[k] = Math.max(open[k], o * o * (3 - 2 * o))
        }
    }
  }
  for (const pool of spec.pools ?? []) {
    const [cx, cz] = pool.center
    const [rx, rz] = pool.radius
    rasterize(
      Array.from({ length: 24 }, (_, a) => [cx + Math.cos((a / 24) * Math.PI * 2) * rx * 1.6, cz + Math.sin((a / 24) * Math.PI * 2) * rz * 1.6] as V2),
      (k, p) => {
        const ex = (p[0] - cx) / rx
        const ez = (p[1] - cz) / rz
        const e = Math.hypot(ex, ez)
        const w = Math.exp(-(e * e) / 0.5) * 1.4
        const dx = p[0] - cx
        const dz = p[1] - cz
        const dl = Math.hypot(dx, dz) || 1
        const out = pool.speed * 0.14 * Math.min(1, e)
        const swirl = pool.speed * 0.07
        vel[k * 2] += ((dx / dl) * out - (dz / dl) * swirl) * w
        vel[k * 2 + 1] += ((dz / dl) * out + (dx / dl) * swirl) * w
        wsum[k] += w
      },
    )
  }
  const [driftX, driftZ] = spec.drift ?? [0, 0]
  for (let k = 0; k < N; k++) {
    const w = wsum[k]
    const blend = Math.min(1, w)
    vel[k * 2] = w > 0 ? vel[k * 2] / Math.max(w, 1) : 0
    vel[k * 2 + 1] = w > 0 ? vel[k * 2 + 1] / Math.max(w, 1) : 0
    vel[k * 2] += driftX * (1 - blend)
    vel[k * 2 + 1] += driftZ * (1 - blend)
  }

  // --- stone cover: hidden lava, seams only ---
  for (const poly of spec.covered ?? []) rasterize(poly, (k) => (open[k] = 0))
  const openSmooth = blur(open, W, H, 1)

  // --- heat: open lava is hot; under stone it fades with distance to open lava ---
  const isOpen = new Float32Array(N)
  for (let k = 0; k < N; k++) isOpen[k] = open[k] > 0.12 ? 1 : 0
  const dist = distanceField(isOpen, W, H, res)
  const falloff = spec.heatFalloff ?? 0.85
  const baseHeat = spec.baseHeat ?? 1
  const heat = new Float32Array(N)
  for (let k = 0; k < N; k++) {
    heat[k] = isOpen[k] ? baseHeat * (0.55 + 0.45 * open[k]) : Math.exp(-dist[k] / falloff) * baseHeat * 0.9
  }
  for (const poly of spec.hot ?? []) rasterize(poly, (k) => (heat[k] = Math.min(1, heat[k] + 0.75)))
  const heatSmooth = blur(heat, W, H, 2)

  const data = new Float32Array(N * 4)
  for (let k = 0; k < N; k++) {
    data[k * 4] = vel[k * 2]
    data[k * 4 + 1] = vel[k * 2 + 1]
    data[k * 4 + 2] = Math.min(1, heatSmooth[k])
    data[k * 4 + 3] = openSmooth[k]
  }

  const half = new Uint16Array(N * 4)
  for (let k = 0; k < data.length; k++) half[k] = DataUtils.toHalfFloat(data[k])
  const texture = new DataTexture(half, W, H, RGBAFormat, HalfFloatType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true

  const sample = (x: number, z: number) => {
    const fx = Math.min(W - 1, Math.max(0, ((x - bx) / sx) * W - 0.5))
    const fz = Math.min(H - 1, Math.max(0, ((z - bz) / sz) * H - 0.5))
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    const at = (ii: number, jj: number, c: number) => data[(Math.min(H - 1, jj) * W + Math.min(W - 1, ii)) * 4 + c]
    const bil = (c: number) =>
      (at(i, j, c) * (1 - tx) + at(i + 1, j, c) * tx) * (1 - tz) + (at(i, j + 1, c) * (1 - tx) + at(i + 1, j + 1, c) * tx) * tz
    return { vx: bil(0), vz: bil(1), heat: bil(2), molten: bil(3) }
  }

  return { texture, bounds: spec.bounds, width: W, height: H, data, sample }
}

function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const ii = i + k
        if (ii < 0 || ii >= W) continue
        s += src[j * W + ii]
        n++
      }
      tmp[j * W + i] = s / n
    }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const jj = j + k
        if (jj < 0 || jj >= H) continue
        s += tmp[jj * W + i]
        n++
      }
      out[j * W + i] = s / n
    }
  return out
}

/** Two-pass chamfer distance transform (world units) to the nearest texel where mask > 0.5. */
function distanceField(mask: Float32Array, W: number, H: number, res: number): Float32Array {
  const d = new Float32Array(W * H)
  for (let k = 0; k < d.length; k++) d[k] = mask[k] > 0.5 ? 0 : 1e9
  const a = 1
  const b = Math.SQRT2
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i
      let v = d[k]
      if (i > 0) v = Math.min(v, d[k - 1] + a)
      if (j > 0) v = Math.min(v, d[k - W] + a)
      if (i > 0 && j > 0) v = Math.min(v, d[k - W - 1] + b)
      if (i < W - 1 && j > 0) v = Math.min(v, d[k - W + 1] + b)
      d[k] = v
    }
  for (let j = H - 1; j >= 0; j--)
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i
      let v = d[k]
      if (i < W - 1) v = Math.min(v, d[k + 1] + a)
      if (j < H - 1) v = Math.min(v, d[k + W] + a)
      if (i < W - 1 && j < H - 1) v = Math.min(v, d[k + W + 1] + b)
      if (i > 0 && j < H - 1) v = Math.min(v, d[k + W - 1] + b)
      d[k] = v
    }
  for (let k = 0; k < d.length; k++) d[k] *= res
  return d
}
