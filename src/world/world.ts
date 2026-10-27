import { Vector3, type BufferGeometry } from 'three'
import { closestOnPolyline, ensureCCW, smoothPolyline, type V2 } from '../geometry/polygon'
import { buildDigit, digitFootprint, type DigitModel } from './gen/digits'
import { buildFlowField, type FlowField } from './gen/flowField'
import { buildLavaFall, type LavaFall } from './gen/lavaFall'
import {
  buildFarLands,
  buildFormation,
  buildFragments,
  buildIslet,
  buildStairs,
  type FarLandsModel,
  type FormationModel,
  type IsletModel,
  type StairsModel,
} from './gen/props'
import { generateStoneField, radialRegion, type StoneField } from './gen/stoneField'
import {
  CAUSEWAY,
  DIGIT_DEPTH,
  DIGITS,
  FORMATIONS,
  FRAGMENTS,
  ISLAND,
  islandRadius,
  ISLETS,
  LAKE_CURRENTS,
  LAVA_SPOTS,
  LAVA_Y,
  RIVERS,
  SOURCE_POOL,
  STAIRS,
  VIEWER,
} from './layout'

/** A lava light source: a glowing capsule that lights nearby stone. */
export interface Emitter {
  a: Vector3
  b: Vector3
  radius: number
  intensity: number
  /** flicker phase/speed seed */
  seed: number
}

export interface World {
  /** the colossal floating island carrying the monument */
  island: StoneField
  /** y of the molten rivers on the island top */
  islandLavaY: number
  islandField: FlowField
  /** the basalt causeway under the viewer's feet */
  causeway: StoneField
  lakeField: FlowField
  formations: FormationModel[]
  falls: LavaFall[]
  digits: DigitModel[]
  digitFootprints: V2[][]
  emitters: Emitter[]
  /** [first, count] ranges into `emitters` per region, for the stone shader */
  emitterGroups: { island: [number, number]; lake: [number, number] }
  stairs: StairsModel
  islets: IsletModel[]
  fragments: BufferGeometry[]
  farLands: FarLandsModel
}

let cache: World | null = null
/** how long procedural generation took (diagnostics) */
export let worldBuildMs = 0

/** Builds (once) every procedural piece of the world. Pure data — no React, no GPU. */
export function getWorld(): World {
  if (cache) return cache
  const t0 = performance.now()

  // --- the monument and the island that carries it ---
  const digits = DIGITS.map((d) => buildDigit(d.char, d.seed))
  const footprint = (margin: number) =>
    DIGITS.map((d, i) => digitFootprint(d.position, d.rotation[0], digits[i].width * d.scale, DIGIT_DEPTH * d.scale, margin))
  const digitFootprints = footprint(1.0)

  const island = generateStoneField({
    seed: ISLAND.seed,
    ...radialRegion(ISLAND.center, islandRadius),
    cell: ISLAND.cell,
    gap: ISLAND.gap,
    detail: ISLAND.detail,
    baseTop: () => ISLAND.top,
    // an inverted mountain of stalactites; its heart stops well above the lava so
    // the glow of the far lake shows through underneath and the island floats
    depth: (rho, rng) => (0.8 + 2.6 * Math.pow(Math.max(0, 1 - rho), 1.3) + rng.gauss() * 0.2) * ISLAND.detail,
    rivers: RIVERS.map((r) => ({ points: r.points, halfWidth: r.halfWidth })),
    pool: SOURCE_POOL,
    dais: digitFootprints,
    lavaSpots: LAVA_SPOTS,
    outcrops: 10,
    hotUnderside: true,
    aoCasters: footprint(0.08),
  })
  const islandLavaY = ISLAND.top + island.lavaOffset

  const islandField = buildFlowField({
    bounds: [-32, -77, 64, 38],
    res: 0.16,
    open: [
      ...island.cells.filter((c) => c.kind === 'channel' || c.kind === 'pool').map((c) => c.poly),
      ...island.exits.map((e, i) => {
        const hw = RIVERS[i].halfWidth + 0.3
        const back: V2 = [e.lip[0] - e.dir[0] * 4.8, e.lip[1] - e.dir[1] * 4.8]
        const front: V2 = [e.lip[0] + e.dir[0] * 0.4, e.lip[1] + e.dir[1] * 0.4]
        const nx = -e.dir[1]
        const nz = e.dir[0]
        return ensureCCW([
          [back[0] + nx * hw, back[1] + nz * hw],
          [back[0] - nx * hw, back[1] - nz * hw],
          [front[0] - nx * hw, front[1] - nz * hw],
          [front[0] + nx * hw, front[1] + nz * hw],
        ])
      }),
    ],
    streams: island.exits.map((e, i) => ({ line: e.line, halfWidth: RIVERS[i].halfWidth, speed: RIVERS[i].speed })),
    pools: [{ center: SOURCE_POOL.center, radius: SOURCE_POOL.radius, speed: 1.8 }],
    hot: digitFootprints,
    heatFalloff: 1.7,
  })

  const falls = island.exits.map((exit, i) =>
    buildLavaFall({
      exit,
      lavaY: islandLavaY,
      halfWidth: RIVERS[i].halfWidth * 1.1,
      speed: RIVERS[i].speed,
      depth: islandLavaY - LAVA_Y + 0.1,
      seed: 50 + i,
      scale: ISLAND.detail,
      maxSpeed: 6.5,
      endFade: 0.8,
    }),
  )

  // --- the causeway under the viewer's feet ---
  const causewayLine = smoothPolyline(CAUSEWAY.line, 0.5)
  const { landing } = CAUSEWAY
  const causeway = generateStoneField({
    seed: CAUSEWAY.seed,
    bounds: [-10, -37, 10, 28],
    contains: (x, z) =>
      closestOnPolyline([x, z], causewayLine).dist < CAUSEWAY.halfWidth(z) ||
      Math.hypot(x - landing.center[0], z - landing.center[1]) < landing.radius,
    rho: () => 0.5,
    cell: CAUSEWAY.cell,
    gap: CAUSEWAY.gap,
    detail: 1.15,
    tips: false,
    floor: -2.8,
    depth: () => 0,
    rimVariation: 0.9,
    keepFlat: [{ center: [VIEWER.position[0], VIEWER.position[2]], radius: 4.5 }],
  })

  const formations = FORMATIONS.map(buildFormation)

  // --- the lava lake: crusted, cut by molten currents, glowing in every seam ---
  const lakeField = buildFlowField({
    bounds: [-64, -112, 128, 142],
    res: 0.32,
    baseOpen: 0.15,
    baseHeat: 0.8,
    streams: LAKE_CURRENTS.map((c) => ({ line: c.points, halfWidth: c.halfWidth, speed: c.speed })),
    pools: falls.map((f) => ({ center: [f.bottom.x, f.bottom.z] as V2, radius: [3.2, 3.2] as V2, speed: 2.4 })),
    covered: [...causeway.cells.map((c) => c.poly), ...formations.flatMap((f) => f.field.cells.map((c) => c.poly))],
    heatFalloff: 1.3,
    drift: [0, 0.035],
  })

  const stairs = buildStairs(new Vector3(...STAIRS.from), new Vector3(...STAIRS.to), STAIRS.steps, STAIRS.seed)

  // --- lava light emitters, grouped so each material only loops over lights that reach it ---
  const yi = islandLavaY + 0.35
  const [pcx, pcz] = SOURCE_POOL.center
  const onIsland: Emitter[] = [
    // the source pool behind the monument back-lights the digits
    { a: new Vector3(pcx - 4, yi, pcz), b: new Vector3(pcx + 4, yi, pcz), radius: 3.2, intensity: 1.6, seed: 0.1 },
    // molten pockets at the monument's feet
    ...LAVA_SPOTS.map((l, i) => ({
      a: new Vector3(l.center[0] - 0.6, yi, l.center[1]),
      b: new Vector3(l.center[0] + 0.6, yi, l.center[1]),
      radius: 2.0,
      intensity: 1.3,
      seed: 5.1 + i,
    })),
    // the rivers running past the ends of the monument
    ...island.exits.map((e, i) => {
      const p = e.line[Math.floor(e.exitIndex * 0.55)]
      const q = e.line[e.exitIndex]
      return { a: new Vector3(p[0], yi, p[1]), b: new Vector3(q[0], yi, q[1]), radius: 2.6, intensity: 1.2, seed: 9.5 + i }
    }),
  ]
  // the falls, top to bottom, and the splash where they hit the lake
  const fallsLight: Emitter[] = falls.flatMap((f, i) => {
    const out = new Vector3(f.dir[0], 0, f.dir[1])
    const lat = new Vector3(-f.dir[1], 0, f.dir[0])
    return [
      {
        a: f.lip.clone().addScaledVector(out, 0.9).setY(islandLavaY - 0.8),
        b: f.bottom.clone().addScaledVector(out, 0.2).setY(LAVA_Y + 1.4),
        radius: 3.0,
        intensity: 1.5,
        seed: 3.3 + i,
      },
      {
        a: f.bottom.clone().addScaledVector(lat, -2.2).setY(LAVA_Y + 0.45),
        b: f.bottom.clone().addScaledVector(lat, 2.2).setY(LAVA_Y + 0.45),
        radius: 3.4,
        intensity: 1.4,
        seed: 4.4 + i,
      },
    ]
  })
  // molten currents flowing past the causeway
  const onLake: Emitter[] = []
  LAKE_CURRENTS.forEach((c, r) => {
    const line = smoothPolyline(c.points, 1).filter(([, z]) => z > -30 && z < 22)
    const step = Math.max(1, Math.floor(line.length / 3))
    for (let k = 0; k + step < line.length && k < step * 3; k += step) {
      const p = line[k]
      const q = line[k + step]
      onLake.push({ a: new Vector3(p[0], LAVA_Y + 0.4, p[1]), b: new Vector3(q[0], LAVA_Y + 0.4, q[1]), radius: 2.3, intensity: 1.15, seed: 8 + r + k * 0.13 })
    }
  })
  const emitters = [...onIsland, ...fallsLight, ...onLake]
  const emitterGroups = {
    /** lights that reach the island and the monument */
    island: [0, onIsland.length + fallsLight.length] as [number, number],
    /** lights that reach the causeway, the lake shores and the stairs */
    lake: [onIsland.length, fallsLight.length + onLake.length] as [number, number],
  }

  cache = {
    island,
    islandLavaY,
    islandField,
    causeway,
    lakeField,
    formations,
    falls,
    digits,
    digitFootprints,
    emitters,
    emitterGroups,
    stairs,
    islets: ISLETS.map(buildIslet),
    fragments: buildFragments(FRAGMENTS),
    farLands: buildFarLands(404),
  }
  worldBuildMs = Math.round(performance.now() - t0)
  return cache
}
