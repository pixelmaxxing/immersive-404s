import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three'
import { LAVA_RAMP_GLSL } from '../../materials/glsl/lavaRamp'
import { shared } from '../../materials/shared'

/**
 * Event-driven particle bursts (embers escaping cracks, grit shaken loose,
 * molten splashes). CPU writes spawn data into a ring buffer; the GPU does all
 * the motion, so a burst costs a few bytes of upload and zero per-frame work.
 */
export type BurstKind = 'ember' | 'spark' | 'grit' | 'droplet' | 'dust'

export interface BurstOptions {
  position: Vector3 | [number, number, number]
  count: number
  kind: BurstKind
  speed?: number
  /** preferred direction (normalised); spreads around it */
  direction?: Vector3
  spread?: number
  size?: number
  /** how far around `position` the particles start */
  radius?: number
}

const KIND = { ember: 0, spark: 1, grit: 2, droplet: 3, dust: 4 } as const

class BurstPool {
  readonly points: Points
  private cursor = 0
  private readonly start: BufferAttribute
  private readonly vel: BufferAttribute
  private readonly params: BufferAttribute

  constructor(readonly capacity: number, hot: boolean) {
    const g = new BufferGeometry()
    this.start = new BufferAttribute(new Float32Array(capacity * 4).fill(-1000), 4)
    this.vel = new BufferAttribute(new Float32Array(capacity * 4), 4)
    this.params = new BufferAttribute(new Float32Array(capacity * 4), 4)
    g.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 3), 3))
    g.setAttribute('aStart', this.start)
    g.setAttribute('aVel', this.vel)
    g.setAttribute('aParams', this.params)
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: hot ? AdditiveBlending : NormalBlending,
      uniforms: { uTime: shared.uTime, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec4 aStart;
attribute vec4 aVel;
attribute vec4 aParams;
varying float vLife;
varying float vKind;
varying float vSeed;
void main() {
  float age = uTime - aStart.w;
  float life = aVel.w;
  vKind = aParams.y;
  vSeed = aParams.z;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vLife = 0.0;
    return;
  }
  float k = age / life;
  vLife = k;
  float drag = aParams.w;
  vec3 g = vKind < 0.5 ? vec3(0.0, 1.1, 0.0) : (vKind < 1.5 ? vec3(0.0, -2.5, 0.0) : (vKind < 2.5 ? vec3(0.0, -9.0, 0.0) : (vKind < 3.5 ? vec3(0.0, -7.0, 0.0) : vec3(0.0, 0.35, 0.0))));
  vec3 p = aStart.xyz + aVel.xyz * (1.0 - exp(-drag * age)) / drag + 0.5 * g * age * age;
  if (vKind < 0.5) {
    float s = vSeed * 31.0;
    p.x += sin(age * 2.3 + s) * 0.18 * k;
    p.z += cos(age * 1.9 + s * 1.3) * 0.18 * k;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aParams.x;
  if (vKind < 0.5) size *= 1.0 - k * 0.6;
  else if (vKind < 1.5) size *= 1.0 - k;
  else if (vKind > 3.5) size *= 0.45 + 2.0 * sqrt(k);
  else if (vKind > 2.5) size *= 1.0 - k * 0.5;
  gl_PointSize = max(1.0, size * uScale / -mv.z);
}`,
      fragmentShader: /* glsl */ `
${LAVA_RAMP_GLSL}
varying float vLife;
varying float vKind;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  if (vKind > 3.5) {
    // dust: a soft, slowly billowing puff of rock flour, lit warm from the lava below
    float a = pow(1.0 - d, 1.7) * smoothstep(0.0, 0.07, vLife) * (1.0 - smoothstep(0.3, 1.0, vLife)) * 0.5;
    gl_FragColor = vec4(vec3(0.062, 0.052, 0.047) + vec3(0.07, 0.027, 0.008) * (1.0 - vLife) * (0.6 + 0.4 * vSeed), a * 0.85);
    return;
  }
  if (vKind > 1.5 && vKind < 2.5) {
    // grit: tiny dark angular bits of stone
    float a = (1.0 - smoothstep(0.55, 0.9, max(abs(c.x), abs(c.y)) * 2.0)) * (1.0 - smoothstep(0.75, 1.0, vLife));
    // dusty stone chips catching the key light, warmed by the lava glow
    gl_FragColor = vec4(vec3(0.11, 0.095, 0.085) + vec3(0.09, 0.03, 0.01) * (1.0 - vLife), a * 0.95);
    return;
  }
  float core = pow(1.0 - d, 1.6);
  float t = vKind < 0.5 ? mix(1.05, 0.45, vLife) : (vKind < 1.5 ? mix(1.2, 0.7, vLife) : mix(0.95, 0.5, vLife));
  vec3 col = lw_lavaEmission(t) * core * (1.0 - smoothstep(0.7, 1.0, vLife)) * 1.6;
  gl_FragColor = vec4(col, 1.0);
}`,
    })
    this.points = new Points(g, material)
    this.points.frustumCulled = false
  }

  spawn(o: BurstOptions, time: number) {
    const p = Array.isArray(o.position) ? o.position : o.position.toArray()
    const kind = KIND[o.kind]
    const speed = o.speed ?? 1.5
    const spread = o.spread ?? 1
    const dir = o.direction
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.capacity
      // random direction biased upward / along dir
      let vx = (Math.random() - 0.5) * 2 * spread
      let vy = Math.random() * 0.8 + 0.4
      let vz = (Math.random() - 0.5) * 2 * spread
      if (dir) {
        vx += dir.x * 1.5
        vy += dir.y * 1.5
        vz += dir.z * 1.5
      }
      const l = Math.hypot(vx, vy, vz) || 1
      const s = speed * (0.4 + Math.random() * 0.8)
      const life =
        kind === 0
          ? 1.4 + Math.random() * 2.2
          : kind === 1
            ? 0.5 + Math.random() * 0.6
            : kind === 2
              ? 1.2 + Math.random() * 0.9
              : kind === 3
                ? 0.8 + Math.random() * 0.8
                : 2.2 + Math.random() * 1.6
      const size =
        (o.size ?? 1) *
        (kind === 0
          ? 0.05 + Math.random() * 0.05
          : kind === 1
            ? 0.07 + Math.random() * 0.05
            : kind === 2
              ? 0.035 + Math.random() * 0.04
              : kind === 3
                ? 0.06 + Math.random() * 0.05
                : 0.5 + Math.random() * 0.5)
      const r = (o.radius ?? 0.05) * 2
      this.start.setXYZW(i, p[0] + (Math.random() - 0.5) * r, p[1] + (Math.random() - 0.5) * r, p[2] + (Math.random() - 0.5) * r, time + Math.random() * 0.05)
      this.vel.setXYZW(i, (vx / l) * s, (vy / l) * s, (vz / l) * s, life)
      this.params.setXYZW(i, size, kind, Math.random(), kind === 0 ? 1.6 : kind === 2 ? 0.4 : kind === 4 ? 2.2 : 0.8)
    }
    this.start.needsUpdate = true
    this.vel.needsUpdate = true
    this.params.needsUpdate = true
  }
}

let hotPool: BurstPool | null = null
let gritPool: BurstPool | null = null

export function getBurstPools() {
  if (!hotPool) hotPool = new BurstPool(2000, true)
  if (!gritPool) gritPool = new BurstPool(900, false)
  return { hot: hotPool, grit: gritPool }
}

/** Fire-and-forget particle burst at a world position. */
export function emitBurst(o: BurstOptions) {
  const { hot, grit } = getBurstPools()
  ;(o.kind === 'grit' || o.kind === 'dust' ? grit : hot).spawn(o, shared.uTime.value)
}

export function setBurstScale(scale: number) {
  const { hot, grit } = getBurstPools()
  ;(hot.points.material as ShaderMaterial).uniforms.uScale.value = scale
  ;(grit.points.material as ShaderMaterial).uniforms.uScale.value = scale
}
