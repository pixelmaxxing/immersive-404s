import { useMemo } from 'react'
import { BackSide, ShaderMaterial, Vector3 } from 'three'
import { ATMOSPHERE_GLSL } from '../materials/glsl/atmosphere'
import { NOISE_GLSL } from '../materials/glsl/noise'
import { shared } from '../materials/shared'
import { getWorld } from '../world/world'

/**
 * Sky dome. Same colour model as the fog, plus a ceiling of smoke clouds lit
 * from beneath by the lava sea — warm and billowing near the horizon, fading
 * to near-black overhead — and the glow of fire behind the island and on a
 * distant volcano.
 */
export function Sky() {
  const { farLands } = getWorld()
  const material = useMemo(() => {
    const crater = farLands.craters[0] ?? new Vector3(170, 74, -330)
    return new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: shared.uTime,
        uVolcano: { value: crater.clone().normalize() },
      },
      vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vDir = normalize(wp - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_Position = p.xyww;
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uVolcano;
varying vec3 vDir;
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = lw_skyColor(dir);

  // smoke ceiling: project onto a cloud deck, drift slowly
  if (dir.y > -0.02) {
    float h = max(dir.y, 0.0) + 0.06;
    vec2 uv = dir.xz / h * 0.55 + vec2(uTime * 0.0035, uTime * 0.0018);
    float warp = lw_snoise(vec3(uv * 0.6, uTime * 0.006));
    float n = lw_fbm(vec3(uv * 1.1 + warp * 0.7, uTime * 0.008), 2) + 0.18 * lw_snoise(uv * 4.3 + 2.1);
    float billow = smoothstep(-0.25, 0.5, n);
    // lit from beneath by the lava: warm near the horizon, a dim red glow overhead
    float under = exp(-max(dir.y, 0.0) * 8.0) * 0.8 + exp(-max(dir.y, 0.0) * 2.2) * 0.2;
    vec3 dark = vec3(0.006, 0.005, 0.005);
    vec3 lit = mix(vec3(0.02, 0.008, 0.006), vec3(0.075, 0.024, 0.009), under);
    float shape = billow * smoothstep(-0.02, 0.06, dir.y);
    col = mix(col, mix(dark, lit, smoothstep(0.2, 0.9, billow) * (0.35 + 0.65 * under)), shape * 0.9);
    // rims where the glow catches the edges of the billows
    float rim = smoothstep(0.35, 0.55, billow) * (1.0 - smoothstep(0.55, 0.85, billow));
    col += vec3(0.07, 0.022, 0.008) * rim * under * 0.6;
  }

  // the molten source glowing behind the island
  float toIsland = max(dot(dir, normalize(vec3(0.0, 0.16, -1.0))), 0.0);
  col += vec3(0.05, 0.016, 0.006) * pow(toIsland, 18.0) + vec3(0.02, 0.006, 0.0025) * pow(toIsland, 5.0);
  // a distant volcano's fire
  float v = max(dot(dir, uVolcano), 0.0);
  col += vec3(0.16, 0.045, 0.012) * pow(v, 900.0) + vec3(0.03, 0.009, 0.003) * pow(v, 60.0);

  // its eruption column: rising billows, glowing at the throat, leaning into the wind
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float s = el - asin(uVolcano.y) + 0.006;
  if (s > 0.0 && s < 0.75) {
    float az = atan(dir.x, -dir.z) - atan(uVolcano.x, -uVolcano.z);
    float drift = 0.45 * s * s / (0.25 + s);
    float u = az * cos(el) + drift;
    float w = 0.022 + 0.26 * s;
    // billows rise and churn; sampled in angle space so they stay round, not streaky
    vec3 q = vec3(u * 9.0, s * 9.0 - uTime * 0.045, uTime * 0.012);
    float n = lw_fbm(q, 3);
    float body = smoothstep(1.0, 0.65, abs(u) / w - n * 0.6) * smoothstep(0.0, 0.02, s) * (1.0 - smoothstep(0.3, 0.7, s));
    // lit from beneath: the undersides of the puffs catch the crater's glow
    float lit = clamp((n - lw_fbm(q - vec3(0.0, 0.3, 0.0), 3)) * 2.2 + 0.35, 0.0, 1.0);
    float throat = exp(-s * 12.0);
    vec3 smoke = vec3(0.008, 0.0055, 0.005) + vec3(0.034, 0.012, 0.0065) * lit * (0.25 + 0.75 * exp(-s * 5.0));
    smoke += vec3(0.22, 0.06, 0.015) * throat * (0.45 + 0.55 * lit);
    col = mix(col, smoke, body * 0.95);
  }

  // dither against banding in the deep gradients
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (d - 0.5) / 255.0 * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`,
    })
  }, [farLands])

  return (
    <mesh material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[900, 48, 24]} />
    </mesh>
  )
}
