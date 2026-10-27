import { AdditiveBlending, Color, DoubleSide, MeshStandardMaterial, ShaderMaterial } from 'three'
import { shared } from '../../materials/shared'

export interface PropMaterialOptions {
  color: string
  roughness: number
  metalness?: number
  /** long wood grain along the uv's u (its frequency) */
  grain?: number
  /** spiral leather wrap */
  wrap?: boolean
  /** ember inlay along the back of a limb (uv v ≈ 0.25), driven by uInlay */
  inlay?: boolean
  /** bends the bow's limbs back as it's drawn (shared uniform, 0..1) */
  flex?: { value: number }
}

/** Where a point of the bow ends up when its limbs flex by `f` (matches the shader). */
export function flexPoint(x: number, y: number, z: number, f: number, out: { set(x: number, y: number, z: number): unknown }) {
  const k = Math.min(1, Math.max(0, (Math.abs(x) - 0.1) / 0.33))
  out.set(x * (1 - f * 0.05 * k), y, z + f * 0.075 * Math.pow(k, 1.6))
}

/**
 * Standard PBR material for hand-held things: the scene's key light and
 * environment, plus the lava lake's warm glow from below and optional
 * procedural detail. Every feature is a uniform, so all of them share a
 * single shader program.
 */
export function createPropMaterial(o: PropMaterialOptions) {
  const m = new MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness ?? 0 })
  const uniforms = {
    uLakeColor: shared.uLakeColor,
    uGrain: { value: o.grain ?? 0 },
    uWrap: { value: o.wrap ? 1 : 0 },
    uInlayOn: { value: o.inlay ? 1 : 0 },
    uInlay: { value: 0 },
    uInlayColor: { value: new Color('#ff6a1e') },
    uFlexOn: { value: o.flex ? 1 : 0 },
    uFlex: o.flex ?? { value: 0 },
  }
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlex;\nuniform float uFlexOn;\nvarying vec3 vPropNormal;\nvarying vec2 vPropUv;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvPropNormal = normalize(mat3(modelMatrix) * objectNormal);\nvPropUv = uv;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  if (uFlexOn > 0.5) {
    float flexK = clamp((abs(transformed.x) - 0.1) / 0.33, 0.0, 1.0);
    transformed.x *= 1.0 - uFlex * 0.05 * flexK;
    transformed.z += uFlex * 0.075 * pow(flexK, 1.6);
  }`,
      )
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uLakeColor;
uniform float uGrain;
uniform float uWrap;
uniform float uInlayOn;
uniform float uInlay;
uniform vec3 uInlayColor;
varying vec3 vPropNormal;
varying vec2 vPropUv;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (uGrain > 0.0) {
    float grain = sin(vPropUv.x * uGrain + sin(vPropUv.y * 25.0 + vPropUv.x * 9.0) * 1.7) * 0.5 + 0.5;
    diffuseColor.rgb *= 0.78 + 0.34 * grain * grain;
  }
  if (uWrap > 0.5) {
    float band = abs(fract(vPropUv.x * 15.0 + vPropUv.y) - 0.5) * 2.0;
    diffuseColor.rgb *= 0.62 + 0.45 * smoothstep(0.1, 0.45, band);
  }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  // the lava lake lights everything from below
  float below = clamp(-normalize(vPropNormal).y * 0.5 + 0.5, 0.0, 1.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uLakeColor * 0.55 * below * below;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if (uInlayOn > 0.5) {
    // a thin seam of embers along the limb, smouldering unevenly, flaring as it's drawn
    float line = 1.0 - smoothstep(0.006, 0.018, abs(vPropUv.y - 0.25));
    float smoulder = 0.45 + 0.55 * (0.5 + 0.5 * sin(vPropUv.x * 47.0 + sin(vPropUv.x * 13.0) * 2.3));
    float ends = smoothstep(0.03, 0.14, vPropUv.x) * (1.0 - smoothstep(0.9, 0.99, vPropUv.x));
    totalEmissiveRadiance += uInlayColor * line * smoulder * ends * (0.18 + uInlay * 1.7);
  }`,
      )
  }
  m.customProgramCacheKey = () => 'lw-prop'
  m.userData.uniforms = uniforms
  return m
}

/** Soft additive glow for a hot point (the arrowhead in flight); HDR so it blooms. */
export function createGlowMaterial(color = new Color(3.2, 1.25, 0.38)) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: color }, uIntensity: { value: 1 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv - 0.5;
  // camera-facing quad
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]));
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = length(vUv) * 2.0;
  float g = pow(max(0.0, 1.0 - d), 2.2) + 0.6 * pow(max(0.0, 1.0 - d), 8.0);
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}`,
  })
}

/** Fiery tracer ribbon: white-hot at the head, cooling to red, fading out. */
export function createTrailMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uFade: { value: 1 } },
    vertexShader: /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uFade;
varying float vAge;
varying float vSide;
void main() {
  float across = 1.0 - vSide * vSide;
  float a = pow(1.0 - clamp(vAge, 0.0, 1.0), 1.6) * across * uFade;
  vec3 hot = mix(vec3(3.0, 2.1, 1.1), vec3(2.2, 0.55, 0.12), smoothstep(0.0, 0.35, vAge));
  hot = mix(hot, vec3(0.7, 0.08, 0.02), smoothstep(0.35, 1.0, vAge));
  gl_FragColor = vec4(hot * a, 1.0);
}`,
  })
}
