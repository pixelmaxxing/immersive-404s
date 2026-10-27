import { useFrame, useThree } from '@react-three/fiber'
import { ConvexHullCollider, RigidBody, useAfterPhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import {
  DoubleSide,
  Euler,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
} from 'three'
import { createCoreMaterial } from '../../materials/lavaMaterial'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { shared } from '../../materials/shared'
import { bow, game, registerHittable } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { fracture, scatterSeeds, solidMass, type Solid } from '../../world/gen/fracture'
import { pointer, shake } from '../../world/interaction'
import { flash, ripple } from '../../world/lavaLight'
import { zeroHole } from '../../world/gen/digits'
import { DIGIT_HEIGHT, DIGITS } from '../../world/layout'
import { GROUPS, PHYSICS_STEP } from '../../world/physics'
import { getWorld } from '../../world/world'
import { emitBurst } from '../fx/bursts'
import { spawnDebris } from '../props/Debris'
import { digitBlocks, INTERIOR, INTERIOR_HOT, Ruin } from './ruin'

interface DigitState {
  prox: number
  glow: number
  /** rocking about the base: pitch / roll and their velocities */
  rock: Vector3
  rockVel: Vector3
  jitter: number
  blocks: { off: Vector3; vel: Vector3 }[]
  emitEmber: number
  emitGrit: number
  cooldown: number
  /** it has come down: its stones are loose in the world (since this world time) */
  fallen: boolean
  fallenAt: number
}

/** How the digit came down. */
type Collapse =
  /** an arrow broke the block it struck (world point, surface normal, flight direction) */
  | { kind: 'blow'; point: Vector3; normal: Vector3; dir: Vector3; face?: number }
  /** an arrow threaded the 0: the ring bursts outward from its heart */
  | { kind: 'burst'; dir: Vector3 }
  /** the shock of its neighbour falling: the joints give and it crumbles, away from `from` */
  | { kind: 'crumble'; from: Vector3 }

/** World seconds between one digit falling and the next one giving way. */
const CASCADE = 0.32

const rand3 = (k: number) => new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * k)

/**
 * The giant stone 404, and the target of the bow.
 *  hover  — the nearest digit trembles, grit shakes loose, embers escape its
 *           cracks, cracks and nearby lava glow hotter (as does a digit the
 *           drawn arrow is locked on to)
 *  arrow  — the block it strikes shatters around it; the masonry comes apart
 *           and falls as real rigid bodies (see ruin.ts), and the shock runs
 *           on through the other digits, which ignite and crumble in turn
 */
export function Monument() {
  const { digits, emitterGroups } = getWorld()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const { world, rapier } = useRapier()
  const groups = useRef<(Group | null)[]>([])
  const meshes = useRef<(Mesh | null)[]>([])
  const fixed = useRef<(RapierRigidBody | null)[]>([])
  const hole = useRef<Mesh>(null)
  // an unseen pane across the hole of the 0: threading it is the best shot there is
  const holePane = useMemo(
    () => ({
      geometry: new ShapeGeometry(new Shape(zeroHole().map(([x, y]) => new Vector2(x, y)))),
      material: new MeshBasicMaterial({ side: DoubleSide, visible: false }),
    }),
    [],
  )
  const materials = useMemo(
    () =>
      DIGITS.map((d, i) =>
        createRockMaterial({
          ...ROCK_PRESETS.monument,
          blocks: digits[i].blocks.length,
          detailScale: d.scale,
          emitters: emitterGroups.island,
          // the hero keeps its true, angular fractures at any distance
          crackLod: 200,
        }),
      ),
    [digits, emitterGroups],
  )
  // the same stone for the shards of a block the arrow broke, glowing on its own (same shader program)
  const molten = useMemo(
    () =>
      DIGITS.map((d, i) =>
        createRockMaterial({ ...ROCK_PRESETS.monument, blocks: digits[i].blocks.length, detailScale: d.scale, emitters: emitterGroups.island, crackLod: 200 }),
      ),
    [digits, emitterGroups],
  )
  const cores = useMemo(() => DIGITS.map(() => createCoreMaterial()), [])
  const states = useMemo<DigitState[]>(
    () =>
      DIGITS.map((_, i) => ({
        prox: 0,
        glow: 0,
        rock: new Vector3(),
        rockVel: new Vector3(),
        jitter: 0,
        blocks: digits[i].blocks.map(() => ({ off: new Vector3(), vel: new Vector3() })),
        emitEmber: 0,
        emitGrit: 0,
        cooldown: 0,
        fallen: false,
        fallenAt: 0,
      })),
    [digits],
  )
  const tmp = useMemo(() => ({ c: new Vector3(), top: new Vector3(), p: new Vector3() }), [])
  const scaledHulls = useMemo(() => DIGITS.map((d, i) => digits[i].hulls.map((h) => h.map((v) => v * d.scale))), [digits])
  const colliderRotations = useMemo(
    () =>
      DIGITS.map((d) => {
        const q = new Quaternion().setFromEuler(new Euler(d.rotation[1], d.rotation[0], d.rotation[2], 'YXZ'))
        const e = new Euler().setFromQuaternion(q, 'XYZ')
        return [e.x, e.y, e.z] as [number, number, number]
      }),
    [],
  )

  // the stones that break loose, and a mirror of the physics clock so they're drawn between steps
  const ruin = useMemo(() => new Ruin(world, rapier), [world, rapier])
  useEffect(() => () => ruin.dispose(), [ruin])
  const clock = useRef({ acc: 0, steps: 0 })
  useAfterPhysicsStep(() => {
    clock.current.steps++
    ruin.afterStep()
  })

  useFrame((state, dt) => {
    const d = Math.min(dt, 1 / 30)
    const t = state.clock.elapsedTime
    const aspect = size.width / Math.max(1, size.height)

    // same bookkeeping as the physics stepper's accumulator
    const pc = clock.current
    pc.acc += MathUtils.clamp(dt, 0, 0.5) - pc.steps * PHYSICS_STEP
    pc.steps = 0
    ruin.update(d, MathUtils.clamp(pc.acc / PHYSICS_STEP, 0, 1))

    // --- pointer proximity (screen space), nearest digit only ---
    let best = -1
    let bestProx = 0
    DIGITS.forEach((def, i) => {
      if (states[i].fallen) return
      const h = DIGIT_HEIGHT * def.scale
      tmp.c.set(def.position[0], def.position[1] + h * 0.5, def.position[2]).project(camera)
      tmp.top.set(def.position[0], def.position[1] + h, def.position[2]).project(camera)
      const ry = Math.max(0.01, Math.abs(tmp.top.y - tmp.c.y))
      const rx = ry * 0.72
      const dx = ((tmp.c.x - state.pointer.x) * aspect) / (rx * aspect)
      const dy = (tmp.c.y - state.pointer.y) / ry
      const dist = Math.hypot(dx * 1.0, dy)
      const prox = pointer.active && !game.won ? 1 - MathUtils.smoothstep(dist, 0.75, 1.9) : 0
      if (prox > bestProx) {
        bestProx = prox
        best = i
      }
    })
    pointer.monumentProximity = bestProx

    // the win: a wave of heat runs out from the struck digit, and each one it reaches gives way
    const since = game.won ? t - game.wonAt : -1
    const ignite = (i: number) => (since < 0 ? 0 : MathUtils.clamp((since - Math.abs(i - game.digit) * 0.12) / 0.25, 0, 1))
    if (since >= 0) {
      const from = new Vector3(...DIGITS[game.digit].position)
      DIGITS.forEach((_, j) => {
        if (!states[j].fallen && since >= CASCADE * Math.abs(j - game.digit)) collapseRef.current(j, { kind: 'crumble', from })
      })
    }

    states.forEach((s, i) => {
      const g = groups.current[i]
      const def = DIGITS[i]
      if (!g) return
      const mat = materials[i]
      const ig = ignite(i)
      // cracks run white-hot just before it goes; the loose stones cool as they fall
      const heat = s.fallen ? 0.1 + 0.6 * Math.exp(-(t - s.fallenAt) / 0.6) : ig * ig * 1.6
      const glow = s.prox * 0.4 + s.glow + heat
      mat.userData.uniforms.uGlow.value = glow
      // red-hot ejecta cool slowly, so their arcs stay legible all the way down
      molten[i].userData.uniforms.uGlow.value = s.fallen ? 0.5 + 2.2 * Math.exp(-(t - s.fallenAt) / 1.4) : 0
      ;(cores[i] as ShaderMaterial).uniforms.uGlow.value = glow * 1.4
      s.glow *= Math.exp(-d * 1.6)
      if (s.fallen) return

      const target = Math.max(i === best ? bestProx : 0, bow.aiming && bow.lock === i ? 0.75 : 0)
      const before = s.prox
      s.prox += (target - s.prox) * (1 - Math.exp(-d * 4))
      if (Math.abs(s.prox - before) > 0.002 && (Math.round(s.prox * 10) !== Math.round(before * 10))) {
        worldEvents.emit('digit:proximity', { digit: i, amount: s.prox })
      }

      // rocking spring about the base
      s.rockVel.addScaledVector(s.rock, -70 * d)
      s.rockVel.multiplyScalar(Math.exp(-5.5 * d))
      s.rock.addScaledVector(s.rockVel, d)
      // masonry blocks settle back into place
      const offs = mat.userData.uniforms.uBlockOffset.value as Vector3[]
      s.blocks.forEach((b, k) => {
        b.vel.addScaledVector(b.off, -110 * d)
        b.vel.multiplyScalar(Math.exp(-9 * d))
        b.off.addScaledVector(b.vel, d)
        offs[k].copy(b.off)
      })
      s.jitter *= Math.exp(-d * 6)
      s.cooldown = Math.max(0, s.cooldown - d)

      const tremble = s.prox * s.prox * 0.006 + s.jitter + ig * 0.014
      g.position.set(
        def.position[0] + Math.sin(t * 47.0 + i) * tremble,
        def.position[1] + Math.sin(t * 61.0 + i * 2.0) * tremble * 0.4,
        def.position[2] + Math.sin(t * 53.0 + i * 3.0) * tremble,
      )
      g.rotation.set(def.rotation[1] + s.rock.x, def.rotation[0], def.rotation[2] + s.rock.z, 'YXZ')

      // particles shaken loose while hovering, pouring out once it ignites
      const shed = Math.max(s.prox, ig * 2.5)
      if (shed > 0.15) {
        s.emitGrit += d * Math.min(1, s.prox) * s.prox * 7
        s.emitEmber += d * shed * 4
        const model = digits[i]
        while (s.emitGrit >= 1) {
          s.emitGrit -= 1
          const sp = model.surfacePoints[Math.floor(Math.random() * model.surfacePoints.length)]
          tmp.p.copy(sp).setY(Math.min(sp.y + 0.6, DIGIT_HEIGHT - 0.05))
          g.localToWorld(tmp.p)
          emitBurst({ position: tmp.p, count: 1, kind: 'grit', speed: 0.4 * def.scale, spread: 0.6, size: def.scale })
        }
        while (s.emitEmber >= 1) {
          s.emitEmber -= 1
          const sp = model.surfacePoints[Math.floor(Math.random() * model.surfacePoints.length)]
          g.localToWorld(tmp.p.copy(sp))
          emitBurst({ position: tmp.p, count: 2, kind: 'ember', speed: 0.6 * def.scale, spread: 0.5, size: def.scale })
        }
      }
    })

    // lava near the hovered digit runs hotter
    const hs = shared.uHotSpot.value
    if (best >= 0) {
      const def = DIGITS[best]
      hs.x += (def.position[0] - hs.x) * 0.2
      hs.y += (def.position[2] - 1.0 - hs.y) * 0.2
      hs.z = 2.8
    }
    if (since >= 0) {
      const def = DIGITS[game.digit]
      hs.x = def.position[0]
      hs.y = def.position[2] - 1.0
      hs.z = 2.8 + ignite(game.digit) * 9
    }
    hs.w += (bestProx * 0.55 + Math.max(...states.map((s) => s.glow)) * 0.6 + (since >= 0 ? 1.4 : 0) - hs.w) * (1 - Math.exp(-d * 5))
  })

  /** A heavy blow at a point on digit i (an arrow strike); `power` scales the fallout. */
  const strikeAt = (i: number, point: Vector3, normal: Vector3, power = 1) => {
    const s = states[i]
    if (s.cooldown > 0) return
    s.cooldown = 0.28
    const def = DIGITS[i]

    // the slab rocks on its base, away from the blow
    s.rockVel.x += (-normal.z * 0.22 + (Math.random() - 0.5) * 0.06) * power
    s.rockVel.z += (normal.x * 0.22 + (Math.random() - 0.5) * 0.06) * power
    s.jitter = 0.03 * power
    s.glow = Math.min(1.6, s.glow + (power > 1.8 ? 0.4 : 1.0))
    s.blocks.forEach((b) => {
      b.vel.set((Math.random() - 0.5) * 0.9, Math.random() * 0.5, (Math.random() - 0.5) * 0.9)
    })

    // debris breaks off around the impact; the strongest pieces clear the island's
    // edge and tumble all the way down into the lake
    const k = def.scale
    const n = Math.round((4 + Math.floor(Math.random() * 3)) * power)
    for (let j = 0; j < n; j++) {
      const p = point.clone().add(new Vector3((Math.random() - 0.5) * 0.5 * k, (Math.random() - 0.3) * 0.5 * k, (Math.random() - 0.5) * 0.3 * k))
      const v = normal
        .clone()
        .multiplyScalar(3 + Math.random() * 4.5)
        .add(new Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 2))
      spawnDebris(p.addScaledVector(normal, 0.12 * k), v, 0.25 + Math.random() * 0.4)
    }
    emitBurst({ position: point, count: Math.round(40 * power), kind: 'ember', speed: 2.4 * k, direction: normal, spread: 1.1, size: k })
    emitBurst({ position: point, count: Math.round(14 * power), kind: 'spark', speed: 4.5 * k, direction: normal, spread: 0.9, size: k })
    emitBurst({ position: point, count: Math.round(30 * power), kind: 'grit', speed: 2.6 * k, direction: normal, spread: 1.2, size: k })
    flash(point.clone().addScaledVector(normal, 0.4 * k), 3.6 * power, 1.8 * k, 0.9)
    // the lava at the monument's foot shudders
    ripple(def.position[0] + (Math.random() - 0.5) * k, def.position[2] - 1.4 * k, 1.0)
    shake(0.035 * power)
    worldEvents.emit('digit:strike', { digit: i, point: point.toArray(), strength: power })
  }
  const strikeRef = useRef(strikeAt)
  strikeRef.current = strikeAt

  /** Digit i comes down: its blocks become loose stones, broken where the blow landed. */
  const collapse = (i: number, how: Collapse) => {
    const s = states[i]
    const g = groups.current[i]
    const mesh = meshes.current[i]
    if (s.fallen || !g || !mesh) return
    s.fallen = true
    s.fallenAt = shared.uTime.value
    g.updateWorldMatrix(true, true)
    const matrix = g.matrixWorld.clone()
    const quat = new Quaternion()
    const scl = new Vector3()
    matrix.decompose(new Vector3(), quat, scl)
    const scale = scl.x
    const toLocal = new Matrix4().copy(matrix).invert()
    const up = new Vector3().setFromMatrixColumn(matrix, 1).normalize()
    const front = new Vector3().setFromMatrixColumn(matrix, 2).normalize()
    const heart = new Vector3(0, DIGIT_HEIGHT / 2, 0).applyMatrix4(matrix)

    // the stones carry their jostle with them; the shared material's block offsets go back to rest
    const geometry = digits[i].geometry
    const blocks = digitBlocks(geometry, s.blocks.map((b) => b.off.clone()))
    s.blocks.forEach((b) => (b.off.set(0, 0, 0), b.vel.set(0, 0, 0)))
    for (const o of materials[i].userData.uniforms.uBlockOffset.value as Vector3[]) o.set(0, 0, 0)

    // (the BVH gives the geometry a reordered index, so the struck triangle is looked up through it)
    const corner = how.kind === 'blow' && how.face !== undefined ? (geometry.index ? geometry.index.getX(how.face * 3) : how.face * 3) : -1
    const struck = corner >= 0 ? Math.round(geometry.getAttribute('aBlock').getX(corner)) : -1
    const blowLocal = how.kind === 'blow' ? how.point.clone().applyMatrix4(toLocal) : null
    const spawned: { mesh: Mesh; at: Vector3 }[] = []
    let host: Mesh | null = null
    let hostDist = Infinity

    blocks.forEach((solid, b) => {
      const whole = solidMass(solid)
      const atWorld = whole.center.clone().applyMatrix4(matrix)
      const dist = how.kind === 'blow' ? atWorld.distanceTo(how.point) : 0
      // how badly each block breaks: the struck one to pieces, its neighbours in two or three
      // (a threaded 0 bursts from within: every stone of the ring breaks, red-hot)
      const hot = b === struck || how.kind === 'burst'
      let seeds = 1
      if (b === struck) seeds = 16
      else if (how.kind === 'blow' && dist < 3.4 * (scale / 3.5)) seeds = 2 + Math.round(Math.random())
      else if (how.kind === 'burst') seeds = 2 + Math.round(Math.random())
      else if (how.kind === 'crumble' && Math.random() < 0.3) seeds = 3
      const parts =
        seeds > 1
          ? fracture(
              solid,
              scatterSeeds(solid, seeds, Math.random, b === struck && blowLocal ? { point: blowLocal, radius: 0.16, share: 0.5 } : undefined),
              { interior: hot ? INTERIOR_HOT : INTERIOR },
            )
          : []
      const list: { solid: Solid; center: Vector3; volume: number; seed?: Vector3 }[] =
        parts.length > 1 ? parts.map((pc) => ({ solid: pc, center: pc.center, volume: pc.volume, seed: pc.seed })) : [{ solid, center: whole.center, volume: whole.volume }]

      for (const part of list) {
        const at = part.center.clone().applyMatrix4(matrix)
        const v = new Vector3()
        const spin = new Vector3()
        if (how.kind === 'blow') {
          const r = at.clone().sub(how.point)
          const dd = Math.max(1e-3, r.length())
          r.divideScalar(dd)
          if (b === struck) {
            // shattered: red-hot ejecta spray back out of the face, out over the island's edge
            const near = Math.exp(-dd / 1.6)
            v.copy(how.normal).multiplyScalar(5 + 9 * near).addScaledVector(r, 3 + 6 * near).addScaledVector(how.dir, 1.5).addScaledVector(up, 2 + Math.random() * 2).add(rand3(1.5))
            spin.copy(rand3(3 + 7 * near))
          } else {
            // shoved by the blast; the digit topples forward over its broken heart
            const near = Math.exp(-dd / 4)
            v.copy(r).multiplyScalar(1.5 + 4.5 * near).addScaledVector(front, 2.5 + 3 * near).addScaledVector(up, 0.5 + near).add(rand3(0.5))
            spin.copy(rand3(0.5 + 1.5 * near))
          }
        } else if (how.kind === 'burst') {
          const r = at.clone().sub(heart).normalize()
          v.copy(r).multiplyScalar(5 + Math.random() * 3).addScaledVector(front, 2.5).addScaledVector(how.dir, 1).addScaledVector(up, 1.5).add(rand3(0.8))
          spin.copy(rand3(3))
        } else {
          // the joints give: the stones lean out and fall, away from the digit that went first
          const r = at.clone().sub(heart).normalize()
          const away = heart.clone().sub(how.from).setY(0).normalize()
          v.copy(r).multiplyScalar(1.2).addScaledVector(away, 1.4).addScaledVector(front, 2.2 + Math.random() * 1.6).addScaledVector(up, 0.6).add(rand3(0.5))
          spin.copy(rand3(1.2))
        }
        const m = ruin.spawn({
          solid: part.solid,
          center: part.center,
          volume: part.volume,
          matrix,
          quaternion: quat,
          scale,
          material: hot ? molten[i] : materials[i],
          digit: i,
          velocity: v,
          spin,
          hot,
        })
        spawned.push({ mesh: m, at })
        // the arrow stays in the stone it hit
        if (b === struck && blowLocal && part.seed) {
          const dd = part.seed.distanceTo(blowLocal)
          if (dd < hostDist) {
            hostDist = dd
            host = m
          }
        }
      }
    })

    // whatever was stuck in the digit rides on the nearest stone
    const p = new Vector3()
    for (const child of [...mesh.children] as Object3D[]) {
      if (!spawned.length) break
      child.getWorldPosition(p)
      const to = host ?? spawned.reduce((a, c) => (c.at.distanceToSquared(p) < a.at.distanceToSquared(p) ? c : a)).mesh
      to.attach(child)
    }
    mesh.visible = false
    g.visible = false
    if (DIGITS[i].char === '0' && hole.current) hole.current.visible = false
    fixed.current[i]?.setEnabled(false)

    // the molten mortar sprays out of every joint as they open
    const jp = digits[i].joints.getAttribute('position')
    for (let k = 0; k < jp.count; k += 12) {
      p.set(jp.getX(k), jp.getY(k), jp.getZ(k)).applyMatrix4(matrix)
      emitBurst({ position: p, count: 16, kind: 'ember', speed: 2.2 * scale, spread: 1.2, size: scale })
      emitBurst({ position: p, count: 6, kind: 'dust', speed: 0.8 * scale, spread: 1.4, size: scale * 0.8, radius: 0.4 * scale })
    }
    if (how.kind === 'blow') {
      // a cloud of rock flour bursts from the broken face
      emitBurst({ position: how.point, count: 34, kind: 'dust', speed: 2.4 * scale, direction: how.normal, spread: 1.3, size: 1.5 * scale, radius: 0.3 * scale })
      emitBurst({ position: how.point, count: 40, kind: 'grit', speed: 4.5 * scale, direction: how.normal, spread: 1.2, size: scale, radius: 0.2 * scale })
    } else {
      flash(heart.clone().addScaledVector(front, 2), 3.2, 2.2 * scale, 1.1)
      shake(0.02)
    }
    worldEvents.emit('monument:collapse', { digit: i, position: heart.toArray() })
  }
  const collapseRef = useRef(collapse)
  collapseRef.current = collapse

  // the digits are what the bow is for
  useEffect(() => {
    const off = meshes.current.map((mesh, i) =>
      mesh
        ? registerHittable({
            mesh,
            surface: 'monument',
            index: i,
            moving: true,
            onHit: (hit, vel) => {
              const winning = !game.won
              strikeRef.current(i, hit.point, hit.normal, winning ? 2 : 1.6)
              if (winning) collapseRef.current(i, { kind: 'blow', point: hit.point, normal: hit.normal, dir: vel.clone().normalize(), face: hit.faceIndex })
            },
          })
        : null,
    )
    const zero = DIGITS.findIndex((d) => d.char === '0')
    if (hole.current && zero >= 0) {
      off.push(
        registerHittable({
          mesh: hole.current,
          surface: 'monument',
          index: zero,
          moving: true,
          passThrough: true,
          onHit: (hit, vel) => {
            // no stone in the way: the ring itself flares and bursts apart
            const k = DIGITS[zero].scale
            const winning = !game.won
            states[zero].glow = 1.6
            emitBurst({ position: hit.point, count: 60, kind: 'spark', speed: 3.5 * k, spread: 1.4, size: k })
            emitBurst({ position: hit.point, count: 50, kind: 'ember', speed: 2 * k, spread: 1.4, size: k })
            flash(hit.point.clone().setZ(hit.point.z + 1), 4, 2.5 * k, 1.2)
            shake(0.05)
            if (winning) collapseRef.current(zero, { kind: 'burst', dir: vel.clone().normalize() })
          },
        }),
      )
    }
    return () => off.forEach((f) => f?.())
  }, [states])

  return (
    <group>
      {DIGITS.map((d, i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)} position={d.position} rotation={[d.rotation[1], d.rotation[0], d.rotation[2], 'YXZ']} scale={d.scale}>
          <mesh ref={(m) => void (meshes.current[i] = m)} geometry={digits[i].geometry} material={materials[i]} castShadow receiveShadow />
          {d.char === '0' && <mesh ref={hole} geometry={holePane.geometry} material={holePane.material} />}
          <mesh geometry={digits[i].joints} material={cores[i]} />
        </group>
      ))}
      <primitive object={ruin.root} />
      {/* static colliders (one convex hull per block) so debris bounces off the monument */}
      {DIGITS.map((d, i) => (
        <RigidBody
          key={i}
          ref={(b) => void (fixed.current[i] = b)}
          type="fixed"
          colliders={false}
          position={d.position}
          rotation={colliderRotations[i]}
          userData={{ kind: 'monument', digit: i }}
        >
          {scaledHulls[i].map((h, k) => (
            <ConvexHullCollider key={k} args={[h]} collisionGroups={GROUPS.solid} />
          ))}
        </RigidBody>
      ))}
    </group>
  )
}
