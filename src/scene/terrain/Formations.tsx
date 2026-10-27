import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { LAVA_Y } from '../../world/layout'
import { GROUPS } from '../../world/physics'
import { topsTrimesh } from '../../world/gen/stoneField'
import { getWorld } from '../../world/world'
import { useHittable } from '../archery/useHittable'

/** Basalt formations rising out of the lake, some crowned with ruins. One draw call each kind. */
export function Formations() {
  const { formations, lakeField, emitterGroups } = getWorld()
  const { rock, ruin } = useMemo(
    () => ({
      rock: createRockMaterial({ ...ROCK_PRESETS.basalt, field: lakeField, seamY: LAVA_Y, seamWidth: 0.2, detailScale: 1.4, emitters: emitterGroups.lake }),
      ruin: createRockMaterial({ ...ROCK_PRESETS.ruin, detailScale: 1.4, emitters: emitterGroups.lake }),
    }),
    [lakeField, emitterGroups],
  )
  const { stones, ruins, tops } = useMemo(() => {
    const ruinGeos = formations.flatMap((f) => (f.ruin ? [f.ruin] : []))
    return {
      stones: mergeGeometries(formations.map((f) => f.field.geometry)),
      ruins: ruinGeos.length ? mergeGeometries(ruinGeos) : null,
      tops: topsTrimesh(formations.flatMap((f) => f.field.cells)),
    }
  }, [formations])
  const stoneMesh = useRef<Mesh>(null)
  const ruinMesh = useRef<Mesh>(null)
  useHittable(stoneMesh, 'stone')
  useHittable(ruinMesh, 'stone')

  return (
    <group>
      <mesh ref={stoneMesh} geometry={stones} material={rock} castShadow receiveShadow />
      {ruins && <mesh ref={ruinMesh} geometry={ruins} material={ruin} castShadow receiveShadow />}
      <RigidBody type="fixed" colliders={false} userData={{ kind: 'formation' }}>
        <TrimeshCollider args={[tops.vertices, tops.indices]} collisionGroups={GROUPS.solid} />
      </RigidBody>
    </group>
  )
}
