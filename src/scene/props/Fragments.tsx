import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Euler, Quaternion, Vector3, type Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { emitBurst } from '../fx/bursts'
import { registerHittable } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { FRAGMENTS } from '../../world/layout'
import { getWorld } from '../../world/world'

interface FragmentState {
  home: Vector3
  offset: Vector3
  vel: Vector3
  spin: Vector3
  rot: Quaternion
  hover: number
}

const SPRING = 2.2
const DAMP = 1.5

/**
 * Detached stones drifting around the monument. They bob on their own;
 * hovering nudges them aside, a click or an arrow knocks them tumbling away
 * (an arrow rides along, stuck in the stone) — a soft spring always brings
 * them home again.
 */
export function Fragments() {
  const { fragments } = getWorld()
  const material = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, crack: 0.5, detailScale: 1.5, emitters: getWorld().emitterGroups.lake }), [])
  const meshes = useRef<(Mesh | null)[]>([])
  const states = useMemo<FragmentState[]>(
    () =>
      FRAGMENTS.map((f) => ({
        home: new Vector3(...f.position),
        offset: new Vector3(),
        vel: new Vector3(),
        spin: new Vector3(),
        rot: new Quaternion().setFromEuler(new Euler(f.seed * 0.37, f.seed * 1.13, f.seed * 0.71)),
        hover: 0,
      })),
    [],
  )
  const tmp = useMemo(() => ({ q: new Quaternion(), e: new Euler(), v: new Vector3() }), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const d = Math.min(dt, 1 / 30)
    states.forEach((s, i) => {
      const mesh = meshes.current[i]
      if (!mesh) return
      const f = FRAGMENTS[i]
      // spring home
      s.vel.addScaledVector(s.offset, -SPRING * d)
      s.vel.multiplyScalar(Math.exp(-DAMP * d))
      s.offset.addScaledVector(s.vel, d)
      s.spin.multiplyScalar(Math.exp(-0.9 * d))
      // idle bob + slow tumble
      const bob = Math.sin(t * 0.55 + f.seed) * 0.12 * (0.6 + f.size)
      mesh.position.copy(s.home).add(s.offset)
      mesh.position.y += bob
      tmp.e.set(s.spin.x * d + 0.05 * d, s.spin.y * d + 0.08 * d, s.spin.z * d)
      s.rot.multiply(tmp.q.setFromEuler(tmp.e))
      mesh.quaternion.copy(s.rot)
      s.hover = Math.max(0, s.hover - d * 2)
    })
  })

  const onMove = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const s = states[i]
    if (s.hover > 0.5) return
    s.hover = 1
    // drift away from the cursor ray
    tmp.v.copy(e.point).sub(e.ray.origin).normalize()
    s.vel.addScaledVector(tmp.v, 0.55)
    s.vel.y += 0.25
    s.spin.x += (Math.random() - 0.5) * 0.8
    s.spin.y += (Math.random() - 0.5) * 0.8
  }

  const knock = (i: number, point: Vector3, dir: Vector3, strength: number) => {
    const s = states[i]
    s.vel.addScaledVector(dir, 3.6 * strength)
    s.vel.y += 1.2
    s.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9)
    emitBurst({ position: point, count: 14, kind: 'grit', speed: 2.2 })
    emitBurst({ position: point, count: 6, kind: 'ember', speed: 1.6 })
    worldEvents.emit('fragment:knock', { index: i, position: point.toArray() })
  }
  const knockRef = useRef(knock)
  knockRef.current = knock

  useEffect(() => {
    const off = meshes.current.map((mesh, i) =>
      mesh
        ? registerHittable({ mesh, surface: 'prop', index: i, moving: true, onHit: (hit, vel) => knockRef.current(i, hit.point, vel.clone().normalize(), 1.3) })
        : null,
    )
    return () => off.forEach((f) => f?.())
  }, [])

  const onClick = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    // a drag is the bow being drawn, not a click
    if (e.delta > 6) return
    e.stopPropagation()
    knock(i, e.point, tmp.v.copy(e.point).sub(e.ray.origin).normalize(), 1)
  }

  return (
    <group>
      {FRAGMENTS.map((f, i) => (
        <mesh
          key={f.seed}
          ref={(m) => void (meshes.current[i] = m)}
          geometry={fragments[i]}
          material={material}
          position={f.position}
          castShadow
          onPointerMove={onMove(i)}
          onClick={onClick(i)}
          onPointerOver={(e) => (e.stopPropagation(), (document.body.style.cursor = 'pointer'))}
          onPointerOut={() => (document.body.style.cursor = '')}
        />
      ))}
    </group>
  )
}
