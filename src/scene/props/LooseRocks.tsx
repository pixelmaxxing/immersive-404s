import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3, type Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { registerHittable } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { flash, ripple } from '../../world/lavaLight'
import { LAVA_Y, LOOSE_ROCKS } from '../../world/layout'
import { GROUPS } from '../../world/physics'
import { getWorld } from '../../world/world'
import { buildChunk } from '../../world/gen/props'
import { emitBurst } from '../fx/bursts'

interface RockState {
  lost: boolean
  timer: number
  melting: number
  appear: number
}

/**
 * Loose rocks lying around on walkable ground. Click or shoot them to knock
 * them away; if they fall into the void or the lava they come back a few
 * seconds later.
 */
export function LooseRocks() {
  const { lakeField: flow } = getWorld()
  const material = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, crack: 0.4, emitters: getWorld().emitterGroups.lake }), [])
  const geometries = useMemo(() => LOOSE_ROCKS.map((r) => buildChunk(r.size, r.seed, 0.06)), [])
  const bodies = useRef<(RapierRigidBody | null)[]>([])
  const meshes = useRef<(Mesh | null)[]>([])
  const states = useMemo<RockState[]>(() => LOOSE_ROCKS.map(() => ({ lost: false, timer: 0, melting: 0, appear: 1 })), [])

  const respawn = (i: number) => {
    const body = bodies.current[i]
    const r = LOOSE_ROCKS[i]
    if (!body) return
    body.setTranslation({ x: r.position[0], y: r.position[1] + 0.6, z: r.position[2] }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    body.setGravityScale(1, true)
    body.setLinearDamping(0.1)
    body.wakeUp()
    const s = states[i]
    s.lost = false
    s.melting = 0
    s.appear = 0
    emitBurst({ position: r.position, count: 10, kind: 'grit', speed: 0.6 })
    worldEvents.emit('rock:respawn', { index: i, position: r.position })
  }

  useFrame((_, dt) => {
    const d = Math.min(dt, 1 / 30)
    states.forEach((s, i) => {
      const body = bodies.current[i]
      const mesh = meshes.current[i]
      if (!body || !mesh) return
      if (s.lost) {
        s.timer -= d
        if (s.timer <= 0) respawn(i)
        return
      }
      s.appear = Math.min(1, s.appear + d * 2.5)
      const p = body.translation()
      if (s.melting > 0) {
        s.melting += d
        mesh.scale.setScalar(Math.max(0.001, 1 - s.melting / 1.3))
        if (s.melting > 1.3) lose(i, p)
        return
      }
      mesh.scale.setScalar(s.appear * (2 - s.appear))
      if (p.y < LAVA_Y + 0.06 && p.y > LAVA_Y - 1 && flow.sample(p.x, p.z).molten > 0.45) {
        s.melting = 0.001
        body.setLinearDamping(6)
        body.setGravityScale(0.05, true)
        ripple(p.x, p.z, 1.1)
        emitBurst({ position: [p.x, LAVA_Y, p.z], count: 22, kind: 'droplet', speed: 2.4 })
        flash(new Vector3(p.x, LAVA_Y + 0.4, p.z), 2.4, 1.5, 0.7)
        worldEvents.emit('lava:splash', { position: [p.x, LAVA_Y, p.z], strength: 1 })
      } else if (p.y < LAVA_Y - 3) {
        lose(i, p)
      }
    })
  })

  const lose = (i: number, p: { x: number; y: number; z: number }) => {
    const s = states[i]
    const body = bodies.current[i]
    s.lost = true
    s.timer = 3.5
    if (meshes.current[i]) meshes.current[i]!.scale.setScalar(0.001)
    body?.setGravityScale(0, false)
    body?.setLinvel({ x: 0, y: 0, z: 0 }, false)
    body?.setTranslation({ x: -50 - i * 3, y: -300, z: 0 }, false)
    worldEvents.emit('rock:lost', { index: i, position: [p.x, p.y, p.z] })
  }

  const knock = (i: number, point: Vector3, direction: Vector3, strength: number) => {
    const body = bodies.current[i]
    if (!body || states[i].lost) return
    const dir = direction.clone().setY(0).normalize()
    const m = body.mass()
    body.applyImpulse({ x: dir.x * 3.2 * m * strength, y: 2.6 * m, z: dir.z * 3.2 * m * strength }, true)
    body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.4 * m, y: (Math.random() - 0.5) * 0.4 * m, z: (Math.random() - 0.5) * 0.4 * m }, true)
    emitBurst({ position: point, count: 12, kind: 'grit', speed: 1.6 })
    emitBurst({ position: point, count: 4, kind: 'ember', speed: 1.2 })
    worldEvents.emit('rock:knock', { index: i, position: point.toArray() })
  }
  const knockRef = useRef(knock)
  knockRef.current = knock

  useEffect(() => {
    const off = meshes.current.map((mesh, i) =>
      mesh ? registerHittable({ mesh, surface: 'prop', index: i, moving: true, onHit: (hit, vel) => knockRef.current(i, hit.point, vel, 1.6) }) : null,
    )
    return () => off.forEach((f) => f?.())
  }, [])

  const onClick = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    // a drag is the bow being drawn, not a click
    if (e.delta > 6) return
    e.stopPropagation()
    knock(i, e.point, e.ray.direction, 1)
  }

  return (
    <group>
      {LOOSE_ROCKS.map((r, i) => (
        <RigidBody
          key={r.seed}
          ref={(b) => void (bodies.current[i] = b)}
          colliders="hull"
          position={r.position}
          restitution={0.2}
          friction={0.9}
          density={2.4}
          ccd
          collisionGroups={GROUPS.props}
          userData={{ kind: 'loose-rock', index: i }}
        >
          <mesh
            ref={(m) => void (meshes.current[i] = m)}
            geometry={geometries[i]}
            material={material}
            castShadow
            receiveShadow
            onClick={onClick(i)}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}
          />
        </RigidBody>
      ))}
    </group>
  )
}
