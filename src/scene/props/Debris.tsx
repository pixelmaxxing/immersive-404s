import { useFrame } from '@react-three/fiber'
import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { Euler, Quaternion, Vector3, type Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS, type RockMaterial } from '../../materials/rockMaterial'
import { worldEvents } from '../../world/events'
import { flash, ripple } from '../../world/lavaLight'
import { LAVA_Y } from '../../world/layout'
import { GROUPS } from '../../world/physics'
import { getWorld } from '../../world/world'
import { buildChunk } from '../../world/gen/props'
import { emitBurst } from '../fx/bursts'

/**
 * Pooled physical debris. Pieces broken off the monument tumble, bounce off
 * stone, and either come to rest, fall into the abyss, or sink into the lava
 * with a splash. Fresh pieces glow hot and cool down over a few seconds.
 */
const POOL = 24
const STORAGE_Y = -400
const LIFETIME = 11
const SIZES = [0.42, 0.52, 0.62, 0.75, 0.9, 1.1]

interface Slot {
  active: boolean
  age: number
  size: number
  melting: number
  heat: number
}

type SpawnFn = (position: Vector3, velocity: Vector3, size: number) => void
const tmpQ = new Quaternion()
const tmpE = new Euler()
let spawner: SpawnFn | null = null

/** Breaks a physical piece of stone loose. Safe to call before the pool mounts (ignored). */
export function spawnDebris(position: Vector3, velocity: Vector3, size = 0.12) {
  spawner?.(position, velocity, size)
}

export function Debris() {
  const { lakeField, islandField, islandLavaY } = getWorld()
  const bodies = useRef<(RapierRigidBody | null)[]>([])
  const meshes = useRef<(Mesh | null)[]>([])
  const slots = useMemo<Slot[]>(() => Array.from({ length: POOL }, () => ({ active: false, age: 0, size: 1, melting: 0, heat: 0 })), [])
  // colliders are cooked at mount, so every slot owns a chunk of a fixed real size
  const geometries = useMemo(() => SIZES.map((sz, i) => buildChunk(sz, 900 + i, 0)), [])
  const materials = useMemo<RockMaterial[]>(
    () => Array.from({ length: POOL }, () => createRockMaterial({ ...ROCK_PRESETS.monument, crack: 0.8, crackScale: 2.5 })),
    [],
  )
  const cursor = useRef(0)

  useEffect(() => {
    spawner = (position, velocity, size) => {
      // a free slot whose chunk is closest in size, else recycle the oldest
      let i = -1
      let bestDiff = Infinity
      slots.forEach((sl, k) => {
        const diff = Math.abs(SIZES[k % SIZES.length] - size)
        if (!sl.active && diff < bestDiff) {
          bestDiff = diff
          i = k
        }
      })
      if (i < 0) {
        i = cursor.current
        cursor.current = (cursor.current + 1) % POOL
      }
      const body = bodies.current[i]
      const mesh = meshes.current[i]
      if (!body || !mesh) return
      const s = slots[i]
      s.active = true
      s.age = 0
      s.size = 1
      s.melting = 0
      s.heat = 1
      mesh.scale.setScalar(1)
      mesh.visible = true
      body.setTranslation(position, true)
      tmpQ.setFromEuler(tmpE.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28))
      body.setRotation(tmpQ, true)
      body.setLinvel(velocity, true)
      body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 }, true)
      body.setGravityScale(1, true)
      body.setLinearDamping(0.05)
      body.wakeUp()
      worldEvents.emit('debris:spawn', { id: i, position: position.toArray() })
    }
    return () => {
      spawner = null
    }
  }, [slots])

  const retire = (i: number) => {
    const s = slots[i]
    const body = bodies.current[i]
    const mesh = meshes.current[i]
    s.active = false
    if (mesh) mesh.visible = false
    if (body) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      body.setGravityScale(0, false)
      body.setTranslation({ x: i * 4, y: STORAGE_Y, z: 0 }, false)
      body.sleep()
    }
  }

  // molten channels on the island top, or anywhere on the lake (crust is still lava)
  const inLava = (p: { x: number; y: number; z: number }) => {
    if (p.y > islandLavaY - 1.5) return p.y < islandLavaY + 0.12 && islandField.sample(p.x, p.z).molten > 0.45
    return p.y < LAVA_Y + 0.1 && p.y > LAVA_Y - 1.5 && lakeField.sample(p.x, p.z).molten > 0.12
  }

  useFrame((_, dt) => {
    const d = Math.min(dt, 1 / 30)
    for (let i = 0; i < POOL; i++) {
      const s = slots[i]
      if (!s.active) continue
      const body = bodies.current[i]
      const mesh = meshes.current[i]
      if (!body || !mesh) continue
      s.age += d
      s.heat = Math.max(0, s.heat - d * 0.22)
      const p = body.translation()

      if (s.melting > 0) {
        s.melting += d
        const k = Math.min(1, s.melting / 1.4)
        mesh.scale.setScalar(s.size * (1 - k * k))
        s.heat = 1.4
        if (k >= 1) retire(i)
      } else if (inLava(p)) {
        // into the lava: splash, then sink and melt
        s.melting = 0.001
        body.setLinearDamping(6)
        body.setGravityScale(0.06, true)
        const pos = new Vector3(p.x, (p.y > islandLavaY - 2 ? islandLavaY : LAVA_Y) + 0.02, p.z)
        ripple(p.x, p.z, 0.9)
        emitBurst({ position: pos, count: 22, kind: 'droplet', speed: 3.4, spread: 0.8, size: 2.2 })
        emitBurst({ position: pos, count: 14, kind: 'ember', speed: 2.0, size: 2 })
        flash(pos.clone().setY(pos.y + 0.6), 2.4, 2.2, 0.7)
        worldEvents.emit('lava:splash', { position: pos.toArray(), strength: SIZES[i % SIZES.length] * 5 })
        worldEvents.emit('debris:melt', { id: i, position: pos.toArray() })
      } else if (p.y < LAVA_Y - 3 || s.age > LIFETIME) {
        if (s.age > LIFETIME && p.y > LAVA_Y - 3) {
          // shrink away gracefully instead of popping
          const k = Math.min(1, (s.age - LIFETIME) / 0.8)
          mesh.scale.setScalar(s.size * (1 - k))
          if (k < 1) continue
        }
        retire(i)
        continue
      }
      materials[i].userData.uniforms.uGlow.value = s.heat * 1.8
      // hot fragments shed embers as they tumble, so their arc reads from afar
      if (s.melting === 0 && s.heat > 0.3 && Math.random() < d * 14) {
        emitBurst({ position: [p.x, p.y, p.z], count: 1, kind: 'ember', speed: 0.4, size: 2.4 })
      }
    }
  })

  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <RigidBody
          key={i}
          ref={(b) => void (bodies.current[i] = b)}
          colliders="hull"
          position={[i * 4, STORAGE_Y, 0]}
          gravityScale={0}
          restitution={0.25}
          friction={0.85}
          density={2.6}
          ccd
          collisionGroups={GROUPS.debris}
          userData={{ kind: 'debris', id: i }}
        >
          <mesh ref={(m) => void (meshes.current[i] = m)} geometry={geometries[i % geometries.length]} material={materials[i]} visible={false} castShadow />
        </RigidBody>
      ))}
    </group>
  )
}
