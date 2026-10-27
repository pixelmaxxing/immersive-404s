import { Effect } from 'postprocessing'
import { useMemo } from 'react'
import { Uniform, Vector2, Vector4 } from 'three'

const fragment = /* glsl */ `
uniform float uTime;
uniform float uAspect;
uniform vec4 uShock;
uniform float uPunch;
uniform vec2 uOrigin;
uniform float uRadius;
uniform float uRough;
uniform float uBurn;

float bn_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bn_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bn_hash(i), bn_hash(i + vec2(1.0, 0.0)), f.x), mix(bn_hash(i + vec2(0.0, 1.0)), bn_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bn_fbm(vec2 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    s += a * bn_noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// signed distance to the burning edge, in screen heights: negative has burned through
float bn_front(vec2 uv) {
  vec2 q = (uv - uOrigin) * vec2(uAspect, 1.0);
  // big curling lobes and fine tatters, fixed to the screen so the edge never swims
  vec2 w = vec2(bn_fbm(q * 2.1 + 3.7, 3), bn_fbm(q * 2.1 - 5.3, 3));
  float n = bn_fbm(q * 3.0 + w * 1.7, 4) - 0.5;
  float fine = bn_fbm(q * 15.0 + w * 3.0, 3) - 0.5;
  return length(q) - uRadius + (n * 1.6 + fine * 0.35) * uRough;
}

void mainUv(inout vec2 uv) {
  // the impact's shockwave: a ring of refraction racing out from the strike
  if (uShock.w > 0.0 && uShock.z < 1.0) {
    vec2 q = (uv - uShock.xy) * vec2(uAspect, 1.0);
    float d = length(q);
    float k = (d - uShock.z * 0.8) / 0.08;
    if (abs(k) < 1.0) uv -= (q / max(d, 1e-4)) / vec2(uAspect, 1.0) * sin(k * 3.14159) * uShock.w * (1.0 - uShock.z) * (1.0 - uShock.z);
  }
  // hot air wavers just ahead of the burning edge
  if (uBurn > 0.0 && uBurn < 1.0) {
    float e = length((uv - uOrigin) * vec2(uAspect, 1.0)) - uRadius;
    float m = 1.0 - smoothstep(0.0, uRough + 0.1, abs(e));
    if (m > 0.0) uv += (vec2(bn_noise(uv * 70.0 + vec2(0.0, -uTime * 4.0)), bn_noise(uv * 70.0 + vec2(9.0, -uTime * 3.4))) - 0.5) * 0.007 * m;
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * (1.0 + uPunch);
  if (uBurn >= 1.0) {
    outputColor = vec4(1.0);
    return;
  }
  if (uBurn > 0.0) {
    float e = bn_front(uv);
    vec2 sq = (uv - uOrigin) * vec2(uAspect, 1.0);

    // ahead of the edge the picture scorches like old film: browning, then charred black
    float scorch = 1.0 - smoothstep(0.0, 0.13, e);
    float charred = 1.0 - smoothstep(0.004, 0.04, e);
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 brown = vec3(lum) * vec3(0.72, 0.46, 0.28);
    c = mix(c, brown, scorch * 0.75) * (1.0 - 0.94 * charred);
    // embers crawling through the char
    if (e > 0.0 && e < 0.05) {
      vec2 g = sq * 150.0;
      float h = bn_hash(floor(g));
      float flick = 0.5 + 0.5 * sin(uTime * 23.0 + h * 40.0);
      float dot1 = 1.0 - smoothstep(0.15, 0.4, length(fract(g) - 0.5));
      c += vec3(1.0, 0.42, 0.1) * dot1 * step(0.9, h) * flick * (1.0 - e / 0.05) * 1.4;
    }
    // the burning line itself, glowing out over the char
    float glow = e > 0.0 ? exp(-e / 0.008) : 0.0;
    c += vec3(1.0, 0.34, 0.05) * glow * 1.5;
    c += vec3(1.0, 0.82, 0.5) * (1.0 - smoothstep(0.0, 0.004, abs(e + 0.001)));

    // through the hole: white, still warm right behind the edge
    float through = 1.0 - smoothstep(-0.0016, 0.0016, e);
    vec3 home = mix(vec3(1.0), vec3(1.0, 0.8, 0.55), exp(min(e, 0.0) / 0.018) * 0.75);
    // a few flakes of ash lifting off the edge, drifting up over the white
    vec2 fp = sq * 40.0 + vec2(0.0, -uTime * 1.3);
    vec2 cell = floor(fp);
    float fh = bn_hash(cell);
    if (fh > 0.78) {
      vec2 o = vec2(bn_hash(cell + 7.1), bn_hash(cell + 3.3)) - 0.5;
      float fr = 0.08 + 0.12 * bn_hash(cell + 1.9);
      vec2 fq = fract(fp) - 0.5 - o * 0.45;
      float flake = 1.0 - smoothstep(fr * 0.55, fr, length(fq * vec2(1.0, 1.7)));
      float band = smoothstep(-0.075, -0.02, e) * (1.0 - smoothstep(-0.01, -0.002, e));
      home = mix(home, vec3(0.3, 0.25, 0.22), flake * band * 0.75);
    }
    c = mix(c, home, through);
  }
  outputColor = vec4(min(c, vec3(1.0)), inputColor.a);
}
`

/** Driven by the victory sequence (<Victory />). */
export const burnUniforms = {
  /** real seconds, for flicker and drift */
  uTime: new Uniform(0),
  uAspect: new Uniform(1),
  /** shockwave: origin (uv), progress 0..1, strength */
  uShock: new Uniform(new Vector4(0.5, 0.5, 1, 0)),
  /** brief exposure lift as the arrow strikes */
  uPunch: new Uniform(0),
  /** where the hole burns open (uv), how far its edge has run (screen heights) and how ragged it is */
  uOrigin: new Uniform(new Vector2(0.5, 0.5)),
  uRadius: new Uniform(0),
  uRough: new Uniform(0.05),
  /** 0 = nothing burning, 0..1 under way, 1 = all white */
  uBurn: new Uniform(0),
}

export class BurnEffect extends Effect {
  constructor() {
    super('BurnEffect', fragment, { uniforms: new Map<string, Uniform>(Object.entries(burnUniforms)) })
  }
}

/**
 * The way out: the impact's shockwave, then the world burning away like old
 * film, from where the arrow struck, until only white (home) is left. Last
 * in the chain, so white is exactly white.
 */
export function Burn() {
  const effect = useMemo(() => new BurnEffect(), [])
  return <primitive object={effect} dispose={null} />
}
