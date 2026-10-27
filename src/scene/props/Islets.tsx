import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { ISLETS } from '../../world/layout'
import { registerHittable } from '../../world/archery'
import { getWorld } from '../../world/world'

/** Smaller floating islands drifting at different depths around the colossus. */
export function Islets() {
  const { islets } = getWorld()
  const rock = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, detailScale: 2 }), [])
  const refs = useRef<(Group | null)[]>([])
  const meshes = useRef<(Mesh | null)[]>([])
  useEffect(() => {
    const off = meshes.current.map((mesh) => (mesh ? registerHittable({ mesh, surface: 'stone', moving: true }) : null))
    return () => off.forEach((f) => f?.())
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    ISLETS.forEach((d, i) => {
      const g = refs.current[i]
      if (!g) return
      const ph = d.seed * 1.7
      g.position.y = d.position[1] + Math.sin(t * 0.3 + ph) * d.bob
      g.rotation.z = Math.sin(t * 0.19 + ph) * 0.012
      g.rotation.x = Math.sin(t * 0.15 + ph * 0.5) * 0.01
    })
  })

  return (
    <group>
      {ISLETS.map((d, i) => (
        <group key={d.id} ref={(g) => void (refs.current[i] = g)} position={d.position}>
          <mesh ref={(m) => void (meshes.current[i] = m)} geometry={islets[i].field.geometry} material={rock} />
        </group>
      ))}
    </group>
  )
}
