import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type Object3D, type ShaderMaterial } from 'three'
import { ARROW, ballistic, GRAVITY, launcher, refreshHittables, sweep, winGame, type ArrowHit } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { shake } from '../../world/interaction'
import { flash, ripple } from '../../world/lavaLight'
import { LAVA_Y } from '../../world/layout'
import { emitBurst } from '../fx/bursts'
import { createGlowMaterial, createPropMaterial, createTrailMaterial } from './materials'
import { buildArrow } from './model'

const POOL = 8
const FORWARD = new Vector3(0, 0, -1)

/** A fading ribbon behind an arrow in flight, always turned to face the camera. */
class Trail {
  readonly mesh: Mesh
  private readonly pts: Vector3[] = []
  private readonly times: number[] = []
  private readonly pos: BufferAttribute
  private readonly age: BufferAttribute

  constructor(
    readonly max = 28,
    readonly span = 0.34,
  ) {
    const g = new BufferGeometry()
    this.pos = new BufferAttribute(new Float32Array(max * 6), 3)
    this.age = new BufferAttribute(new Float32Array(max * 2), 1)
    const side = new Float32Array(max * 2).map((_, i) => (i % 2 ? 1 : -1))
    g.setAttribute('position', this.pos)
    g.setAttribute('aAge', this.age)
    g.setAttribute('aSide', new BufferAttribute(side, 1))
    const idx: number[] = []
    for (let i = 0; i < max - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    g.setIndex(idx)
    this.mesh = new Mesh(g, createTrailMaterial())
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
  }

  reset() {
    this.pts.length = 0
    this.times.length = 0
    this.mesh.geometry.setDrawRange(0, 0)
  }

  push(p: Vector3, time: number) {
    this.pts.unshift(p.clone())
    this.times.unshift(time)
    if (this.pts.length > this.max) {
      this.pts.pop()
      this.times.pop()
    }
  }

  update(camera: Vector3, now: number) {
    const n = this.pts.length
    const side = new Vector3()
    const tan = new Vector3()
    const view = new Vector3()
    let count = 0
    for (let i = 0; i < n; i++) {
      const a = (now - this.times[i]) / this.span
      if (a > 1) break
      const p = this.pts[i]
      tan.subVectors(this.pts[Math.max(0, i - 1)], this.pts[Math.min(n - 1, i + 1)])
      view.subVectors(camera, p)
      side.crossVectors(tan, view).normalize()
      // wide enough to read from far away, tapering as it cools
      const w = (0.035 + view.length() * 0.0042) * (1 - a * 0.65)
      this.pos.setXYZ(i * 2, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w)
      this.pos.setXYZ(i * 2 + 1, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w)
      this.age.setX(i * 2, a)
      this.age.setX(i * 2 + 1, a)
      count++
    }
    this.pos.needsUpdate = true
    this.age.needsUpdate = true
    this.mesh.geometry.setDrawRange(0, Math.max(0, count - 1) * 6)
  }
}

interface Flight {
  state: 'free' | 'flying' | 'stuck' | 'sinking'
  surface: ArrowHit['surface'] | null
  /** positioned at the tip, pointing along the flight */
  group: Group
  /** the arrow itself; quivers about the tip inside the group */
  body: Group
  glow: Mesh
  /** where the glow sits on a stuck arrow, in the arrow's own frame (it rides along with what it hit) */
  glowLocal: Vector3
  trail: Trail
  p0: Vector3
  v0: Vector3
  prev: Vector3
  t: number
  /** seconds since impact */
  since: number
  life: number
  scale: number
  emit: number
}

/**
 * Arrows in flight. Each one follows its exact ballistic path, sweeping a
 * ray along every frame's segment against the real geometry. They burn
 * like fire arrows, trailing sparks, and stick where they land: quivering
 * in stone, riding along on what they knock, sinking in the lava. One in
 * the 404 is the way home.
 */
export function Arrows() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const flights = useMemo<Flight[]>(() => {
    const model = buildArrow()
    const shaft = createPropMaterial({ color: '#3a2417', roughness: 0.55, grain: 900 })
    const nock = createPropMaterial({ color: '#d6c8b0', roughness: 0.55 })
    const head = createPropMaterial({ color: '#0d0b0b', roughness: 0.24, metalness: 0.35 })
    head.emissive.set('#ff5a16')
    head.emissiveIntensity = 3.2
    const fletch = createPropMaterial({ color: '#902712', roughness: 0.9 })
    const quad = new PlaneGeometry(1, 1)
    return Array.from({ length: POOL }, () => {
      const group = new Group()
      const body = new Group()
      for (const [g, m] of [
        [model.shaft, shaft],
        [model.nock, nock],
        [model.head, head],
        [model.fletching, fletch],
      ] as const) {
        const mesh = new Mesh(g, m)
        mesh.frustumCulled = false
        body.add(mesh)
      }
      group.add(body)
      group.visible = false
      const glow = new Mesh(quad, createGlowMaterial())
      glow.frustumCulled = false
      glow.visible = false
      glow.renderOrder = 4
      return {
        state: 'free',
        surface: null,
        group,
        body,
        glow,
        glowLocal: new Vector3(),
        trail: new Trail(),
        p0: new Vector3(),
        v0: new Vector3(),
        prev: new Vector3(),
        t: 0,
        since: 0,
        life: 0,
        scale: 1,
        emit: 0,
      }
    })
  }, [])
  const tmp = useMemo(() => ({ cur: new Vector3(), vel: new Vector3(), dir: new Vector3(), q: new Quaternion(), inv: new Matrix4() }), [])

  const root = useMemo(() => new Group(), [])
  useEffect(() => {
    scene.add(root)
    flights.forEach((f) => root.add(f.group, f.glow, f.trail.mesh))
    return () => void scene.remove(root)
  }, [scene, root, flights])

  const recycle = (f: Flight) => {
    if (f.group.parent !== root) root.attach(f.group)
    f.state = 'free'
    f.group.visible = false
    f.glow.visible = false
    f.trail.reset()
  }

  const orient = (g: Group, dir: Vector3) => g.quaternion.setFromUnitVectors(FORWARD, tmp.dir.copy(dir).normalize())

  // the bow hands arrows over here
  useEffect(() => {
    launcher.fire = (tip, velocity, draw) => {
      const f = flights.find((x) => x.state === 'free') ?? flights.reduce((a, b) => (a.since > b.since && a.state !== 'flying' ? a : b))
      if (f.state !== 'free') recycle(f)
      f.state = 'flying'
      f.p0.copy(tip)
      f.v0.copy(velocity)
      f.prev.copy(tip)
      f.t = 0
      f.since = 0
      f.emit = 0
      f.scale = 1
      f.body.rotation.set(0, 0, 0)
      f.group.visible = true
      f.group.position.copy(tip)
      f.group.scale.setScalar(1)
      orient(f.group, velocity)
      f.glow.visible = true
      f.surface = null
      ;(f.glow.material as ShaderMaterial).uniforms.uIntensity.value = 1
      f.trail.reset()
      f.trail.push(tip, performance.now() / 1000)
      shake(0.004 + draw * 0.008)
    }
    return () => void (launcher.fire = null)
  }, [flights])

  const impact = (f: Flight, hit: ArrowHit, vel: Vector3) => {
    const dir = tmp.dir.copy(vel).normalize().clone()
    const p = hit.point
    f.since = 0
    f.surface = hit.surface
    worldEvents.emit('arrow:hit', { position: p.toArray(), surface: hit.surface, digit: hit.surface === 'monument' ? hit.target?.index : undefined })

    if (hit.surface === 'lava') {
      f.glow.visible = false
      f.state = 'sinking'
      f.group.position.copy(p)
      orient(f.group, dir)
      ripple(p.x, p.z, 1.1)
      emitBurst({ position: p, count: 18, kind: 'droplet', speed: 2.8, spread: 0.7, size: 1.4 })
      emitBurst({ position: p, count: 10, kind: 'ember', speed: 1.6, size: 1.4 })
      flash(p.clone().setY(p.y + 0.6), 2.2, 1.7, 0.6)
      worldEvents.emit('lava:splash', { position: p.toArray(), strength: 0.8 })
      return
    }

    f.state = 'stuck'
    f.life = hit.surface === 'monument' ? Infinity : hit.surface === 'prop' ? 6 : 9
    // drive the tip in and leave the rest standing out of the surface
    f.group.position.copy(p).addScaledVector(dir, ARROW.length * f.scale * 0.2)
    orient(f.group, dir)
    if (hit.target) hit.target.mesh.attach(f.group)
    f.group.updateWorldMatrix(true, false)
    const k = Math.max(1, f.scale * 0.8)
    // seen almost end-on the shaft is a speck: the fire it carried keeps burning where it struck
    f.glow.position.copy(p).addScaledVector(hit.normal, 0.08 * k)
    f.glowLocal.copy(f.glow.position).applyMatrix4(tmp.inv.copy(f.group.matrixWorld).invert())
    emitBurst({ position: p, count: 12, kind: 'grit', speed: 2.2 * k, direction: hit.normal, spread: 0.9, size: k })
    emitBurst({ position: p, count: 8, kind: 'spark', speed: 3.4 * k, direction: hit.normal, spread: 0.8, size: k })
    flash(p.clone().addScaledVector(hit.normal, 0.3 * k), 1.6, 1.1 * k, 0.45)
    hit.target?.onHit?.(hit, vel)
    if (hit.surface === 'monument' && hit.target) winGame(hit.target.index ?? 0, p, hit.normal)
  }

  useFrame((state, dt) => {
    const d = Math.min(dt, 1 / 30)
    const now = performance.now() / 1000
    refreshHittables(state.clock.elapsedTime)
    const cam = camera.position

    for (const f of flights) {
      if (f.state === 'free') continue
      f.since += d

      if (f.state === 'flying') {
        f.t += d
        ballistic(f.p0, f.v0, f.t, tmp.cur)
        tmp.vel.copy(f.v0)
        tmp.vel.y -= GRAVITY * f.t
        const hit = sweep(f.prev, tmp.cur)
        if (hit && !hit.target?.passThrough) {
          f.trail.push(hit.point, now)
          impact(f, hit, tmp.vel)
        } else {
          if (hit?.target) {
            // threaded through the 0: a bullseye, and the arrow sails on
            hit.target.onHit?.(hit, tmp.vel)
            if (winGame(hit.target.index ?? 0, hit.point, hit.normal)) {
              worldEvents.emit('arrow:hit', { position: hit.point.toArray(), surface: 'monument', digit: hit.target.index })
            }
          }
          f.prev.copy(tmp.cur)
          f.group.position.copy(tmp.cur)
          orient(f.group, tmp.vel)
          // a little larger with distance so the shaft still reads far away
          const dist = tmp.cur.distanceTo(cam)
          f.scale = Math.min(3, Math.max(1, 1 + (dist - 6) * 0.03))
          f.group.scale.setScalar(f.scale)
          f.trail.push(tmp.cur, now)
          f.glow.position.copy(tmp.cur)
          f.glow.scale.setScalar(0.28 + dist * 0.012)
          f.emit += d * 26
          while (f.emit >= 1) {
            f.emit -= 1
            emitBurst({ position: tmp.cur, count: 1, kind: Math.random() < 0.3 ? 'spark' : 'ember', speed: 0.5, size: 1.3 + dist * 0.02 })
          }
          if (f.t > 7) recycle(f)
        }
      } else if (f.state === 'stuck') {
        // whatever it's stuck in may be moving, or may be gone (sunk in the lava)
        let top: Object3D = f.group
        while (top.parent) top = top.parent
        if (top !== scene) {
          recycle(f)
          continue
        }
        f.group.updateWorldMatrix(true, false)
        f.glow.position.copy(f.glowLocal).applyMatrix4(f.group.matrixWorld)
        // the shaft shudders and settles; its fire smoulders out (but not in the 404)
        const q = f.since
        const ember = f.surface === 'monument' ? 1 : 0.75 * Math.exp(-q / 2.2)
        ;(f.glow.material as ShaderMaterial).uniforms.uIntensity.value = ember * (0.85 + 0.15 * Math.sin(q * 23) * Math.sin(q * 7.1))
        f.glow.visible = ember > 0.02
        f.body.rotation.x = 0.08 * Math.exp(-q * 5.5) * Math.sin(q * 48)
        f.body.rotation.y = 0.05 * Math.exp(-q * 6) * Math.sin(q * 41 + 1.3)
        if (f.since > f.life) {
          const s = Math.max(0, 1 - (f.since - f.life) / 0.4)
          f.body.scale.setScalar(s)
          if (s === 0) {
            f.body.scale.setScalar(1)
            recycle(f)
          }
        }
      } else if (f.state === 'sinking') {
        // swallowed by the lava, a puff of embers on the way down
        f.group.position.y -= d * 0.5 * f.scale
        f.body.scale.setScalar(Math.max(0.001, 1 - f.since / 1.4))
        if (Math.random() < d * 8) emitBurst({ position: [f.group.position.x, LAVA_Y + 0.05, f.group.position.z], count: 1, kind: 'ember', speed: 0.6 })
        if (f.since > 1.4) {
          f.body.scale.setScalar(1)
          recycle(f)
        }
      }

      f.trail.update(cam, now)
      ;(f.trail.mesh.material as ShaderMaterial).uniforms.uFade.value = f.state === 'flying' ? 1 : Math.max(0, 1 - f.since / 0.35)
    }
  })

  return null
}
