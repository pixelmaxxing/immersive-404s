import { DoubleSide, NormalBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector4 } from 'three'
import { LAVA_GLSL } from './glsl/lava'
import { LAVA_RAMP_GLSL } from './glsl/lavaRamp'
import { NOISE_GLSL } from './glsl/noise'
import { MAX_RIPPLES, shared, type FieldBinding } from './shared'

const COMMON_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormalW;
`

const COMMON_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uIntensity;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uAmbient;
varying vec3 vWorld;
varying vec3 vNormalW;
${NOISE_GLSL}
${LAVA_RAMP_GLSL}
${LAVA_GLSL}
`

function uniforms(extra: Record<string, { value: unknown }>) {
  return {
    ...UniformsUtils.clone(UniformsLib.fog),
    uTime: shared.uTime,
    uKeyDir: shared.uKeyDir,
    uKeyColor: shared.uKeyColor,
    uAmbient: shared.uAmbient,
    uIntensity: { value: 1 },
    ...extra,
  }
}

export interface SheetOptions {
  /** the flow field driving this surface */
  field: FieldBinding
  /** world size of lava features (the colossal island's lava runs larger) */
  scale?: number
  /** beyond this distance a cheaper single-advection model takes over */
  lod?: number
  /** crust plate frequency (smaller = bigger plates) */
  plates?: number
}

/**
 * A molten surface: lake, rivers and pools, plus the seams glowing between the
 * stones laid over it. Close lava gets the full two-layer flow model; far lava
 * a cheaper one (blended across a band so no seam shows).
 */
export function createLavaSheetMaterial(o: SheetOptions) {
  return new ShaderMaterial({
    fog: true,
    uniforms: uniforms({
      uFlowField: { value: o.field.texture },
      uFieldBounds: { value: new Vector4(...o.field.bounds) },
      uScale: { value: o.scale ?? 1 },
      uLod: { value: o.lod ?? 30 },
      uPlates: { value: o.plates ?? 1.15 },
      uRipples: shared.uRipples,
      uHotSpot: shared.uHotSpot,
    }),
    vertexShader: /* glsl */ `
${COMMON_VERT}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uFlowField;
uniform vec4 uFieldBounds;
uniform float uScale;
uniform float uLod;
uniform float uPlates;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform vec4 uHotSpot;

void main() {
  vec2 fuv = (vWorld.xz - uFieldBounds.xy) / uFieldBounds.zw;
  vec4 ff = texture2D(uFlowField, fuv);
  vec2 vel = ff.xy;
  float heat = ff.z;
  float molten = clamp(ff.w, 0.0, 1.0);

  float ripple = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.5) continue;
    float d = distance(vWorld.xz, r.xy) / uScale;
    ripple += exp(-pow((d - age * 1.25) / (0.12 + age * 0.05), 2.0)) * exp(-age * 1.3) * r.w;
    ripple += exp(-d * d * 6.0) * exp(-age * 3.0) * r.w * 0.8;
  }
  float hot = uHotSpot.w * exp(-dot(vWorld.xz - uHotSpot.xy, vWorld.xz - uHotSpot.xy) / (uHotSpot.z * uHotSpot.z));

  vec2 pp = vWorld.xz / uScale;
  vec2 vv = vel / uScale;
  float dist = length(vWorld - cameraPosition);
  LwLava l;
  if (molten > 0.01) {
    float speed = length(vv);
    float coverage = mix(0.98, 0.42, molten) - 0.35 * smoothstep(0.15, 0.55, speed);
    coverage = clamp(coverage - ripple * 1.5 - hot * 0.4, 0.0, 1.0);
    float far = smoothstep(uLod, uLod * 1.3, dist);
    if (far < 0.999) l = lw_flowLava(pp, vv, coverage, 0.04 * heat, uTime, uPlates);
    if (far > 0.001) {
      LwLava f = lw_flowLavaLite(pp, vv, coverage, 0.04 * heat, uTime);
      if (far >= 0.999) l = f;
      else {
        l.temp = mix(l.temp, f.temp, far);
        l.crust = mix(l.crust, f.crust, far);
        l.height = mix(l.height, f.height, far);
      }
    }
    // where the lava slips under stone, blend toward the glow seen through the seams
    float seam = (0.18 + 0.55 * heat) * (0.75 + 0.25 * lw_snoise(vec3(pp * 1.3, uTime * 0.15)));
    l.temp = mix(seam, l.temp, smoothstep(0.0, 0.5, molten));
    l.crust *= smoothstep(0.0, 0.5, molten);
  } else {
    float n = lw_fbm(vec3(pp * 0.9, uTime * 0.12), 2);
    l.temp = (0.16 + 0.62 * heat) * (0.72 + 0.28 * n);
    l.crust = 0.0;
    l.height = 0.0;
  }
  l.temp += ripple * 0.45 + hot * 0.3;

  vec3 n = lw_bumpNormal(normalize(vNormalW), vWorld, l.height * uScale, 1.0);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 col = lw_shadeLava(l, n, viewDir, uKeyDir, uKeyColor, uAmbient, uIntensity);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`,
  })
}

/** Lava falls: ribbons whose `aFlow.x` is travel time, so speed varies smoothly down the fall. */
export function createLavaFallMaterial() {
  return new ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
    blending: NormalBlending,
    uniforms: uniforms({ uFlowScale: { value: 0.5 } }),
    vertexShader: /* glsl */ `
${COMMON_VERT}
attribute vec4 aFlow;
attribute float aHalfWidth;
varying vec4 vFlow;
varying float vHalfWidth;
void main() {
  vFlow = aFlow;
  vHalfWidth = aHalfWidth;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
${COMMON_FRAG}
uniform float uFlowScale;
varying vec4 vFlow;
varying float vHalfWidth;
void main() {
  float phi = vFlow.x;
  float across = vFlow.y;
  float fall = vFlow.z;
  float fade = vFlow.w;
  vec2 q = vec2((phi - uTime) * uFlowScale * 2.2, across * vHalfWidth);
  LwLava l = lw_fallLava(q, across, uTime, fall);

  float edgeN = lw_snoise(vec2(q.x * 0.9, across * 2.0 + 5.0));
  float alpha = 1.0 - smoothstep(0.72 + 0.14 * edgeN, 1.0, abs(across));
  // the stream tears into droplets near the end
  float tear = lw_snoise(vec2(q.x * 1.6, across * 3.0 - 2.0)) * 0.5 + 0.5;
  alpha *= smoothstep(0.0, 0.35, fade - tear * (1.0 - fade) * 0.9);
  if (alpha < 0.02) discard;

  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  n = lw_bumpNormal(n, vWorld, l.height, 1.0);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 col = lw_shadeLava(l, n, viewDir, uKeyDir, uKeyColor, uAmbient, uIntensity);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`,
  })
}

/** Inner molten core of the stone digits, seen through the joints between blocks. */
export function createCoreMaterial() {
  return new ShaderMaterial({
    fog: true,
    uniforms: uniforms({ uGlow: { value: 0 } }),
    vertexShader: /* glsl */ `
${COMMON_VERT}
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
${COMMON_FRAG}
uniform float uGlow;
varying vec3 vObj;
void main() {
  float n = lw_fbm(vec3(vObj * 1.7 + vec3(0.0, -uTime * 0.25, 0.0)), 3);
  float temp = 0.66 + 0.2 * n + 0.38 * uGlow;
  gl_FragColor = vec4(lw_lavaEmission(temp) * uIntensity, 1.0);
  #include <fog_fragment>
}`,
  })
}
