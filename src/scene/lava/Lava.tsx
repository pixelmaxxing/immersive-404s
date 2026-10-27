import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { Vector3 } from 'three'
import { debugOff } from '../../debug'
import { createLavaFallMaterial, createLavaSheetMaterial } from '../../materials/lavaMaterial'
import { worldEvents } from '../../world/events'
import { flash, ripple } from '../../world/lavaLight'
import { ISLAND, LAVA_Y } from '../../world/layout'
import { getWorld } from '../../world/world'
import { emitBurst } from '../fx/bursts'

/** The lava lake around you, the molten rivers on the island, and the falls joining them. */
export function Lava() {
  const { island, islandField, islandLavaY, lakeField, falls } = getWorld()

  const { lake, top, fall } = useMemo(
    () => ({
      lake: createLavaSheetMaterial({ field: lakeField, scale: 1, lod: 20, plates: 0.62 }),
      top: createLavaSheetMaterial({ field: islandField, scale: ISLAND.detail, lod: 0 }),
      fall: createLavaFallMaterial(),
    }),
    [lakeField, islandField],
  )

  // poking the lava: a splash of molten droplets and a spreading ripple
  const splash = (e: ThreeEvent<MouseEvent>) => {
    // a drag is the bow being drawn, not a poke
    if (e.delta > 6 || lakeField.sample(e.point.x, e.point.z).molten < 0.15) return
    e.stopPropagation()
    const p = new Vector3(e.point.x, LAVA_Y + 0.02, e.point.z)
    ripple(p.x, p.z, 1.2)
    emitBurst({ position: p, count: 18, kind: 'droplet', speed: 2.6, spread: 0.7 })
    emitBurst({ position: p, count: 10, kind: 'ember', speed: 1.4 })
    flash(p.clone().setY(LAVA_Y + 0.6), 2.2, 1.6, 0.6)
    worldEvents.emit('lava:splash', { position: p.toArray(), strength: 1 })
  }

  return (
    <group>
      {!debugOff('sheet') && (
        <>
          <mesh material={lake} position-y={LAVA_Y} rotation-x={-Math.PI / 2} renderOrder={1} onClick={splash}>
            <planeGeometry args={[700, 700, 1, 1]} />
          </mesh>
          {island.sheet && <mesh geometry={island.sheet} material={top} position-y={islandLavaY} renderOrder={1} />}
        </>
      )}
      {!debugOff('falls') && falls.map((f, i) => <mesh key={i} geometry={f.geometry} material={fall} renderOrder={2} />)}
    </group>
  )
}
