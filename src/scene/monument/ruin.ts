import type { RapierCollider, RapierContext, RapierRigidBody } from '@react-three/rapier'
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three'
import { worldEvents } from '../../world/events'
import { fracture, scatterSeeds, type Solid } from '../../world/gen/fracture'
import { shake } from '../../world/interaction'
import { flash, ripple } from '../../world/lavaLight'
import { LAVA_Y } from '../../world/layout'
import { groundAt } from '../../world/navigation'
import { GROUPS, PHYSICS_GRAVITY, PHYSICS_STEP } from '../../world/physics'
import { getWorld } from '../../world/world'
import { emitBurst } from '../fx/bursts'

/**
 * The monument's ruin: free rigid bodies for every stone that breaks loose.
 *
 * A shard keeps its geometry in the digit's own space, so the stone's
 * procedural texture doesn't swim when it comes loose. Bodies are stepped by
 * the shared physics world and drawn interpolated between steps (smooth even
 * in slow motion). Anything that lands hard enough breaks again; whatever
 * falls into the lava splashes, sinks and melts.
 */

/** values on freshly broken faces: unweathered stone, still hot inside */
export const INTERIOR = { aEdge: 0.15, aHeat: 0.55, aAO: 1 }
/** the block the arrow broke: molten at heart */
export const INTERIOR_HOT = { ...INTERIOR, aHeat: 1.1 }

const SHRINK = 0.94
/** heavier than life: at this size true gravity reads as floaty from where you stand */
const GRAVITY_SCALE = 1.8
const BREAK_SPEED = 6.5
const BREAK_BUDGET = 12
const MAX_SHARDS = 120
const SINK_TIME = 1.6

interface Shard {
  body: RapierRigidBody
  collider: RapierCollider
  holder: Group
  mesh: Mesh
  /** geometry in the digit's local space */
  solid: Solid
  /** local centre of mass */
  center: Vector3
  scale: number
  material: Material
  /** world volume (m³) and bounding radius (m) */
  volume: number
  radius: number
  digit: number
  generation: number
  /** red-hot ejecta: they trail embers, so their arcs read from afar */
  hot: boolean
  pos0: Vector3
  pos1: Vector3
  rot0: Quaternion
  rot1: Quaternion
  vel: Vector3
  age: number
  dustCooldown: number
  /** seconds since it hit the lava */
  sinking: number
  dead: boolean
}

export interface SpawnOptions {
  solid: Solid
  center: Vector3
  /** local volume (scaled by scale³ for the world) */
  volume: number
  /** digit local → world, scale included */
  matrix: Matrix4
  quaternion: Quaternion
  scale: number
  material: Material
  digit: number
  velocity: Vector3
  spin: Vector3
  generation?: number
  hot?: boolean
}

const _v = new Vector3()
const _w = new Vector3()
const _m = new Matrix4()
const _one = new Vector3(1, 1, 1)

export class Ruin {
  readonly root = new Group()
  private shards: Shard[] = []
  private impacts: { shard: Shard; strength: number; dir: Vector3 }[] = []
  private breaks = 0

  constructor(
    private readonly world: RapierContext['world'],
    private readonly rapier: RapierContext['rapier'],
  ) {
    this.root.name = 'ruin'
  }

  get count() {
    return this.shards.length
  }

  /** Sets a stone free. Returns its render mesh (for things that ride along on it). */
  spawn(o: SpawnOptions): Mesh {
    const s = o.scale
    const pos = o.center.clone().applyMatrix4(o.matrix)
    const q = o.quaternion
    const inv = q.clone().invert()

    // collider: the hull of the (slightly shrunk) stone, kept clear of the ground it stands on, so
    // nothing starts out interpenetrating
    const ground = groundAt(pos.x, pos.z, pos.y + 1).y
    const seen = new Set<string>()
    const pts: number[] = []
    let radius = 0
    const p = o.solid.position
    for (let i = 0; i < p.length; i += 3) {
      const key = `${p[i].toFixed(4)},${p[i + 1].toFixed(4)},${p[i + 2].toFixed(4)}`
      if (seen.has(key)) continue
      seen.add(key)
      _v.set(p[i] - o.center.x, p[i + 1] - o.center.y, p[i + 2] - o.center.z).multiplyScalar(s)
      radius = Math.max(radius, _v.length())
      _v.multiplyScalar(SHRINK)
      _w.copy(_v).applyQuaternion(q).add(pos)
      if (_w.y < ground + 0.03) {
        _w.y = ground + 0.03
        _v.copy(_w).sub(pos).applyQuaternion(inv)
      }
      pts.push(_v.x, _v.y, _v.z)
    }

    const { rapier, world } = this
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(o.velocity.x, o.velocity.y, o.velocity.z)
        .setAngvel({ x: o.spin.x, y: o.spin.y, z: o.spin.z })
        .setGravityScale(GRAVITY_SCALE)
        .setLinearDamping(0.02)
        .setAngularDamping(0.25)
        .setCcdEnabled(radius < 1.8),
    )
    const shape = rapier.ColliderDesc.convexHull(new Float32Array(pts)) ?? rapier.ColliderDesc.ball(Math.max(0.05, radius * 0.6))
    const collider = world.createCollider(shape.setDensity(2.4).setFriction(0.75).setRestitution(0.08).setCollisionGroups(GROUPS.debris), body)

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(o.solid.position, 3))
    g.setAttribute('normal', new BufferAttribute(o.solid.normal, 3))
    for (const [name, arr] of Object.entries(o.solid.scalars)) g.setAttribute(name, new BufferAttribute(arr, 1))
    g.computeBoundingSphere()
    const mesh = new Mesh(g, o.material)
    mesh.position.copy(o.center).multiplyScalar(-s)
    mesh.scale.setScalar(s)
    mesh.castShadow = radius > 0.7
    mesh.receiveShadow = true
    const holder = new Group()
    holder.add(mesh)
    holder.position.copy(pos)
    holder.quaternion.copy(q)
    this.root.add(holder)

    this.shards.push({
      body,
      collider,
      holder,
      mesh,
      solid: o.solid,
      center: o.center.clone(),
      scale: s,
      material: o.material,
      volume: o.volume * s * s * s,
      radius,
      digit: o.digit,
      generation: o.generation ?? 0,
      hot: o.hot ?? false,
      pos0: pos.clone(),
      pos1: pos.clone(),
      rot0: q.clone(),
      rot1: q.clone(),
      vel: o.velocity.clone(),
      age: 0,
      dustCooldown: 0,
      sinking: 0,
      dead: false,
    })
    return mesh
  }

  /** Breaks a free shard in two or more where it took a blow (world point). */
  private shatter(sh: Shard, point: Vector3) {
    // the shard's own frame: local = centre + R⁻¹(world − position) / scale
    _m.compose(sh.pos1, sh.rot1, _one).invert()
    const local = point.clone().applyMatrix4(_m).divideScalar(sh.scale).add(sh.center)
    const size = sh.radius / sh.scale
    const count = Math.min(5, 2 + Math.round(Math.cbrt(sh.volume) * 0.9))
    const seeds = scatterSeeds(sh.solid, count, Math.random, { point: local, radius: size * 0.35, share: 0.5 })
    if (seeds.length < 2) return false
    const pieces = fracture(sh.solid, seeds, { interior: INTERIOR })
    if (pieces.length < 2) return false

    const v = sh.body.linvel()
    const w = sh.body.angvel()
    const matrix = new Matrix4().compose(sh.pos1, sh.rot1, new Vector3(sh.scale, sh.scale, sh.scale)).multiply(new Matrix4().makeTranslation(-sh.center.x, -sh.center.y, -sh.center.z))
    this.remove(sh)
    for (const pc of pieces) {
      const c = pc.center.clone().applyMatrix4(matrix)
      const r = c.clone().sub(sh.pos1)
      const away = c.clone().sub(point).normalize()
      const vel = new Vector3(v.x, v.y, v.z)
        .add(new Vector3(w.x, w.y, w.z).cross(r))
        .addScaledVector(away, 1.4 + Math.random() * 1.6)
      vel.y += 0.8 + Math.random() * 1.2
      this.spawn({
        solid: pc,
        center: pc.center,
        volume: pc.volume,
        matrix,
        quaternion: sh.rot1,
        scale: sh.scale,
        material: sh.material,
        digit: sh.digit,
        velocity: vel,
        spin: new Vector3(w.x, w.y, w.z).multiplyScalar(0.6).add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4)),
        generation: sh.generation + 1,
        hot: sh.hot,
      })
    }
    const k = Math.min(3, sh.radius)
    emitBurst({ position: point, count: 18, kind: 'dust', speed: 2.2 * k, spread: 1.4, size: 2.4 * k, radius: 0.5 * k })
    emitBurst({ position: point, count: 26, kind: 'grit', speed: 4 * k, spread: 1.2, size: 2.4 * k, radius: 0.3 * k })
    emitBurst({ position: point, count: 14, kind: 'ember', speed: 2.6 * k, spread: 1.1, size: 2.4 * k })
    shake(0.006 * k)
    return true
  }

  private remove(sh: Shard) {
    sh.dead = true
    this.world.removeRigidBody(sh.body)
    sh.holder.removeFromParent()
    sh.mesh.geometry.dispose()
  }

  /** Right after each physics step: poses for interpolation, and the blows each stone took. */
  afterStep() {
    for (const sh of this.shards) {
      if (sh.dead) continue
      sh.pos0.copy(sh.pos1)
      sh.rot0.copy(sh.rot1)
      const t = sh.body.translation()
      const r = sh.body.rotation()
      sh.pos1.set(t.x, t.y, t.z)
      sh.rot1.set(r.x, r.y, r.z, r.w)
      const v = sh.body.linvel()
      // whatever changed its velocity beyond gravity hit it
      _v.set(v.x - sh.vel.x, v.y - sh.vel.y + PHYSICS_GRAVITY * GRAVITY_SCALE * PHYSICS_STEP, v.z - sh.vel.z)
      sh.vel.set(v.x, v.y, v.z)
      const blow = _v.length()
      if (!sh.sinking && sh.age > 0.05 && blow > 2.5) this.impacts.push({ shard: sh, strength: blow, dir: _v.clone().divideScalar(blow) })
    }
  }

  /** Once per frame, after the physics: draw, crack, splash, melt. `alpha` is how far between steps we are. */
  update(dt: number, alpha: number) {
    const { islandField, islandLavaY } = getWorld()
    // ember trails share the particle budget: fewer per stone when many fly at once
    let flying = 0
    for (const sh of this.shards) if (sh.hot && !sh.dead && sh.age < 3.5) flying++
    const trail = 34 * Math.min(1, 14 / Math.max(1, flying))

    for (const im of this.impacts) {
      const sh = im.shard
      if (sh.dead) continue
      // the stone struck something: the contact lies against the push it got
      const point = sh.pos1.clone().addScaledVector(im.dir, -sh.radius * 0.6)
      const k = Math.min(3, sh.radius)
      if (
        im.strength > BREAK_SPEED &&
        sh.generation < 2 &&
        sh.volume > 0.5 &&
        this.breaks < BREAK_BUDGET &&
        this.shards.length < MAX_SHARDS &&
        this.shatter(sh, point)
      ) {
        this.breaks++
        continue
      }
      if (sh.dustCooldown <= 0 && im.strength > 3) {
        sh.dustCooldown = 0.4
        emitBurst({ position: point, count: Math.round(6 + 6 * k), kind: 'dust', speed: 1.2 * k, spread: 1.6, size: 2 * k, radius: 0.4 * k })
        emitBurst({ position: point, count: 10, kind: 'grit', speed: 2.4 * k, spread: 1.2, size: 2 * k, radius: 0.2 * k })
        if (sh.radius > 0.9) shake(0.0025 * k)
      }
    }
    this.impacts.length = 0

    for (const sh of this.shards) {
      if (sh.dead) continue
      sh.age += dt
      sh.dustCooldown -= dt
      sh.holder.position.lerpVectors(sh.pos0, sh.pos1, alpha)
      sh.holder.quaternion.slerpQuaternions(sh.rot0, sh.rot1, alpha)
      const p = sh.pos1

      if (sh.sinking > 0) {
        // swallowed: it settles into the melt and dissolves
        sh.sinking += dt
        const k = Math.min(1, sh.sinking / SINK_TIME)
        sh.mesh.scale.setScalar(sh.scale * (1 - k * k))
        sh.mesh.position.copy(sh.center).multiplyScalar(-sh.scale * (1 - k * k))
        if (Math.random() < dt * 10) emitBurst({ position: [p.x, p.y, p.z], count: 1, kind: 'ember', speed: 0.8, size: 2.5 })
        if (k >= 1) this.remove(sh)
        continue
      }

      if (sh.hot && sh.age < 3.5 && sh.vel.lengthSq() > 6 && Math.random() < dt * trail) {
        emitBurst({ position: sh.holder.position, count: 1, kind: Math.random() < 0.25 ? 'spark' : 'ember', speed: 0.5, size: 3.2 })
      }

      const low = p.y - sh.radius * 0.35
      const lavaY =
        p.y > islandLavaY - 2 && low < islandLavaY + 0.1 && islandField.sample(p.x, p.z).molten > 0.45 ? islandLavaY : low < LAVA_Y + 0.05 && p.y > LAVA_Y - 4 ? LAVA_Y : null
      if (lavaY !== null) {
        // into the lava: a molten splash, then it sinks out of the world
        sh.sinking = 1e-3
        sh.collider.setCollisionGroups(0)
        sh.body.setLinearDamping(4.5)
        sh.body.setAngularDamping(3)
        sh.body.setGravityScale(0.25, true)
        const k = Math.min(3, sh.radius)
        const at = new Vector3(p.x, lavaY + 0.05, p.z)
        ripple(p.x, p.z, 0.8 + k * 0.5)
        emitBurst({ position: at, count: Math.round(14 + 12 * k), kind: 'droplet', speed: 3 + 1.6 * k, spread: 0.8, size: 1.6 + k, radius: 0.3 * k })
        emitBurst({ position: at, count: Math.round(8 + 8 * k), kind: 'ember', speed: 1.8 + k, size: 1.6 + k, radius: 0.3 * k })
        flash(at.clone().setY(at.y + 0.8), 2 + k, 1.6 + 1.2 * k, 0.8)
        worldEvents.emit('lava:splash', { position: at.toArray(), strength: 1 + k * 2 })
      } else if (p.y < LAVA_Y - 6) {
        this.remove(sh)
      }
    }
    if (this.shards.some((sh) => sh.dead)) this.shards = this.shards.filter((sh) => !sh.dead)
  }

  dispose() {
    for (const sh of this.shards) {
      if (sh.dead) continue
      try {
        this.world.removeRigidBody(sh.body)
      } catch {
        // the world went first
      }
      sh.mesh.geometry.dispose()
    }
    this.shards = []
    this.root.clear()
  }
}

// ----------------------------------------------------------- collapse ----

/** Splits a digit's merged geometry back into its masonry blocks (local space). */
export function digitBlocks(geometry: BufferGeometry, offsets: Vector3[]): Solid[] {
  const names = ['aEdge', 'aSeed', 'aBlock', 'aHeat', 'aAO']
  const pos = geometry.getAttribute('position').array as Float32Array
  const nor = geometry.getAttribute('normal').array as Float32Array
  const attr = Object.fromEntries(names.map((n) => [n, geometry.getAttribute(n).array as Float32Array]))
  const count = offsets.length
  const tris: number[][] = Array.from({ length: count }, () => [])
  for (let t = 0; t < pos.length / 9; t++) tris[Math.round(attr.aBlock[t * 3])]?.push(t)
  return tris.map((list, b) => {
    const n = list.length * 3
    const position = new Float32Array(n * 3)
    const normal = new Float32Array(n * 3)
    const scalars = Object.fromEntries(names.map((name) => [name, new Float32Array(n)]))
    const off = offsets[b]
    list.forEach((t, j) => {
      for (let k = 0; k < 3; k++) {
        const src = t * 3 + k
        const dst = j * 3 + k
        position[dst * 3] = pos[src * 3] + off.x
        position[dst * 3 + 1] = pos[src * 3 + 1] + off.y
        position[dst * 3 + 2] = pos[src * 3 + 2] + off.z
        normal[dst * 3] = nor[src * 3]
        normal[dst * 3 + 1] = nor[src * 3 + 1]
        normal[dst * 3 + 2] = nor[src * 3 + 2]
        for (const name of names) scalars[name][dst] = attr[name][src]
      }
    })
    return { position, normal, scalars }
  })
}
