import { useLayoutEffect, useMemo, useRef } from 'react'
import { Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { centroid, type V2 } from '../../geometry/polygon'
import { Rng } from '../../geometry/random'
import { LAVA_Y, LOOSE_ROCKS, VIEWER } from '../../world/layout'
import type { FieldCell } from '../../world/gen/stoneField'
import { getWorld } from '../../world/world'
import { buildChunk } from '../../world/gen/props'

/**
 * Scattered rubble on the causeway: gravel collecting along its broken edges,
 * chips and fallen stones on the walking surface. Purely decorative,
 * instanced (one draw call per shape variant).
 */
const VARIANTS = 4

function pointIn(cell: FieldCell, rng: Rng): V2 {
  const c = centroid(cell.stone)
  const v = cell.stone[rng.int(0, cell.stone.length - 1)]
  const t = rng.range(0.1, 0.75)
  return [c[0] + (v[0] - c[0]) * t, c[1] + (v[1] - c[1]) * t]
}

export function Rubble() {
  const { causeway, emitterGroups } = getWorld()
  const material = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, crack: 0.3, bump: 0.015, emitters: emitterGroups.lake }), [emitterGroups])
  const geometries = useMemo(() => Array.from({ length: VARIANTS }, (_, i) => buildChunk(1, 500 + i, 0)), [])
  const refs = useRef<(InstancedMesh | null)[]>([])

  const placements = useMemo(() => {
    const rng = new Rng(2024)
    const out: Matrix4[][] = Array.from({ length: VARIANTS }, () => [])
    const q = new Quaternion()
    const viewer: V2 = [VIEWER.position[0], VIEWER.position[2]]
    const place = (cell: FieldCell, size: number) => {
      if (cell.top < LAVA_Y + 0.05) return
      const [x, z] = pointIn(cell, rng)
      // keep the spot right under the viewer and around the loose rocks clear
      if (Math.hypot(x - viewer[0], z - viewer[1]) < 1.6) return
      if (LOOSE_ROCKS.some((r) => Math.hypot(x - r.position[0], z - r.position[2]) < 0.7)) return
      q.setFromEuler(new Euler(rng.range(-0.5, 0.5), rng.range(0, Math.PI * 2), rng.range(-0.5, 0.5)))
      out[rng.int(0, VARIANTS - 1)].push(
        new Matrix4().compose(new Vector3(x, cell.top + size * 0.26, z), q, new Vector3(size, size * rng.range(0.7, 1.1), size)),
      )
    }
    for (const c of causeway.cells) {
      if (c.kind === 'rim') {
        // gravel piles up along the broken edges
        for (let k = rng.int(0, 3); k > 0; k--) place(c, rng.range(0.06, 0.16))
        if (rng.chance(0.18)) place(c, rng.range(0.2, 0.34))
      } else if (rng.chance(0.22)) {
        place(c, rng.chance(0.3) ? rng.range(0.14, 0.24) : rng.range(0.05, 0.11))
      }
    }
    return out
  }, [causeway])

  useLayoutEffect(() => {
    placements.forEach((list, v) => {
      const mesh = refs.current[v]
      if (!mesh) return
      list.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [placements])

  return (
    <group>
      {placements.map((list, v) => (
        <instancedMesh key={v} ref={(m) => void (refs.current[v] = m)} args={[geometries[v], material, list.length]} castShadow receiveShadow />
      ))}
    </group>
  )
}
