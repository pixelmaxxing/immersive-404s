import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import { timeWarp } from '../world/time'

/** Runs the frame clock at `timeWarp.scale`: every frame's delta, and its elapsed time, are world time. */
export function TimeWarp() {
  const clock = useThree((s) => s.clock)
  useLayoutEffect(() => {
    const real = clock.getDelta.bind(clock)
    clock.getDelta = () => {
      const before = clock.elapsedTime
      const d = real()
      timeWarp.realDelta = d
      timeWarp.realTime += d
      const scaled = d * timeWarp.scale
      clock.elapsedTime = before + scaled
      return scaled
    }
    return () => {
      delete (clock as { getDelta?: unknown }).getDelta
    }
  }, [clock])
  return null
}
