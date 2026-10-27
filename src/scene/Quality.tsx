import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { game } from '../world/archery'
import { timeWarp } from '../world/time'

/**
 * Quality tiers. The scene starts at "high" and adapts to the measured frame
 * time: it steps down when frames take too long and climbs (up to screen-space
 * AO on top of the baked occlusion) only when there's clear headroom.
 */
export const TIERS = [
  { name: 'low', maxDpr: 0.85, aa: false, ssao: false },
  { name: 'medium', maxDpr: 1.1, aa: true, ssao: false },
  { name: 'high', maxDpr: 1.25, aa: true, ssao: false },
  { name: 'ultra', maxDpr: 1.5, aa: true, ssao: true },
] as const

export const START_TIER = 2

export function tierDpr(tier: number) {
  const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.min(device, TIERS[tier].maxDpr)
}

export function QualityMonitor({ tier, onChange }: { tier: number; onChange: (t: number) => void }) {
  const acc = useRef({ time: 0, frames: 0, warmup: 1.4, fastWindows: 0, lastDrop: -100, clock: 0 })

  useFrame(() => {
    // no resolution changes once the finale is playing
    if (game.won) return
    const dt = timeWarp.realDelta
    const a = acc.current
    a.clock += dt
    if (a.warmup > 0) {
      a.warmup -= dt
      return
    }
    a.time += Math.min(dt, 0.25)
    a.frames++
    if (a.time < 1.2) return
    const ms = (a.time / a.frames) * 1000
    a.time = 0
    a.frames = 0
    if (ms > 18.2 && tier > 0) {
      a.lastDrop = a.clock
      a.fastWindows = 0
      a.warmup = 1.5 // let the new resolution settle
      onChange(tier - 1)
    } else if (ms < 11 && tier < TIERS.length - 1 && a.clock - a.lastDrop > 12) {
      if (++a.fastWindows >= 2) {
        a.fastWindows = 0
        a.warmup = 1.5
        onChange(tier + 1)
      }
    } else {
      a.fastWindows = 0
    }
  })
  return null
}
