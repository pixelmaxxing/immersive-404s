import { useMemo } from 'react'
import { AdditiveBlending, InstancedBufferAttribute, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three'
import { LAVA_RAMP_GLSL } from '../../materials/glsl/lavaRamp'
import { NOISE_GLSL } from '../../materials/glsl/noise'
import { shared } from '../../materials/shared'
import { Rng } from '../../geometry/random'
import { CAUSEWAY, LAVA_Y } from '../../world/layout'
import { getWorld } from '../../world/world'

/**
 * Stylized flames licking up where lava meets stone: along the causeway's
 * broken edges, at the feet of the formations, beside the lips of the falls. Each flame is a cylindrical
 * billboard whose teardrop silhouette is torn by rising noise and shaded in
 * three soft bands (white-yellow core, orange body, red tips).
 */
export function Fire() {
  const { causeway, formations, lakeField, falls, islandLavaY } = getWorld()

  const { geometry, material, count, matrices } = useMemo(() => {
    const rng = new Rng(17)
    // where the causeway's broken edge meets open lava
    const spots: { p: Vector3; h: number }[] = []
    const edge = (cx: number, cz: number, ox: number, oz: number, reach: number) => {
      const l = Math.hypot(ox, oz) || 1
      const x = cx + (ox / l) * reach
      const z = cz + (oz / l) * reach
      if (lakeField.sample(x, z).molten > 0.12) spots.push({ p: new Vector3(x, LAVA_Y, z), h: rng.range(0.5, 1.15) })
    }
    const { landing } = CAUSEWAY
    for (const c of causeway.cells) {
      if (c.kind !== 'rim' || c.center[1] > 8) continue
      const [cx, cz] = c.center
      const onLanding = Math.hypot(cx - landing.center[0], cz - landing.center[1]) < landing.radius
      // outward: away from the landing's centre, or sideways off the causeway
      edge(cx, cz, onLanding ? cx - landing.center[0] : cx, onLanding ? cz - landing.center[1] : 0, 0.75)
    }
    for (const f of formations) {
      for (const c of f.field.cells) {
        if (c.kind !== 'rim' || !rng.chance(0.25)) continue
        const [cx, cz] = c.center
        const fx = f.summit.x
        const fz = f.summit.z
        edge(cx, cz, cx - fx, cz - fz, 0.6)
      }
    }
    // keep a sparse, uneven scattering
    const chosen: { p: Vector3; h: number }[] = []
    for (const s of spots.sort(() => rng.next() - 0.5)) {
      if (chosen.length >= 16) break
      if (chosen.every((c) => c.p.distanceTo(s.p) > 3.4)) chosen.push(s)
    }
    // big flames licking up beside the lips of the falls, high on the island
    for (const f of falls) {
      const lat = new Vector3(-f.dir[1], 0, f.dir[0])
      for (const side of [-1, 1]) {
        chosen.push({ p: f.lip.clone().addScaledVector(lat, side * (f.halfWidth + 0.9)).setY(islandLavaY), h: rng.range(2.2, 3.2) })
      }
    }
    const m = new Matrix4()
    const q = new Quaternion()
    const matrices: Matrix4[] = []
    const seeds = new Float32Array(chosen.length)
    chosen.forEach((s, i) => {
      matrices.push(m.clone().compose(s.p, q, new Vector3(s.h * rng.range(0.5, 0.7), s.h, 1)))
      seeds[i] = rng.next()
    })
    const g = new PlaneGeometry(1, 1, 1, 6)
    g.translate(0, 0.5, 0)
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))

    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: shared.uTime },
      vertexShader: /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
uniform float uTime;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vec3 base = instanceMatrix[3].xyz;
  float w = length(instanceMatrix[0].xyz);
  float h = length(instanceMatrix[1].xyz);
  h *= 0.85 + 0.15 * sin(uTime * 7.0 + aSeed * 40.0) + 0.1 * sin(uTime * 13.0 + aSeed * 17.0);
  vec3 toCam = cameraPosition - base;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  // lean with the hot updraft
  float sway = sin(uTime * 2.1 + aSeed * 12.0) * 0.12 * position.y * position.y;
  vec3 p = base + right * (position.x * w + sway) + vec3(0.0, position.y * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
${NOISE_GLSL}
${LAVA_RAMP_GLSL}
void main() {
  vec2 uv = vUv;
  float t = uTime * 1.6 + vSeed * 30.0;
  // tear the silhouette with rising noise
  float n = lw_snoise(vec3(uv.x * 3.0, uv.y * 2.2 - t, vSeed * 7.0));
  float n2 = lw_snoise(vec3(uv.x * 6.0, uv.y * 4.5 - t * 1.7, vSeed * 3.0 + 9.0));
  float x = (uv.x - 0.5) * 2.0 + (n * 0.22 + n2 * 0.1) * uv.y;
  float y = uv.y;
  // teardrop width profile
  float width = pow(max(1.0 - y, 0.0), 0.75) * smoothstep(0.0, 0.18, y) * 0.95 + 0.04;
  float d = abs(x) / width;
  float body = 1.0 - smoothstep(0.75, 1.0, d);
  body *= 1.0 - smoothstep(0.55 + n * 0.2, 0.98, y);
  if (body < 0.01) discard;
  // three soft bands
  float inner = 1.0 - smoothstep(0.25, 0.55, d + y * 0.55);
  float mid = 1.0 - smoothstep(0.5, 0.8, d + y * 0.3);
  float temp = 0.36 + 0.2 * mid + 0.26 * inner - y * 0.12;
  vec3 col = lw_lavaEmission(temp) * (0.5 + 0.5 * mid) * body;
  gl_FragColor = vec4(col * 1.25, 1.0);
}`,
    })
    return { geometry: g, material: mat, count: chosen.length, matrices }
  }, [causeway, formations, lakeField, falls, islandLavaY])

  return (
    <instancedMesh
      args={[geometry, material, count]}
      frustumCulled={false}
      renderOrder={3}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
    />
  )
}
