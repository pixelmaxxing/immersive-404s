import { useMemo } from 'react'
import { createRockMaterial, ROCK_PRESETS } from '../../materials/rockMaterial'
import { getWorld } from '../../world/world'

/** Mesas and a smouldering volcano on the horizon; the haze turns them into silhouettes. */
export function FarLands() {
  const { farLands } = getWorld()
  const material = useMemo(() => createRockMaterial({ ...ROCK_PRESETS.basalt, bump: 0, crack: 0, detailScale: 8, emitters: [0, 0] }), [])
  return <mesh geometry={farLands.geometry} material={material} />
}
