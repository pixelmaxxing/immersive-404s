import { Color, MeshStandardMaterial, Vector3, Vector4, type IUniform } from 'three'
import { LAVA_RAMP_GLSL } from './glsl/lavaRamp'
import { NOISE_GLSL } from './glsl/noise'
import { BLANK_FIELD, MAX_EMITTERS, shared, type FieldBinding } from './shared'

/**
 * Stylized volcanic stone.
 *
 * A MeshStandardMaterial extended with:
 *  - layered procedural albedo (patches, mottling, strata) + per-stone tint
 *  - procedural bump via screen-space derivatives
 *  - edge wear on bevel crests (vertex aEdge + normal curvature)
 *  - embedded cracks that glow where the stone is hot
 *  - lava bounce light from capsule emitters + warm light rising from the lake
 *  - glowing seams where basalt columns meet the molten sheet
 */
export interface RockOptions {
  dark: string
  light: string
  roughness?: number
  /** overall crack density (0 = none) */
  crack?: number
  crackScale?: number
  /** crack density on cold stone */
  crackBase?: number
  /** edge wear strength */
  wear?: number
  bump?: number
  /** lava below the stones (its flow field): seams between columns glow with its heat */
  field?: FieldBinding
  /** height of that lava surface, and the width of the glowing band on the column sides */
  seamY?: number
  seamWidth?: number
  /** world-size multiplier for detail fades (big monuments keep their texture farther away) */
  detailScale?: number
  /** which lava emitters can reach this stone: [first, count] (default: all) */
  emitters?: [number, number]
  /** distance beyond which fractures use the cheap far approximation */
  crackLod?: number
  /** pattern scale */
  texScale?: number
  /** geometry carries aBlock: blocks can be displaced independently (monument masonry) */
  blocks?: number
}

export type RockMaterial = MeshStandardMaterial & {
  userData: {
    uniforms: Record<string, IUniform>
  }
}

export function createRockMaterial(o: RockOptions): RockMaterial {
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: o.roughness ?? 0.86,
    metalness: 0,
    envMapIntensity: 1,
  }) as RockMaterial

  const local = {
    uRockDark: { value: new Color(o.dark) },
    uRockLight: { value: new Color(o.light) },
    uCrack: { value: o.crack ?? 0.4 },
    uCrackScale: { value: o.crackScale ?? 0.9 },
    /** cracks present even on cold stone (monuments); 0 = only where hot */
    uCrackBase: { value: o.crackBase ?? 0.04 },
    uWear: { value: o.wear ?? 0.7 },
    uBump: { value: o.bump ?? 0.022 },
    uSeam: { value: o.field ? 1 : 0 },
    uFlowField: { value: (o.field ?? BLANK_FIELD).texture },
    uFieldBounds: { value: new Vector4(...(o.field ?? BLANK_FIELD).bounds) },
    uSeamY: { value: o.seamY ?? -0.15 },
    uSeamWidth: { value: o.seamWidth ?? 0.13 },
    uDetailScale: { value: o.detailScale ?? 1 },
    uEmitRange: { value: o.emitters ? [o.emitters[0], o.emitters[0] + o.emitters[1]] : [0, MAX_EMITTERS] },
    uCrackLod: { value: o.crackLod ?? 27 },
    uTexScale: { value: o.texScale ?? 1 },
    /** extra crack glow driven by interaction (hover/click) */
    uGlow: { value: 0 },
    /** per-block displacement (monument jostle) */
    uBlockOffset: { value: Array.from({ length: Math.max(1, o.blocks ?? 1) }, () => new Vector3()) },
  }
  material.userData.uniforms = { ...shared, ...local }

  const defines = [`#define LW_MAX_EMITTERS ${MAX_EMITTERS}`]
  if (o.blocks) defines.push(`#define LW_BLOCKS ${o.blocks}`)
  const variant = `rock-blocks-${o.blocks ?? 0}`
  material.customProgramCacheKey = () => variant

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData.uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
${defines.join('\n')}
attribute float aEdge;
attribute float aSeed;
attribute float aHeat;
attribute float aAO;
varying float vAO;
#ifdef LW_BLOCKS
attribute float aBlock;
uniform vec3 uBlockOffset[LW_BLOCKS];
#endif
varying float vEdge;
varying float vSeed;
varying float vHeat;
varying vec3 vRockObj;
varying vec3 vRockWorld;
varying vec3 vRockNormalW;
varying vec3 vRockNormalObj;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef LW_BLOCKS
transformed += uBlockOffset[int(aBlock + 0.5)];
#endif
vEdge = aEdge;
vSeed = aSeed;
vHeat = aHeat;
vAO = aAO;
vec4 lwWorld = vec4(transformed, 1.0);
vec3 lwN = objectNormal;
vRockObj = transformed;
vRockNormalObj = objectNormal;
#ifdef USE_INSTANCING
  lwWorld = instanceMatrix * lwWorld;
  lwN = mat3(instanceMatrix) * lwN;
  vRockObj += instanceMatrix[3].xyz * 1.37;
#endif
lwWorld = modelMatrix * lwWorld;
vRockWorld = lwWorld.xyz;
vRockNormalW = normalize(mat3(modelMatrix) * lwN);`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
${defines.join('\n')}
uniform float uTime;
uniform vec4 uLavaA[LW_MAX_EMITTERS];
uniform vec4 uLavaB[LW_MAX_EMITTERS];
uniform vec3 uLavaColor;
uniform float uLakeY;
uniform vec3 uLakeColor;
uniform float uLakeStrength;
uniform vec3 uHeatColor;
uniform sampler2D uFlowField;
uniform vec4 uFieldBounds;
uniform float uSeamY;
uniform float uSeamWidth;
uniform float uDetailScale;
uniform ivec2 uEmitRange;
uniform float uCrackLod;
uniform vec3 uRockDark;
uniform vec3 uRockLight;
uniform float uCrack;
uniform float uCrackScale;
uniform float uCrackBase;
uniform float uWear;
uniform float uBump;
uniform float uSeam;
uniform float uTexScale;
uniform float uGlow;
varying float vEdge;
varying float vSeed;
varying float vHeat;
varying float vAO;
varying vec3 vRockObj;
varying vec3 vRockWorld;
varying vec3 vRockNormalW;
varying vec3 vRockNormalObj;
${NOISE_GLSL}
${LAVA_RAMP_GLSL}
`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 lwP = vRockObj * uTexScale;
float lwLarge = lw_fbm(lwP * 0.21, 2);
float lwMid = lw_snoise(lwP * 1.3);
// fine mottling is sub-pixel far away: skip it there
float lwFine = length(vViewPosition) < 34.0 * uDetailScale ? lw_snoise(lwP * 4.6 + 3.1) : 0.0;
float lwStrata = lw_snoise(vec2(lwP.x * 0.3 + lwP.z * 0.21, lwP.y * 2.6));

// --- lava emitters: one pass computes both heat and bounce light ---
float lwHeat = vHeat;
float lwLavaIrr = 0.0;
{
  vec3 nw = normalize(vRockNormalW);
  for (int i = 0; i < LW_MAX_EMITTERS; i++) {
    if (i < uEmitRange.x) continue;
    if (i >= uEmitRange.y) break;
    vec4 A = uLavaA[i];
    vec4 B = uLavaB[i];
    if (B.w <= 0.0) continue;
    vec3 ab = B.xyz - A.xyz;
    float h = clamp(dot(vRockWorld - A.xyz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    vec3 L = A.xyz + ab * h - vRockWorld;
    float d2 = dot(L, L);
    float range = A.w * 3.6;
    if (d2 > range * range) continue;
    float d = sqrt(d2);
    L /= max(d, 1e-4);
    lwHeat += B.w * exp(-d2 * 3.2) * 0.55;
    float wrap = clamp(dot(nw, L) * 0.75 + 0.25, 0.0, 1.0);
    float att = 1.0 / (1.0 + d2 / (A.w * A.w));
    att *= 1.0 - smoothstep(A.w * 2.2, range, d);
    lwLavaIrr += B.w * wrap * att;
  }
}
float lwSeamHeat = 0.0;
if (uSeam > 0.5) {
  vec2 lwFuv = (vRockWorld.xz - uFieldBounds.xy) / uFieldBounds.zw;
  if (lwFuv.x > 0.0 && lwFuv.x < 1.0 && lwFuv.y > 0.0 && lwFuv.y < 1.0) {
    lwSeamHeat = texture2D(uFlowField, lwFuv).z;
  }
}
lwHeat = clamp(lwHeat, 0.0, 1.5);

// --- fine detail: grain + vesicle pits, faded with distance to avoid shimmer ---
float lwDist = length(vViewPosition);
float lwDetail = 1.0 - smoothstep(9.0 * uDetailScale, 21.0 * uDetailScale, lwDist);
vec3 lwAn = abs(vRockNormalObj);
vec2 lwPlane = (lwAn.z > lwAn.x && lwAn.z > lwAn.y) ? lwP.xy : ((lwAn.x > lwAn.y) ? lwP.zy : lwP.xz);
float lwGrain = 0.0;
float lwPit = 0.0;
if (lwDetail > 0.01) {
  lwGrain = lw_snoise(lwP * 13.0) * lwDetail;
  float f1 = lw_cellF1(lwPlane * 6.0 + vSeed * 13.0);
  float pr = 0.06 + 0.07 * lw_hash12(floor(lwPlane * 6.0 + vSeed * 13.0));
  lwPit = (1.0 - smoothstep(pr * 0.5, pr, f1)) * smoothstep(0.3, 0.75, lw_snoise(lwP * 0.8 + 4.0)) * lwDetail;
}

// --- albedo ---
float lwTone = clamp(0.5 + 0.62 * lwLarge + 0.08 * lwMid + 0.07 * lwFine + 0.1 * lwStrata, 0.0, 1.0);
vec3 lwAlbedo = mix(uRockDark, uRockLight, lwTone);
lwAlbedo *= 0.84 + 0.32 * vSeed;
// each stone leans a little warmer (iron-rich) or cooler (ashen)
float lwHue = fract(vSeed * 7.31) - 0.5;
lwAlbedo *= vec3(1.0 + 0.09 * lwHue, 1.0, 1.0 - 0.1 * lwHue);
lwAlbedo *= 1.0 + 0.09 * lwGrain;
lwAlbedo *= 1.0 - 0.45 * lwPit;
// soot and heat discolouration near lava
lwAlbedo = mix(lwAlbedo, lwAlbedo * vec3(0.62, 0.5, 0.46), clamp(lwHeat * 0.6, 0.0, 0.7));
// edge wear on bevel crests, patchy like chipped stone
float lwCurv = clamp(length(fwidth(vRockNormalW)) * 1.6 - 0.04, 0.0, 1.0);
float lwChip = lwDetail > 0.01 ? smoothstep(-0.35, 0.45, lw_snoise(lwP * 5.3 + 2.0)) : 0.7;
float lwEdge = clamp(max(vEdge, lwCurv), 0.0, 1.0) * (0.45 + 0.55 * lwChip);
lwAlbedo = mix(lwAlbedo, lwAlbedo * 1.8 + vec3(0.011, 0.0095, 0.0085), lwEdge * uWear);
lwAlbedo *= 0.84 + 0.16 * smoothstep(-0.7, 0.5, lwFine);

// --- cracks: tapered fractures along Voronoi borders, glowing where hot ---
float lwCrack = 0.0;
float lwCrackCore = 0.0;
float lwCrackRim = 0.0;
float lwCrackAmt = clamp(uCrack * (uCrackBase + lwHeat * 1.5) + uGlow * 0.3, 0.0, 1.0);
// far away fractures are a couple of pixels wide: a cheap approximation reads the same
float lwCrackFar = smoothstep(uCrackLod * 0.9, uCrackLod * 1.1, lwDist);
if (lwCrackAmt > 0.03 && lwCrackFar > 0.99) {
  // far away: cheap ridge-noise fractures read the same at a few pixels wide
  vec2 cp = lwPlane * uCrackScale * 2.4;
  float sel = smoothstep(0.62 - lwCrackAmt * 0.6, 0.9 - lwCrackAmt * 0.5, lw_snoise(cp * 0.37 + 3.0) * 0.5 + 0.5);
  float r = abs(lw_snoise(cp * 0.9 + 1.7));
  float w = (0.03 + 0.06 * lwCrackAmt) * sel;
  lwCrack = 1.0 - smoothstep(w * 0.3, w + 1e-4, r);
  lwCrackCore = lwCrack * 0.6;
  lwCrackRim = (1.0 - smoothstep(w, w * 3.0 + 0.03, r)) * sel;
  lwAlbedo *= 1.0 - 0.9 * lwCrack;
} else if (lwCrackAmt > 0.03) {
  vec2 cp = lwPlane * uCrackScale * 2.4;
  // low-frequency warp: straight runs with the odd kink, not squiggles
  vec2 warp = vec2(lw_snoise(cp * 0.8), lw_snoise(cp * 0.8 + 17.3)) * 0.16;
  vec2 jag = vec2(lw_snoise(cp * 6.0), lw_snoise(cp * 6.0 + 4.1)) * 0.012;
  vec3 v = lw_voronoi(cp + warp + jag);
  float sel = smoothstep(0.62 - lwCrackAmt * 0.6, 0.9 - lwCrackAmt * 0.5, lw_snoise(cp * 0.37 + 3.0) * 0.5 + 0.5);
  // width swells and tapers along the crack; ends taper to nothing
  float wn = 0.45 + 0.55 * smoothstep(-0.6, 0.6, lw_snoise(cp * 2.2 + 5.0));
  float w = (0.02 + 0.05 * lwCrackAmt) * wn * sel;
  lwCrack = 1.0 - smoothstep(w * 0.35, w + 1e-4, v.y);
  lwCrackCore = 1.0 - smoothstep(0.0, w * 0.45 + 1e-4, v.y);
  lwCrackRim = (1.0 - smoothstep(w, w * 4.0 + 0.03, v.y)) * sel;
  // hairline cracks branching near the main fractures
  float hair = 1.0 - smoothstep(0.0, 0.035, abs(lw_snoise(cp * 2.6 + warp * 3.0 + 9.0)));
  lwCrack = max(lwCrack, hair * lwCrackRim * smoothstep(0.35, 0.75, lwCrackAmt) * 0.6);
  lwAlbedo *= 1.0 - 0.9 * lwCrack;
  lwAlbedo = mix(lwAlbedo, lwAlbedo * vec3(0.45, 0.32, 0.28), lwCrackRim * 0.6);
}
diffuseColor.rgb = lwAlbedo * vAO;
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + 0.08 * lwMid - 0.28 * lwEdge * uWear - 0.25 * lwCrack, 0.32, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  float h = lwMid * 0.38 + lwFine * 0.26 + lwStrata * 0.3 + lwGrain * 0.1 - lwPit * 0.4 - lwCrack * 0.9 - lwCrackRim * 0.25;
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  float fade = 1.0 - smoothstep(18.0 * uDetailScale, 45.0 * uDetailScale, length(vViewPosition));
  normal = normalize(abs(det) * normal - grad * uBump * fade);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
{
  if (lwCrack > 0.001) {
    float flick = 0.82 + 0.18 * sin(uTime * 1.7 + lwP.x * 1.3 + lwP.z * 0.7) * sin(uTime * 2.9 + lwP.y * 2.1);
    // segments vary in temperature; the thin core is hottest
    float seg = 0.75 + 0.25 * lw_snoise(lwPlane * 1.7 + 11.0);
    float crackT = (0.62 + 0.34 * lwCrackCore) * seg + 0.18 * lwHeat + 0.2 * uGlow;
    totalEmissiveRadiance += lw_lavaEmission(crackT) * lwCrack * flick * (1.25 + uGlow * 1.8);
  }
  totalEmissiveRadiance += uHeatColor * (pow(clamp(lwHeat, 0.0, 1.2), 2.0) * 0.28 + lwCrackRim * lwCrackAmt * 0.45 * (1.0 + uGlow));
  // seams: column sides lit by lava running in the gaps
  if (lwSeamHeat > 0.02) {
    float side = 1.0 - abs(vRockNormalW.y);
    float band = exp(-pow((vRockWorld.y - uSeamY) / uSeamWidth, 2.0)) * step(vRockWorld.y, uSeamY + uSeamWidth * 4.0);
    float seamN = 0.7 + 0.3 * lw_snoise(vRockWorld * 2.3 + uTime * 0.2);
    totalEmissiveRadiance += lw_lavaEmission(0.38 + 0.3 * lwSeamHeat) * pow(lwSeamHeat, 1.6) * side * band * seamN * 1.3;
  }
}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
{
  vec3 nw = inverseTransformDirection(normal, viewMatrix);
  vec3 lavaLight = uLavaColor * lwLavaIrr;
  // the lava lake lights everything that faces it: undersides most, sides partly
  float facing = clamp(0.5 - 0.5 * nw.y, 0.0, 1.0);
  float above = max(vRockWorld.y - uLakeY, 0.0);
  lavaLight += uLakeColor * uLakeStrength * pow(facing, 1.25) * (0.5 + 0.5 * exp(-above / 9.0));
  reflectedLight.directDiffuse += lavaLight * BRDF_Lambert(material.diffuseColor);
}`,
      )
  }

  return material
}

/** Palette presets */
export const ROCK_PRESETS = {
  basalt: { dark: '#1a1512', light: '#5a4d43', roughness: 0.86, crack: 0.4, crackBase: 0.0, crackScale: 0.75, wear: 0.8 },
  monument: { dark: '#342c26', light: '#807164', roughness: 0.8, crack: 0.5, crackBase: 0.24, crackScale: 0.55, wear: 0.95 },
  ruin: { dark: '#25201c', light: '#665a4f', roughness: 0.88, crack: 0.25, crackBase: 0.05, crackScale: 0.8, wear: 0.85 },
} satisfies Record<string, RockOptions>
