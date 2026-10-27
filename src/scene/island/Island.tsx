import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { ISLAND } from '../../world/layout'
import { GROUPS } from '../../world/physics'
import { topsTrimesh } from '../../world/gen/stoneField'
import { getWorld } from '../../world/world'
import { useHittable } from '../archery/useHittable'

/** The colossal floating island carrying the monument; its underside glows over the lake. */
export function Island() {
  const { island, islandField, islandLavaY, emitterGroups } = getWorld()
  const material = useMemo(
    () =>
      createRockMaterial({
        ...ROCK_PRESETS.basalt,
        field: islandField,
        seamY: islandLavaY,
        seamWidth: 0.26,
        detailScale: ISLAND.detail,
        bump: 0.03,
        emitters: emitterGroups.island,
      }),
    [islandField, islandLavaY, emitterGroups],
  )
  const tops = useMemo(() => topsTrimesh(island.cells), [island])
  const mesh = useRef<Mesh>(null)
  useHittable(mesh, 'stone')

  return (
    <group>
      <mesh ref={mesh} geometry={island.geometry} material={material} castShadow receiveShadow />
      <RigidBody type="fixed" colliders={false} userData={{ kind: 'island' }}>
        <TrimeshCollider args={[tops.vertices, tops.indices]} collisionGroups={GROUPS.walkable} friction={0.9} />
      </RigidBody>
    </group>
  )
}
