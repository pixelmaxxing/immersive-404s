import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { game } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { burnRadius, burnReach, burnRoughness, FINALE, FINALE_REDUCED, timeScaleAt } from '../../world/finale'
import { shake } from '../../world/interaction'
import { timeWarp } from '../../world/time'
import { burnUniforms } from '../fx/Burn'

/**
 * The shot that finds its mark (see world/finale.ts for the timeline): a beat
 * of stillness, slow motion while the stone breaks, a shockwave and rumble,
 * then a hole burns open where the arrow struck and the whole world burns
 * away to white. The monument's own collapse lives in <Monument />.
 */
export function Victory() {
  const size = useThree((s) => s.size)
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const st = useRef({ rumble: 0, burning: false, done: false, reach: 1 })
  const v = useMemo(() => new Vector3(), [])

  useFrame((state) => {
    const u = burnUniforms
    u.uTime.value = timeWarp.realTime
    u.uAspect.value = size.width / Math.max(1, size.height)
    if (!game.won) {
      timeWarp.scale = 1
      u.uBurn.value = 0
      u.uShock.value.w = 0
      u.uPunch.value = 0
      return
    }
    const s = st.current
    const timing = reduced ? FINALE_REDUCED : FINALE
    const real = (performance.now() - game.wonAtReal) / 1000
    const world = state.clock.elapsedTime - game.wonAt
    timeWarp.scale = reduced ? 1 : timeScaleAt(real)

    // the strike: a punch of light and a ring of refraction, in world time (so, in slow motion)
    v.copy(game.point).project(state.camera)
    u.uShock.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, Math.min(1, world / 0.6), reduced ? 0 : 0.014)
    u.uPunch.value = 0.5 * Math.exp(-world * 10)

    // the ground rumbles while the monument comes down
    if (!reduced && real < timing.burnStart && real - s.rumble > 0.11) {
      s.rumble = real
      shake(0.004 + 0.01 * Math.exp(-real * 0.8))
    }

    // the world burns away from where the arrow struck
    const p = (real - timing.burnStart) / timing.burnDuration
    if (p >= 0 && !s.burning) {
      s.burning = true
      const ox = v.x * 0.5 + 0.5
      const oy = v.y * 0.5 + 0.5
      u.uOrigin.value.set(ox, oy)
      s.reach = burnReach(ox, oy, u.uAspect.value)
      worldEvents.emit('finale:burn', { origin: [ox * size.width, (1 - oy) * size.height], duration: timing.burnDuration })
    }
    if (s.burning) {
      const r = burnRadius(p, s.reach)
      u.uRadius.value = r
      u.uRough.value = burnRoughness(r)
      u.uBurn.value = Math.min(1, Math.max(1e-4, p))
    }
    if (p >= 1 && !s.done) {
      s.done = true
      worldEvents.emit('finale:done', {})
    }
  })

  return null
}
