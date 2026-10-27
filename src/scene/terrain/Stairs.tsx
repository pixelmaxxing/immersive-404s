import { ConvexHullCollider, RigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { GROUPS } from '../../world/physics'
import { getWorld } from '../../world/world'
import { useHittable } from '../archery/useHittable'

/** Floating stairs climbing from the landing to the island's edge. */
export function Stairs() {
  const { stairs, emitterGroups } = getWorld()
  const material = useMemo(
    () => createRockMaterial({ ...ROCK_PRESETS.basalt, crack: 0.5, detailScale: 1.3, emitters: emitterGroups.lake }),
    [emitterGroups],
  )
  const mesh = useRef<Mesh>(null)
  useHittable(mesh, 'stone')
  return (
    <group>
      <mesh ref={mesh} geometry={stairs.geometry} material={material} castShadow receiveShadow />
      <RigidBody type="fixed" colliders={false} userData={{ kind: 'stairs' }}>
        {stairs.hulls.map((h, i) => (
          <ConvexHullCollider key={i} args={[h]} collisionGroups={GROUPS.walkable} friction={0.9} />
        ))}
      </RigidBody>
    </group>
  )
}
