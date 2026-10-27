import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { MAX_EMITTERS, shared } from '../../materials/shared'
import { getWorld } from '../../world/world'
import { flashes } from '../../world/lavaLight'

/**
 * Drives the lava light emitters shared by every stone material. Intensities
 * breathe slowly with the lava (layered sines → organic, never strobing).
 * The last slots are reserved for short-lived impact flashes.
 */
export function LavaLights() {
  const { emitters } = getWorld()
  const staticCount = Math.min(emitters.length, MAX_EMITTERS - flashes.length)

  useMemo(() => {
    for (let i = 0; i < staticCount; i++) {
      const e = emitters[i]
      shared.uLavaA.value[i].set(e.a.x, e.a.y, e.a.z, e.radius)
      shared.uLavaB.value[i].set(e.b.x, e.b.y, e.b.z, e.intensity)
    }
  }, [emitters, staticCount])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    shared.uTime.value = t
    for (let i = 0; i < staticCount; i++) {
      const e = emitters[i]
      const s = e.seed * 17.0
      const breathe = 0.88 + 0.08 * Math.sin(t * 0.9 + s) + 0.05 * Math.sin(t * 2.3 + s * 1.7) + 0.025 * Math.sin(t * 5.1 + s * 0.3)
      shared.uLavaB.value[i].w = e.intensity * breathe
    }
    for (let k = 0; k < flashes.length; k++) {
      const f = flashes[k]
      const slot = MAX_EMITTERS - flashes.length + k
      const age = t - f.start
      const life = Math.max(0, 1 - age / f.duration)
      shared.uLavaA.value[slot].set(f.position.x, f.position.y, f.position.z, f.radius)
      shared.uLavaB.value[slot].set(f.position.x, f.position.y + 0.01, f.position.z, life > 0 ? f.intensity * life * life : 0)
    }
  })

  return null
}
