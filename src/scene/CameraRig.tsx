import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { bow, game, lookDirection } from '../world/archery'
import { cameraShake } from '../world/interaction'
import { VIEWER } from '../world/layout'
import { timeWarp } from '../world/time'

/** Optional inspection camera for development: ?cam=x,y,z&look=x,y,z */
function debugCamera() {
  const q = new URLSearchParams(window.location.search)
  const parse = (k: string) => q.get(k)?.split(',').map(Number) as [number, number, number] | undefined
  const cam = parse('cam')
  return cam ? { cam: new Vector3(...cam), look: new Vector3(...(parse('look') ?? [0, 0, 0])) } : null
}

const UP = new Vector3(0, 1, 0)

/**
 * First-person camera: you stand on the causeway at eye height, looking up at
 * the monument.
 *  - Cinematic reveal: the view starts on the stones at your feet and slowly
 *    tilts up to the island as the world fades in.
 *  - Restrained mouse look and a breathing sway keep it alive.
 *  - Narrow screens widen the field of view to keep the monument in frame.
 *  - Drawing the bow: the view leans a little into the shot and narrows.
 *  - The winning shot: the view is drawn in toward the strike.
 *  - A short decaying shake when something heavy happens.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const debug = useMemo(debugCamera, [])

  const eye = useMemo(() => new Vector3(...VIEWER.position), [])
  const smooth = useRef({ x: 0, y: 0 })
  const lean = useRef(0)
  const zoom = useRef(0)
  const tmp = useMemo(() => ({ pos: new Vector3(), dir: new Vector3(), toHit: new Vector3() }), [])

  useFrame((state, dt) => {
    if (debug) {
      camera.position.copy(debug.cam)
      camera.lookAt(debug.look)
      return
    }
    const t = state.clock.elapsedTime
    const d = Math.min(dt, 0.05)
    const aspect = size.width / Math.max(1, size.height)

    // --- field of view: keep the monument and its falls in frame ---
    const wide = MathUtils.smoothstep(aspect, 0.55, 16 / 9)
    const needH = MathUtils.degToRad(MathUtils.lerp(44, 70, wide))
    const vFromH = MathUtils.radToDeg(2 * Math.atan(Math.tan(needH / 2) / aspect))
    const won = game.won ? MathUtils.clamp((t - game.wonAt) / 2.2, 0, 1) : 0
    const push = reduced ? 0 : won * won * (3 - 2 * won)
    zoom.current += (bow.draw * (bow.aiming ? 1 : 0) - zoom.current) * (1 - Math.exp(-d * 6))
    const fov = MathUtils.clamp(Math.max(VIEWER.fov, vFromH), VIEWER.fov, 86) * (1 - 0.08 * zoom.current - 0.16 * push)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    // --- mouse look (held still while the bow is drawn: the pointer is pulling the string) ---
    const amp = reduced ? 0.25 : 1
    const k = 1 - Math.exp(-d * 2.4)
    if (!bow.aiming) {
      smooth.current.x += (state.pointer.x - smooth.current.x) * k
      smooth.current.y += (state.pointer.y - smooth.current.y) * k
    }

    // --- reveal: from the stones at your feet up to the monument ---
    const intro = reduced ? 1 : MathUtils.clamp((t - 0.35) / 5.0, 0, 1)
    const ease = intro * intro * (3 - 2 * intro)
    const introPitch = -(1 - ease) * 0.5

    const yaw = -smooth.current.x * 0.07 * amp + Math.sin(t * 0.11) * 0.012 * amp
    // tall screens show far more sky than they need; lower the gaze a little
    const portraitTilt = -(1 - wide) * 0.09
    const pitch = smooth.current.y * 0.045 * amp + Math.sin(t * 0.17 + 0.6) * 0.006 * amp + introPitch + portraitTilt
    // the bow starts its aim from wherever the view is looking, then the view leans into the shot
    bow.camYaw = yaw
    bow.camPitch = pitch
    lean.current += ((bow.aiming ? 1 : 0) - lean.current) * (1 - Math.exp(-d * (bow.aiming ? 5 : 2.2)))
    const dir = lookDirection(yaw + (bow.yaw - yaw) * 0.3 * lean.current, pitch + (bow.pitch - pitch) * 0.3 * lean.current, tmp.dir)

    // breathing sway, and a slow step forward during the reveal
    const pos = tmp.pos.copy(eye)
    pos.y += Math.sin(t * 0.9) * 0.018 * amp
    pos.x += Math.sin(t * 0.37) * 0.035 * amp + smooth.current.x * 0.12 * amp
    pos.z += (1 - ease) * 1.2

    // a hit on the 404 draws you in toward it
    if (push > 0) {
      tmp.toHit.subVectors(game.point, pos).normalize()
      dir.lerp(tmp.toHit, 0.3 * push).normalize()
      pos.addScaledVector(tmp.toHit, 2.4 * push)
    }

    // shake runs on real time, so it stays a sharp jolt even in slow motion (and never without motion)
    const s = reduced ? 0 : cameraShake.amount
    if (s > 0.0005) {
      const rt = timeWarp.realTime
      pos.x += (Math.sin(rt * 61.0) + Math.sin(rt * 37.3)) * s * 0.35
      pos.y += (Math.sin(rt * 53.7 + 1.0) + Math.sin(rt * 29.1)) * s * 0.35
      cameraShake.amount *= Math.exp(-Math.min(timeWarp.realDelta, 0.05) * 6)
    }

    camera.position.copy(pos)
    camera.up.copy(UP)
    camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z)
    camera.rotateZ(Math.sin(t * 0.23) * 0.004 * amp - smooth.current.x * 0.008 * amp)
  })

  return null
}
