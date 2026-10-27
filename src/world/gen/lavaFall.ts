import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from 'three'
import { createNoise3D } from '../../geometry/noise'
import type { V2 } from '../../geometry/polygon'
import { smoothstep } from '../../geometry/random'
import type { RiverExit } from './stoneField'

export interface LavaFall {
  geometry: BufferGeometry
  /** centreline samples (for emitters, particles, heat queries) */
  path: Vector3[]
  lip: Vector3
  /** bottom of the visible stream, where droplets break away */
  bottom: Vector3
  dir: V2
  halfWidth: number
}

interface FallOptions {
  exit: RiverExit
  lavaY: number
  halfWidth: number
  speed: number
  depth: number
  seed: number
  /** how far upstream (along the channel) the ribbon starts, blending into the sheet */
  upstream?: number
  /** terminal speed of the falling lava */
  maxSpeed?: number
  /** length over which the stream tears apart at the bottom */
  endFade?: number
  /** scales the lip curl and lateral drift (bigger falls) */
  scale?: number
}

/**
 * Builds a lava fall as one continuous ribbon: it starts upstream inside the
 * channel (fading in over the molten sheet), curls over the lip and plunges
 * down the cliff. `aFlow.x` stores travel time so the surface accelerates as it falls.
 */
export function buildLavaFall(o: FallOptions): LavaFall {
  const noise = createNoise3D(o.seed)
  const { exit } = o
  const ks = o.scale ?? 1
  const up = o.upstream ?? 2.2 * ks
  const maxSpeed = o.maxSpeed ?? 2.8
  const endFade = o.endFade ?? 3.0
  const [dx, dz] = exit.dir
  const lip = new Vector3(exit.lip[0], o.lavaY, exit.lip[1])

  // upstream part follows the channel centreline
  const pts: Vector3[] = []
  const line = exit.line
  let acc = 0
  const back: Vector3[] = []
  back.push(new Vector3(line[exit.exitIndex][0], o.lavaY, line[exit.exitIndex][1]))
  for (let k = exit.exitIndex; k > 0 && acc < up; k--) {
    const a = line[k]
    const b = line[k - 1]
    acc += Math.hypot(a[0] - b[0], a[1] - b[1])
    back.push(new Vector3(b[0], o.lavaY, b[1]))
  }
  pts.push(...back.reverse())
  pts.push(lip.clone())
  // over the lip and down the cliff
  const drop = (t: number, dy: number) => new Vector3(lip.x + dx * t * ks, o.lavaY - dy * ks, lip.z + dz * t * ks)
  pts.push(drop(0.12, 0.05), drop(0.26, 0.2), drop(0.38, 0.5), drop(0.47, 1.0), drop(0.53, 1.8))
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    const f = i / steps
    pts.push(drop(0.56 + 0.12 * f + 0.06 * noise(f * 3, 1, 2), 1.8 + (o.depth / ks - 1.8) * f))
  }

  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5)
  const length = curve.getLength()
  const N = Math.ceil(length / (0.07 * Math.sqrt(ks)))
  const M = 12
  const samples = curve.getSpacedPoints(N)
  const lipLat = new Vector3(-dz, 0, dx)

  const positions: number[] = []
  const flow: number[] = []
  const halfW: number[] = []
  const normals: number[] = []
  let phi = 0
  let s = 0
  const tangent = new Vector3()
  const lat = new Vector3()
  const nrm = new Vector3()
  const upstreamLen = (() => {
    let l = 0
    for (let k = 1; k < pts.length && pts[k - 1].distanceTo(lip) > 1e-4; k++) l += pts[k].distanceTo(pts[k - 1])
    return l
  })()

  for (let i = 0; i <= N; i++) {
    const p = samples[i]
    if (i > 0) {
      const ds = p.distanceTo(samples[i - 1])
      s += ds
      const dropY = Math.max(0, o.lavaY - p.y)
      const v = o.speed + (maxSpeed - o.speed) * Math.pow(smoothstep(0, 3.2 * ks, dropY), 0.75)
      phi += ds / v
    }
    tangent.copy(curve.getTangentAt(Math.min(1, i / N))).normalize()
    const th = Math.hypot(tangent.x, tangent.z)
    const latFlow = new Vector3(-tangent.z, 0, tangent.x).normalize()
    lat.copy(lipLat).lerp(latFlow, smoothstep(0.25, 0.7, th) * (p.y > o.lavaY - 0.05 * ks ? 1 : 0)).normalize()
    nrm.crossVectors(lat, tangent).normalize()
    const dropY = Math.max(0, o.lavaY - p.y)
    const fall = smoothstep(0.05 * ks, 1.2 * ks, dropY)
    const n = noise((s * 0.6) / ks, 3.3, o.seed)
    let hw = o.halfWidth * (1 - 0.32 * smoothstep(0.3, o.depth, dropY)) * (1 + 0.14 * n)
    if (s < upstreamLen) hw = o.halfWidth * 1.05
    const bulge = (0.03 + 0.2 * fall) * hw
    // fade in over the sheet upstream, tear apart near the end
    const fadeIn = smoothstep(0.1, Math.max(0.6, upstreamLen - 0.4), s)
    const fadeOut = 1 - smoothstep(length - endFade, length - 0.1, s)
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * 2 - 1
      const off = a * hw
      const bump = bulge * (1 - a * a)
      positions.push(p.x + lat.x * off + nrm.x * bump, p.y + lat.y * off + nrm.y * bump + (s < upstreamLen ? 0.012 : 0), p.z + lat.z * off + nrm.z * bump)
      // tilt normals across the rounded section
      const tilt = a * (0.35 + 0.6 * fall)
      normals.push(nrm.x + lat.x * tilt, nrm.y + lat.y * tilt, nrm.z + lat.z * tilt)
      flow.push(phi, a, fall, Math.min(fadeIn, fadeOut))
      halfW.push(hw)
    }
  }

  const index: number[] = []
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j
      const b = a + 1
      const c = a + (M + 1)
      const d = c + 1
      index.push(a, c, b, b, c, d)
    }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  const nArr = new Float32Array(normals)
  for (let k = 0; k < nArr.length; k += 3) {
    const l = Math.hypot(nArr[k], nArr[k + 1], nArr[k + 2]) || 1
    nArr[k] /= l
    nArr[k + 1] /= l
    nArr[k + 2] /= l
  }
  geometry.setAttribute('normal', new BufferAttribute(nArr, 3))
  geometry.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 4))
  geometry.setAttribute('aHalfWidth', new BufferAttribute(new Float32Array(halfW), 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()

  return {
    geometry,
    path: samples,
    lip,
    bottom: samples[N].clone(),
    dir: exit.dir,
    halfWidth: o.halfWidth,
  }
}
