import { Delaunay } from 'd3-delaunay'
import { BufferAttribute, BufferGeometry } from 'three'
import { addColumn, MeshBuilder, randomFootprint, type V3 } from '../../geometry/builder'
import { createNoise3D, fbm3 } from '../../geometry/noise'
import { centroid, closestOnPolyline, ensureCCW, insetPolygon, pointInPolygon, smoothPolyline, type V2 } from '../../geometry/polygon'
import { clamp, Rng, smoothstep } from '../../geometry/random'

/**
 * Stone fields: Voronoi tilings of a jittered hex lattice, every cell a
 * beveled basalt column. One generator builds the causeway under the viewer,
 * the floating island that carries the monument, and the formations rising
 * out of the lava lake — so they all share one hand-cut look.
 */

export type CellKind = 'floor' | 'rim' | 'dais' | 'channel' | 'pool' | 'bank'

export interface FieldCell {
  index: number
  /** full Voronoi polygon (tiles the plane) */
  poly: V2[]
  /** the visible stone footprint (poly inset by half the gap) */
  stone: V2[]
  center: V2
  kind: CellKind
  top: number
  bottom: number
  neighbors: number[]
}

export interface RiverExit {
  /** smoothed centreline across the field top */
  line: V2[]
  /** index into `line` of the last sample before the rim */
  exitIndex: number
  /** lip point where the lava pours over the edge */
  lip: V2
  /** outward flow direction at the lip */
  dir: V2
}

export interface FieldRegion {
  /** world xz bounds to scatter seeds in: minX, minZ, maxX, maxZ */
  bounds: [number, number, number, number]
  /** is this ground point part of the field? */
  contains: (x: number, z: number) => boolean
  /** 0 at the heart of the field … 1 at its edge (drives column depth) */
  rho: (x: number, z: number) => number
}

export interface StoneFieldOptions extends FieldRegion {
  seed: number
  cell: number
  gap: number
  /** walking surface height (stairs, undulation); default 0 */
  baseTop?: (x: number, z: number) => number
  /** column depth below the top surface */
  depth: (rho: number, rng: Rng) => number
  /** absolute y every column reaches down to (overrides depth) — for stone standing in lava */
  floor?: number
  /** how far column tops may tilt (broken basalt) — default barely */
  topTilt?: number
  /** scales every small detail (bevels, rim steps, lava depth) — 1 matches cell ≈ 1 */
  detail?: number
  /** pointed, stalactite-like column ends (floating) or flat bases (standing in lava) */
  tips?: boolean
  rimVariation?: number
  rivers?: { points: V2[]; halfWidth: number }[]
  pool?: { center: V2; radius: V2 }
  /** footprints (in world xz) that should be raised into a dais */
  dais?: V2[][]
  /** areas kept flat and walkable on the rim */
  keepFlat?: { center: V2; radius: number }[]
  outcrops?: number
  bevel?: number
  /** heat creeps into the deep underside: glowing cracks toward the tips */
  hotUnderside?: boolean
  /** footprints of heavy objects that darken the ground around them */
  aoCasters?: V2[][]
  /** small molten pockets (cells turned to open lava) */
  lavaSpots?: { center: V2; radius: number }[]
}

export interface StoneField {
  geometry: BufferGeometry
  cells: FieldCell[]
  exits: RiverExit[]
  /** convex hulls (flat xyz arrays) for physics colliders */
  hulls: Float32Array[]
  /** molten surface (xz triangles at y = 0) covering every non-rim cell + exit corridors */
  sheet: BufferGeometry | null
  /** lava surface height of the field's own channels (relative to baseTop 0 fields) */
  lavaOffset: number
}

/** Convenience region: everything within a polar outline around a centre. */
export function radialRegion(center: V2, outline: (theta: number) => number): FieldRegion {
  const [cx, cz] = center
  const maxR = Math.max(...Array.from({ length: 72 }, (_, i) => outline((i / 72) * Math.PI * 2)))
  return {
    bounds: [cx - maxR - 1, cz - maxR - 1, cx + maxR + 1, cz + maxR + 1],
    contains: (x, z) => Math.hypot(x - cx, z - cz) < outline(Math.atan2(z - cz, x - cx)),
    rho: (x, z) => clamp(Math.hypot(x - cx, z - cz) / outline(Math.atan2(z - cz, x - cx)), 0, 1),
  }
}

export function generateStoneField(o: StoneFieldOptions): StoneField {
  const rng = new Rng(o.seed)
  const noise = createNoise3D(o.seed * 7 + 3)
  const s = o.cell
  const k = o.detail ?? 1
  const baseTop = o.baseTop ?? (() => 0)
  const tips = o.tips ?? true
  const [minX, minZ, maxX, maxZ] = o.bounds
  const pad = s * 2.5

  // jittered hexagonal lattice → basalt-like Voronoi cells
  const seeds: V2[] = []
  const rowH = (s * Math.sqrt(3)) / 2
  for (let row = Math.floor((minZ - pad) / rowH); row <= Math.ceil((maxZ + pad) / rowH); row++) {
    for (let col = Math.floor((minX - pad) / s) - 1; col <= Math.ceil((maxX + pad) / s) + 1; col++) {
      const x = col * s + (row & 1 ? s / 2 : 0)
      const z = row * rowH
      // drop a few seeds so some stones grow larger
      if (rng.chance(0.07) && o.rho(x, z) < 0.75) continue
      seeds.push([x + rng.gauss() * s * 0.16, z + rng.gauss() * s * 0.16])
    }
  }
  const voronoi = Delaunay.from(seeds).voronoi([minX - pad * 2, minZ - pad * 2, maxX + pad * 2, maxZ + pad * 2])

  const inside: boolean[] = seeds.map(([x, z]) => {
    const w = 0.35 * s
    return o.contains(x + noise(x * 0.35 / s, 4.2, z * 0.35 / s) * w, z + noise(x * 0.35 / s, 9.7, z * 0.35 / s) * w)
  })

  const rivers = (o.rivers ?? []).map((r) => ({ ...r, line: smoothPolyline(r.points, 0.15 * k) }))

  const cells: FieldCell[] = []
  const cellOf = new Map<number, FieldCell>()
  for (let i = 0; i < seeds.length; i++) {
    if (!inside[i]) continue
    const raw = voronoi.cellPolygon(i)
    if (!raw) continue
    const poly = ensureCCW(raw.slice(0, -1).map(([x, z]) => [x, z] as V2))
    const cell: FieldCell = {
      index: i,
      poly,
      stone: insetPolygon(poly, o.gap / 2),
      center: centroid(poly),
      kind: 'floor',
      top: 0,
      bottom: -2,
      neighbors: [...voronoi.neighbors(i)],
    }
    cells.push(cell)
    cellOf.set(i, cell)
  }

  // --- classification -----------------------------------------------------
  const inPool = (p: V2) =>
    !!o.pool && ((p[0] - o.pool.center[0]) / o.pool.radius[0]) ** 2 + ((p[1] - o.pool.center[1]) / o.pool.radius[1]) ** 2 < 1
  for (const c of cells) {
    if (inPool(c.center)) c.kind = 'pool'
    if (o.lavaSpots?.some((l) => Math.hypot(c.center[0] - l.center[0], c.center[1] - l.center[1]) < l.radius)) c.kind = 'pool'
  }
  for (const r of rivers) {
    for (const c of cells) {
      if (c.kind === 'pool') continue
      const hit = closestOnPolyline(c.center, r.line)
      const containsLine = r.line.some((p) => pointInPolygon(p, c.poly))
      if (hit.dist < r.halfWidth + 0.06 * k || containsLine) c.kind = 'channel'
    }
  }
  for (const c of cells) {
    if (c.kind === 'floor' && o.dais?.some((fp) => pointInPolygon(c.center, fp))) c.kind = 'dais'
  }
  for (const c of cells) {
    if ((c.kind === 'floor' || c.kind === 'dais') && c.neighbors.some((n) => !cellOf.has(n))) c.kind = 'rim'
  }
  for (const c of cells) {
    if (c.kind !== 'floor') continue
    if (c.neighbors.some((n) => {
      const nk = cellOf.get(n)?.kind
      return nk === 'channel' || nk === 'pool'
    })) c.kind = 'bank'
  }

  // --- river exits -----------------------------------------------------------
  const exits: RiverExit[] = []
  for (const r of rivers) {
    let exitIndex = r.line.length - 1
    for (let i = 0; i < r.line.length; i++) {
      const [x, z] = r.line[i]
      if (!o.contains(x, z)) {
        exitIndex = Math.max(1, i - 1)
        break
      }
    }
    const a = r.line[Math.max(0, exitIndex - 2)]
    const b = r.line[exitIndex]
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const dir: V2 = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl]
    // the lip sits just beyond every stone inside the exit corridor
    let maxT = 0
    for (const c of cells) {
      for (const v of c.stone) {
        const rx = v[0] - b[0]
        const rz = v[1] - b[1]
        const t = rx * dir[0] + rz * dir[1]
        const lat = Math.abs(rx * dir[1] - rz * dir[0])
        if (lat < r.halfWidth + 0.35 * k && t > maxT) maxT = t
      }
    }
    const lip: V2 = [b[0] + dir[0] * (maxT + 0.05 * k), b[1] + dir[1] * (maxT + 0.05 * k)]
    exits.push({ line: r.line, exitIndex, lip, dir })
  }
  // cells right at an exit stay level with the channel so the lava can leave
  for (const c of cells) {
    if (c.kind !== 'rim') continue
    for (const e of exits) {
      const rx = c.center[0] - e.lip[0]
      const rz = c.center[1] - e.lip[1]
      const lat = Math.abs(rx * e.dir[1] - rz * e.dir[0])
      const t = rx * e.dir[0] + rz * e.dir[1]
      if (lat < 0.55 * k && t > -1.6 * k) c.kind = 'channel'
    }
  }

  // --- heights & depths --------------------------------------------------------
  const rimVar = (o.rimVariation ?? 1) * k
  for (const c of cells) {
    const [x, z] = c.center
    const base = baseTop(x, z)
    const flat = o.keepFlat?.some((f) => Math.hypot(x - f.center[0], z - f.center[1]) < f.radius)
    let off: number
    switch (c.kind) {
      case 'pool':
      case 'channel':
        off = (-0.55 + rng.range(-0.04, 0.04)) * k
        break
      case 'dais':
        off = (0.2 + rng.range(-0.03, 0.03)) * k
        break
      case 'bank':
        off = rng.range(-0.06, 0.03) * k
        break
      case 'rim': {
        const roll = rng.next()
        if (flat) off = rng.range(-0.03, 0.02) * k
        else if (roll < 0.24) off = -rng.range(0.18, 0.85) * rimVar
        else if (roll < 0.42) off = rng.range(0.1, 0.5) * rimVar
        else off = rng.range(-0.05, 0.04) * k
        break
      }
      default:
        off = rng.range(-0.035, 0.035) * k
    }
    c.top = base + off
    c.bottom =
      o.floor !== undefined
        ? o.floor + rng.range(-0.3, 0.3)
        : c.top - o.depth(o.rho(x, z), rng) * (0.85 + 0.3 * (0.5 + 0.5 * fbm3(noise, x * 0.18 / k, 9.1, z * 0.18 / k, 3)))
  }

  // --- geometry ------------------------------------------------------------------
  const b = new MeshBuilder()
  const bevel = (o.bevel ?? 0.055) * k
  for (const c of cells) {
    b.seedValue = rng.next()
    b.heatValue = 0
    const depth = c.top - c.bottom
    const isLava = c.kind === 'channel' || c.kind === 'pool'
    const tilt = Math.max(c.kind === 'rim' ? 0.06 : 0.014, o.topTilt ?? 0)
    addColumn(b, {
      poly: c.stone,
      top: c.top,
      bottom: c.bottom,
      bevel: isLava ? 0.04 * k : bevel * rng.range(0.8, 1.3),
      bottomBevel: 0.05 * k,
      tilt: [rng.range(-tilt, tilt), rng.range(-tilt, tilt)],
      taper: tips ? clamp(rng.range(0.55, 0.88) - (depth / k) * 0.012, 0.42, 0.9) : rng.range(0.92, 1.05),
      lean: [rng.range(-0.12, 0.12) * k, rng.range(-0.12, 0.12) * k],
      tip: tips ? (rng.range(0.25, 0.75) + (depth / k) * rng.range(0.04, 0.16)) * k : 0,
      tipOffset: [rng.range(-0.1, 0.1) * k, rng.range(-0.1, 0.1) * k],
      edgeTop: isLava ? 0.3 : 1,
    })
  }

  // big angular outcrops wedged into the cliff break up the columnar rhythm
  const rims = cells.filter((c) => c.kind === 'rim')
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  for (let n = 0, tries = 0; n < (o.outcrops ?? 0) && tries < 200 && rims.length; tries++) {
    const c = rng.pick(rims)
    const [px, pz] = c.center
    if (exits.some((e) => Math.hypot(px - e.lip[0], pz - e.lip[1]) < 2.4 * k)) continue
    if (o.keepFlat?.some((f) => Math.hypot(px - f.center[0], pz - f.center[1]) < f.radius + 0.8 * k)) continue
    n++
    const ol = Math.hypot(px - cx, pz - cz) || 1
    const ox = (px - cx) / ol
    const oz = (pz - cz) / ol
    const size = rng.range(0.7, 1.35) * k
    // wedged into the cliff it breaks from, never dangling free below a shallow one
    const y = c.top - Math.min(rng.range(1.2, 3.6) * k, (c.top - c.bottom) * 0.55)
    b.seedValue = rng.next()
    const fp = randomFootprint(() => rng.next(), rng.int(5, 7), size, size * rng.range(0.7, 1), 0.2).map(
      ([x, z]) => [x + px + ox * 0.3 * k, z + pz + oz * 0.3 * k] as V2,
    )
    addColumn(b, {
      poly: fp,
      top: y,
      bottom: y - size * rng.range(0.9, 1.6),
      bevel: 0.09 * k,
      tilt: [-ox * 0.45 + rng.range(-0.15, 0.15), -oz * 0.45 + rng.range(-0.15, 0.15)],
      taper: rng.range(0.5, 0.75),
      lean: [ox * rng.range(-0.3, 0.1) * k, oz * rng.range(-0.3, 0.1) * k],
      tip: rng.range(0.4, 1.1) * k,
    })
  }

  const geometry = b.build({
    crease: 0.62,
    displace: ([x, y, z]) => {
      // keep the walkable top flat-ish; let the cliffs and underside wander
      const rel = y - baseTop(x, z)
      const below = smoothstep(-0.3 * k, -3.5 * k, rel)
      const amp = (0.035 + 0.13 * below) * k
      const f = 0.32 / k
      return [
        x + noise(x * f, y * f * 0.6, z * f) * amp,
        y + noise(x * f + 11.3, y * f, z * f - 7.1) * (0.012 + 0.05 * below) * k,
        z + noise(x * f - 5.7, y * f * 0.6 + 3.3, z * f + 2.9) * amp,
      ]
    },
  })

  bakeOcclusion(geometry, cells, o.aoCasters ?? [], o.gap * 1.6 + 0.06 * k, 0.5 * k)
  if (o.hotUnderside) bakeUndersideHeat(geometry, noise, baseTop, k)

  // colliders: one convex prism per stone
  const hulls: Float32Array[] = []
  for (const c of cells) {
    const h: number[] = []
    for (const [x, z] of c.stone) h.push(x, c.top, z, x, c.top - 0.6 * k, z)
    hulls.push(new Float32Array(h))
  }

  // molten sheet: every non-rim cell + exit corridors (lava under the floor shows in the seams)
  let sheet: BufferGeometry | null = null
  if (rivers.length || o.pool || o.lavaSpots?.length) {
    const tris: number[] = []
    const fan = (poly: V2[]) => {
      const cc = centroid(poly)
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]
        const q = poly[(i + 1) % poly.length]
        tris.push(cc[0], cc[1], q[0], q[1], p[0], p[1])
      }
    }
    for (const c of cells) if (c.kind !== 'rim') fan(c.poly)
    for (const [ei, e] of exits.entries()) {
      const hw = (o.rivers?.[ei].halfWidth ?? 0.5) + 0.12 * k
      const back: V2 = [e.lip[0] - e.dir[0] * 2.2 * k, e.lip[1] - e.dir[1] * 2.2 * k]
      const nx = -e.dir[1]
      const nz = e.dir[0]
      fan(
        ensureCCW([
          [back[0] + nx * hw, back[1] + nz * hw],
          [back[0] - nx * hw, back[1] - nz * hw],
          [e.lip[0] - nx * hw, e.lip[1] - nz * hw],
          [e.lip[0] + nx * hw, e.lip[1] + nz * hw],
        ]),
      )
    }
    const pos = new Float32Array((tris.length / 2) * 3)
    for (let i = 0, j = 0; i < tris.length; i += 2, j += 3) {
      pos[j] = tris[i]
      pos[j + 2] = tris[i + 1]
    }
    sheet = new BufferGeometry()
    sheet.setAttribute('position', new BufferAttribute(pos, 3))
    const nrm = new Float32Array(pos.length)
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1
    sheet.setAttribute('normal', new BufferAttribute(nrm, 3))
  }

  return { geometry, cells, exits, hulls, sheet, lavaOffset: -0.15 * k }
}

/**
 * Baked ambient occlusion. Side faces are probed against neighbouring stones
 * (deep, narrow gaps go dark; open cliffs stay lit) and the floor darkens
 * where heavy objects (the monument) stand on it.
 */
function bakeOcclusion(geometry: BufferGeometry, cells: FieldCell[], casters: V2[][], probe: number, depthScale: number) {
  const pos = geometry.getAttribute('position')
  const nrm = geometry.getAttribute('normal')
  const ao = geometry.getAttribute('aAO')
  const G = 1.5
  const grid = new Map<string, FieldCell[]>()
  for (const c of cells) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of c.poly) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++)
      for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
        const key = `${gx},${gz}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key)!.push(c)
      }
  }
  const cellAt = (x: number, z: number) => grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`)?.find((c) => pointInPolygon([x, z], c.poly))
  const distToCaster = (x: number, z: number) => {
    let best = Infinity
    for (const fp of casters) {
      if (pointInPolygon([x, z], fp)) return 0
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i]
        const bb = fp[(i + 1) % fp.length]
        const dx = bb[0] - a[0]
        const dz = bb[1] - a[1]
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
        best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t))
      }
    }
    return best
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ny = nrm.getY(i)
    let occ = 0
    if (Math.abs(ny) < 0.75) {
      const nx = nrm.getX(i)
      const nz = nrm.getZ(i)
      const l = Math.hypot(nx, nz) || 1
      const c = cellAt(x + (nx / l) * probe, z + (nz / l) * probe)
      if (c && c.top > y) occ = Math.min(1, (c.top - y) / depthScale)
    } else if (ny > 0.75 && casters.length) {
      occ = 0.55 * (1 - Math.min(1, distToCaster(x, z) / (depthScale * 1.8)))
    }
    ao.setX(i, 1 - 0.72 * occ)
  }
  ao.needsUpdate = true
}

/** Heat creeping into the lowest columns (patchy, strongest at the tips). */
function bakeUndersideHeat(geometry: BufferGeometry, noise: (x: number, y: number, z: number) => number, baseTop: (x: number, z: number) => number, k: number) {
  const pos = geometry.getAttribute('position')
  const heat = geometry.getAttribute('aHeat')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const rel = pos.getY(i) - baseTop(x, z)
    if (rel > -1.6 * k) continue
    const depth = smoothstep(-1.6 * k, -7.5 * k, rel)
    const patch = smoothstep(-0.1, 0.5, noise((x * 0.45) / k, 31.7, (z * 0.45) / k))
    heat.setX(i, Math.max(heat.getX(i), 0.75 * depth * patch))
  }
  heat.needsUpdate = true
}

export type { V3 }

/** One static trimesh of every stone's walkable top — a single cheap physics collider per field. */
export function topsTrimesh(cells: FieldCell[]): { vertices: Float32Array; indices: Uint32Array } {
  const v: number[] = []
  const idx: number[] = []
  for (const c of cells) {
    const base = v.length / 3
    const [cx, cz] = centroid(c.stone)
    v.push(cx, c.top, cz)
    for (const [x, z] of c.stone) v.push(x, c.top, z)
    const n = c.stone.length
    for (let i = 0; i < n; i++) idx.push(base, base + 1 + ((i + 1) % n), base + 1 + i)
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) }
}
