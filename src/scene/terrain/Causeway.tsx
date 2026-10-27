import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { LAVA_Y } from '../../world/layout'
import { GROUPS } from '../../world/physics'
import { topsTrimesh } from '../../world/gen/stoneField'
import { getWorld } from '../../world/world'
import { useHittable } from '../archery/useHittable'

/** The basalt causeway under your feet, running out across the lake. */
export function Causeway() {
  const { causeway, lakeField, emitterGroups } = getWorld()
  const material = useMemo(
    () => createRockMaterial({ ...ROCK_PRESETS.basalt, field: lakeField, seamY: LAVA_Y, seamWidth: 0.16, emitters: emitterGroups.lake }),
    [lakeField, emitterGroups],
  )
  const tops = useMemo(() => topsTrimesh(causeway.cells), [causeway])
  const mesh = useRef<Mesh>(null)
  useHittable(mesh, 'stone')

  return (
    <group>
      <mesh ref={mesh} geometry={causeway.geometry} material={material} castShadow receiveShadow />
      <RigidBody type="fixed" colliders={false} userData={{ kind: 'causeway' }}>
        <TrimeshCollider args={[tops.vertices, tops.indices]} collisionGroups={GROUPS.walkable} friction={0.9} />
      </RigidBody>
    </group>
  )
}
