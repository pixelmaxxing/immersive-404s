import type { Vector3 } from 'three'
import { LAVA_Y } from './layout'
import { getWorld } from './world'

/**
 * Heat queries for gameplay. 0 = cold stone, ~0.5 = uncomfortably close,
 * 1 = in the lava. Uses the same data that drives the lava shaders, so it
 * always matches what the player sees.
 */
export function sampleHeat(p: Vector3): number {
  const { lakeField, islandField, islandLavaY, emitters } = getWorld()
  // the molten surface below: the island's rivers when up there, else the lake
  const high = p.y > islandLavaY - 2
  const f = (high ? islandField : lakeField).sample(p.x, p.z)
  const above = Math.max(0, p.y - (high ? islandLavaY : LAVA_Y))
  let heat = Math.max(f.molten, f.heat * 0.85) * Math.exp(-above / 1.4)
  // lava falls, pools and other glowing sources
  for (const e of emitters) {
    const abx = e.b.x - e.a.x
    const aby = e.b.y - e.a.y
    const abz = e.b.z - e.a.z
    const len2 = abx * abx + aby * aby + abz * abz || 1
    const t = Math.max(0, Math.min(1, ((p.x - e.a.x) * abx + (p.y - e.a.y) * aby + (p.z - e.a.z) * abz) / len2))
    const d = Math.hypot(p.x - (e.a.x + abx * t), p.y - (e.a.y + aby * t), p.z - (e.a.z + abz * t))
    heat = Math.max(heat, Math.exp(-(d * d) / (e.radius * e.radius)) * 0.8)
  }
  return Math.min(1, heat)
}

/** Is (x, z) open lava on the lake? */
export function isLava(x: number, z: number): boolean {
  return getWorld().lakeField.sample(x, z).molten > 0.12
}
