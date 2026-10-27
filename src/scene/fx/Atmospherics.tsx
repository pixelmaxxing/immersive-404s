import { useMemo } from 'react'
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'
import { LAVA_RAMP_GLSL } from '../../materials/glsl/lavaRamp'
import { NOISE_GLSL } from '../../materials/glsl/noise'
import { shared } from '../../materials/shared'
import { Rng } from '../../geometry/random'
import { LAKE_CURRENTS, LAVA_Y, SOURCE_POOL } from '../../world/layout'
import { getWorld } from '../../world/world'

/**
 * Atmospherics:
 *  glows — light scattered by hot air: a broad warm bloom behind the monument
 *          (back-lighting the 404 against its own molten source), incandescent
 *          mist where the falls crash into the lake, the far volcano's fire
 *  smoke — slow wisps rising off the lava, lit orange from beneath
 * Both are camera-facing billboards animated entirely on the GPU.
 */

const billboardVertex = /* glsl */ `
attribute vec4 aParams; // seed, intensity, aspect, kind
uniform float uTime;
varying vec2 vUv;
varying vec4 vParams;
varying float vLife;
void main() {
  vUv = uv;
  vParams = aParams;
  vec3 base = instanceMatrix[3].xyz;
  float size = length(instanceMatrix[0].xyz);
  float life = 0.0;
  if (aParams.w > 0.5) {
    // smoke: rise, swell and fade on a loop
    float period = 9.0 + aParams.x * 5.0;
    life = fract(uTime / period + aParams.x);
    base.y += life * (1.0 + aParams.x) * size * 0.9;
    base.x += sin(uTime * 0.2 + aParams.x * 20.0) * 0.4 * life;
    size *= 0.6 + life * 1.1;
  }
  vLife = life;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = base + (right * position.x * aParams.z + up * position.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`

export function Atmospherics() {
  const { falls, islandLavaY, farLands } = getWorld()

  const glows = useMemo(() => {
    const [px, pz] = SOURCE_POOL.center
    const y = islandLavaY
    const items: { p: Vector3; size: number; intensity: number; aspect: number }[] = [
      // the molten source behind the monument: light scattering in the smoke
      { p: new Vector3(px - 9.5, y + 3.2, pz - 1.2), size: 16, intensity: 0.5, aspect: 1.5 },
      { p: new Vector3(px + 9.5, y + 3.2, pz - 1.2), size: 16, intensity: 0.5, aspect: 1.5 },
      { p: new Vector3(px, y + 3.8, pz - 1.8), size: 18, intensity: 0.5, aspect: 1.4 },
      { p: new Vector3(px, y + 8.5, pz - 4), size: 42, intensity: 0.24, aspect: 1.9 },
    ]
    for (const f of falls) {
      const out = new Vector3(f.dir[0], 0, f.dir[1])
      // incandescent mist where the fall crashes into the lake
      items.push({ p: f.bottom.clone().addScaledVector(out, 0.6).setY(LAVA_Y + 1.6), size: 10, intensity: 0.85, aspect: 1.3 })
      items.push({ p: f.lip.clone().addScaledVector(out, 1.2).setY(f.lip.y - 2.2), size: 6.5, intensity: 0.38, aspect: 0.8 })
    }
    for (const c of farLands.craters) items.push({ p: c.clone().setY(c.y + 6), size: 70, intensity: 0.5, aspect: 1.4 })
    const m = new Matrix4()
    const q = new Quaternion()
    const matrices = items.map((it) => m.clone().compose(it.p, q, new Vector3(it.size, it.size, it.size)))
    const params = new Float32Array(items.flatMap((it, i) => [i * 0.37, it.intensity, it.aspect, 0]))
    const g = new PlaneGeometry(1, 1)
    g.setAttribute('aParams', new InstancedBufferAttribute(params, 4))
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: shared.uTime, uColor: { value: new Color('#ff5e1a') } },
      vertexShader: billboardVertex,
      fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec4 vParams;
${NOISE_GLSL}
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c * vec2(1.0, 1.15)) * 2.0;
  float fall = pow(max(1.0 - d, 0.0), 2.4);
  float n = lw_snoise(vec3(vUv * 1.8 + vec2(0.0, -uTime * 0.05), uTime * 0.04 + vParams.x));
  float glow = fall * (0.78 + 0.3 * n) * vParams.y;
  gl_FragColor = vec4(uColor * glow * 0.22, 1.0);
}`,
    })
    return { geometry: g, material: mat, matrices, count: items.length }
  }, [falls, islandLavaY, farLands])

  const smoke = useMemo(() => {
    const rng = new Rng(77)
    const spots: { p: Vector3; size: number; n: number }[] = [
      // smoke boiling off the source behind the monument
      { p: new Vector3(SOURCE_POOL.center[0], islandLavaY + 1.5, SOURCE_POOL.center[1]), size: 11, n: 3 },
    ]
    // wisps rising off the currents beside the causeway
    for (const c of LAKE_CURRENTS) {
      for (const z of [-22, -10, 2]) {
        const near = c.points.reduce((best, p) => (Math.abs(p[1] - z) < Math.abs(best[1] - z) ? p : best))
        spots.push({ p: new Vector3(near[0], LAVA_Y + 0.8, z), size: 4.2, n: 2 })
      }
    }
    // plumes where the falls crash into the lake
    for (const f of falls) spots.push({ p: f.bottom.clone().setY(LAVA_Y + 1.5), size: 9, n: 3 })
    const items = spots.flatMap((s) =>
      Array.from({ length: s.n }, () => ({
        p: s.p.clone().add(new Vector3(rng.range(-0.4, 0.4) * s.size * 0.3, 0, rng.range(-0.4, 0.4) * s.size * 0.3)),
        size: s.size * rng.range(0.75, 1.15),
      })),
    )
    const m = new Matrix4()
    const q = new Quaternion()
    const matrices = items.map((it) => m.clone().compose(it.p, q, new Vector3(it.size, it.size, it.size)))
    const params = new Float32Array(items.flatMap(() => [rng.next(), rng.range(0.6, 1), 1, 1]))
    const g = new PlaneGeometry(1, 1)
    g.setAttribute('aParams', new InstancedBufferAttribute(params, 4))
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { uTime: shared.uTime },
      vertexShader: billboardVertex,
      fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vParams;
varying float vLife;
${NOISE_GLSL}
${LAVA_RAMP_GLSL}
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float n = lw_fbm(vec3(vUv * 2.6 + vec2(vParams.x * 9.0, -uTime * 0.08), uTime * 0.05 + vParams.x * 3.0), 4);
  float wisp = smoothstep(0.0, 0.55, n + 0.35 - d * 0.75) * (1.0 - smoothstep(0.55, 1.0, d));
  float alpha = wisp * smoothstep(0.0, 0.2, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife)) * 0.32 * vParams.y;
  // dark ash smoke, under-lit by the lava it rises from
  vec3 col = vec3(0.012, 0.009, 0.008) + lw_lavaRamp(0.5) * 0.09 * (1.0 - vLife) * (1.0 - vUv.y * 0.7);
  gl_FragColor = vec4(col, alpha);
}`,
    })
    return { geometry: g, material: mat, matrices, count: items.length }
  }, [falls, islandLavaY])

  const setup = (matrices: Matrix4[]) => (mesh: { setMatrixAt: (i: number, m: Matrix4) => void; instanceMatrix: { needsUpdate: boolean } } | null) => {
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <group>
      <instancedMesh args={[smoke.geometry, smoke.material, smoke.count]} frustumCulled={false} renderOrder={4} ref={setup(smoke.matrices)} />
      <instancedMesh args={[glows.geometry, glows.material, glows.count]} frustumCulled={false} renderOrder={5} ref={setup(glows.matrices)} />
    </group>
  )
}
