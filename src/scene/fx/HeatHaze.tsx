import { useFrame } from '@react-three/fiber'
import { Effect } from 'postprocessing'
import { useMemo } from 'react'
import { MathUtils, Uniform, Vector3, Vector4, type PerspectiveCamera } from 'three'
import { LAKE_CURRENTS, LAVA_Y } from '../../world/layout'
import { getWorld } from '../../world/world'

const MAX_SOURCES = 8

const fragment = /* glsl */ `
uniform float uTime;
uniform vec4 uSources[${MAX_SOURCES}];
uniform float uStrength;
uniform float uAspect;

float hz_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hz_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hz_hash(i), hz_hash(i + vec2(1.0, 0.0)), f.x), mix(hz_hash(i + vec2(0.0, 1.0)), hz_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void mainUv(inout vec2 uv) {
  float m = 0.0;
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    vec4 s = uSources[i];
    if (s.w <= 0.0) continue;
    vec2 d = uv - s.xy;
    d.x *= uAspect;
    // a column of hot air: tall above the source, short below it
    d.y *= d.y > 0.0 ? 0.5 : 2.6;
    m += exp(-dot(d, d) / (s.z * s.z)) * s.w;
  }
  m = min(m, 1.0);
  if (m < 0.003) return;
  vec2 q = vec2(uv.x * uAspect, uv.y) * 60.0;
  vec2 n = vec2(hz_noise(q + vec2(0.0, -uTime * 3.2)), hz_noise(q * 1.37 + vec2(7.1, -uTime * 3.9))) - 0.5;
  uv += n * m * uStrength;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = inputColor;
}
`

export class HeatHazeEffect extends Effect {
  constructor() {
    super('HeatHazeEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ['uTime', new Uniform(0)],
        ['uSources', new Uniform(Array.from({ length: MAX_SOURCES }, () => new Vector4(0, 0, 0, 0)))],
        ['uStrength', new Uniform(0.0024)],
        ['uAspect', new Uniform(1)],
      ]),
    })
  }
}

/** Heat shimmer rising above the hottest lava. */
export function HeatHaze() {
  const { falls } = getWorld()
  const effect = useMemo(() => new HeatHazeEffect(), [])
  const sources = useMemo(() => {
    const pts: { p: Vector3; r: number; w: number }[] = []
    // the currents running past you — the air above them wavers
    for (const c of LAKE_CURRENTS) {
      for (const z of [-14, -2]) {
        const near = c.points.reduce((best, p) => (Math.abs(p[1] - z) < Math.abs(best[1] - z) ? p : best))
        pts.push({ p: new Vector3(near[0], LAVA_Y + 1.2, z), r: 2.6, w: 0.9 })
      }
    }
    // the plunge pools of the falls
    falls.forEach((f) => pts.push({ p: f.bottom.clone().setY(LAVA_Y + 2.5), r: 4, w: 0.8 }))
    return pts.slice(0, MAX_SOURCES)
  }, [falls])
  const v = useMemo(() => new Vector3(), [])

  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera
    const u = effect.uniforms
    u.get('uTime')!.value = state.clock.elapsedTime
    u.get('uAspect')!.value = state.size.width / Math.max(1, state.size.height)
    const arr = u.get('uSources')!.value as Vector4[]
    const tanHalf = Math.tan(MathUtils.degToRad(cam.fov / 2))
    sources.forEach((s, i) => {
      v.copy(s.p).project(cam)
      const dist = cam.position.distanceTo(s.p)
      const r = (s.r / (dist * tanHalf)) * 0.5
      arr[i].set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, r, v.z < 1 ? s.w : 0)
    })
  })

  return <primitive object={effect} dispose={null} />
}
