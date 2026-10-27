import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Euler, Quaternion, Vector3, type Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { Rng } from '../../geometry/random'
import { worldEvents } from '../../world/events'
import { flash, ripple } from '../../world/lavaLight'
import { ISLAND, LAVA_Y } from '../../world/layout'
import { getWorld } from '../../world/world'
import { buildChunk } from '../../world/gen/props'
import { emitBurst } from '../fx/bursts'

interface Faller {
  active: boolean
  splashed: boolean
  pos: Vector3
  vel: Vector3
  spin: Vector3
  rot: Quaternion
}

/**
 * Every so often a piece of the island's crumbling underside breaks away and
 * plunges into the lava lake with a splash, trailing a few embers. Purely kinematic.
 */
export function RockFall() {
  const { island } = getWorld()
  const material = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, crack: 0.5 }), [])
  const geometries = useMemo(() => [0.45, 0.7, 0.9, 0.55].map((s, i) => buildChunk(s, 700 + i, 0.15)), [])
  // break-off points: the tips hanging beneath the island
  const sources = useMemo(
    () => island.cells.filter((c) => c.bottom < ISLAND.top - 5).map((c) => new Vector3(c.center[0], c.bottom - 0.6, c.center[1])),
    [island],
  )
  const fallers = useMemo<Faller[]>(
    () => geometries.map(() => ({ active: false, splashed: false, pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), rot: new Quaternion() })),
    [geometries],
  )
  const meshes = useRef<(Mesh | null)[]>([])
  const next = useRef(4)
  const rng = useMemo(() => new Rng(5), [])
  const e = useMemo(() => new Euler(), [])
  const q = useMemo(() => new Quaternion(), [])

  useFrame((_, dt) => {
    const d = Math.min(dt, 1 / 30)
    next.current -= d
    if (next.current <= 0) {
      next.current = rng.range(6, 12)
      const f = fallers.find((x) => !x.active)
      if (f && sources.length) {
        f.active = true
        f.splashed = false
        f.pos.copy(rng.pick(sources))
        f.vel.set(rng.range(-0.3, 0.3), -0.2, rng.range(-0.3, 0.3))
        f.spin.set(rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2))
        emitBurst({ position: f.pos, count: 8, kind: 'grit', speed: 0.5 })
        worldEvents.emit('ambient:rockfall', { position: f.pos.toArray() })
      }
    }
    fallers.forEach((f, i) => {
      const m = meshes.current[i]
      if (!m) return
      m.visible = f.active
      if (!f.active) return
      f.vel.y -= 9.0 * d
      f.pos.addScaledVector(f.vel, d)
      e.set(f.spin.x * d, f.spin.y * d, f.spin.z * d)
      f.rot.multiply(q.setFromEuler(e))
      m.position.copy(f.pos)
      m.quaternion.copy(f.rot)
      if (!f.splashed && Math.random() < d * 6) emitBurst({ position: f.pos, count: 1, kind: 'ember', speed: 0.3, size: 2 })
      if (!f.splashed && f.pos.y < LAVA_Y) {
        // it hits the lake: molten splash, ripple, a flash of light
        f.splashed = true
        f.vel.multiplyScalar(0.15)
        const p = f.pos.clone().setY(LAVA_Y + 0.05)
        ripple(p.x, p.z, 1.4)
        emitBurst({ position: p, count: 26, kind: 'droplet', speed: 4.2, spread: 0.7, size: 2.4 })
        emitBurst({ position: p, count: 12, kind: 'ember', speed: 2.4, size: 2 })
        flash(p.clone().setY(LAVA_Y + 1), 3, 3, 0.9)
        worldEvents.emit('lava:splash', { position: p.toArray(), strength: 2 })
      }
      if (f.pos.y < LAVA_Y - 2.5) f.active = false
    })
  })

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)} geometry={g} material={material} visible={false} />
      ))}
    </group>
  )
}
