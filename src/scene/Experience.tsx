import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { ATMOSPHERE } from '../materials/glsl/atmosphere'
import { patchShaderChunks } from '../materials/patchChunks'
import { shared } from '../materials/shared'
import * as worldApi from '../world'
import { GRAVITY, launcher } from '../world/archery'
import { VIEWER } from '../world/layout'
import { PHYSICS_GRAVITY, PHYSICS_STEP } from '../world/physics'
import { debugOff, debugParam } from '../debug'
import { PostFX } from './PostFX'
import { QualityMonitor, START_TIER, tierDpr, TIERS } from './Quality'
import { Scene } from './Scene'
import { TimeWarp } from './TimeWarp'

patchShaderChunks()

declare global {
  interface Window {
    __LOST_WORLD__?: {
      ready: boolean
      info?: () => unknown
      shared?: typeof shared
      world?: typeof worldApi
      project?: (x: number, y: number, z: number) => number[]
      shoot?: (x: number, y: number, z: number, speed?: number) => void
    }
  }
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

/** Reports readiness once the fully-loaded scene has rendered a few frames. */
function ReadySignal({ onReady, tier }: { onReady: () => void; tier: number }) {
  const tierRef = useRef(tier)
  tierRef.current = tier
  const frames = useRef(0)
  const done = useRef(false)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    if (done.current) return
    if (++frames.current >= 4) {
      done.current = true
      onReady()
      const readyAt = Math.round(performance.now())
      window.__LOST_WORLD__ = {
        ready: true,
        ...(import.meta.env.DEV
          ? {
              shared,
              world: worldApi,
              /** world → CSS pixel coordinates */
              project: (x: number, y: number, z: number) => {
                const v = new Vector3(x, y, z).project(camera)
                const r = gl.domElement.getBoundingClientRect()
                return [Math.round((v.x * 0.5 + 0.5) * r.width), Math.round((-v.y * 0.5 + 0.5) * r.height)]
              },
              /** looses an arrow from the bow that lands on a world point */
              shoot: (x: number, y: number, z: number, speed = 70) => {
                const tip = camera.position.clone().add(new Vector3(0, -0.25, -0.6).applyQuaternion(camera.quaternion))
                const d = new Vector3(x, y, z).sub(tip)
                const time = d.length() / speed
                const v = d.divideScalar(time)
                v.y += 0.5 * GRAVITY * time
                launcher.fire?.(tip, v, 1)
              },
            }
          : {}),
        info: () => ({
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          programs: gl.info.programs?.length,
          dpr: gl.getPixelRatio(),
          tier: TIERS[tierRef.current].name,
          readyAt,
        }),
      }
    }
  })
  return null
}

export function Experience({ onReady }: { onReady: () => void }) {
  const [supported] = useState(hasWebGL2)
  const forced = debugParam('tier')
  const [tier, setTier] = useState(forced !== null ? Number(forced) : START_TIER)
  useEffect(() => {
    if (!supported) onReady()
  }, [supported, onReady])

  if (!supported) {
    return (
      <div className="fallback">
        <h1>Oops. Wrong turn.</h1>
        <p>This lost world needs WebGL 2 to render.</p>
      </div>
    )
  }

  return (
    <Canvas
      className="canvas"
      role="img"
      aria-label="A floating volcanic island in a dark void, with a giant stone 404 monument, rivers of flowing lava and lava falls pouring into the abyss"
      shadows={debugOff('shadows') ? false : 'percentage'}
      flat
      dpr={tierDpr(tier)}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }}
      camera={{ fov: VIEWER.fov, near: 0.08, far: 900, position: VIEWER.position }}
    >
      <color attach="background" args={['#050404']} />
      <fogExp2 attach="fog" args={['#0b0908', ATMOSPHERE.density]} />
      <TimeWarp />
      <Suspense fallback={null}>
        <Physics gravity={[0, -PHYSICS_GRAVITY, 0]} timeStep={PHYSICS_STEP}>
          <Scene />
        </Physics>
        {!debugOff('post') && <PostFX ssao={TIERS[tier].ssao} aa={TIERS[tier].aa} />}
        <ReadySignal onReady={onReady} tier={tier} />
        {forced === null && <QualityMonitor tier={tier} onChange={setTier} />}
      </Suspense>
    </Canvas>
  )
}
