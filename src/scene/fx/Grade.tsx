import { Effect } from 'postprocessing'
import { useMemo } from 'react'
import { Uniform } from 'three'

const fragment = /* glsl */ `
uniform float uLift;
uniform float uContrast;
uniform float uSaturation;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // warm, slightly lifted shadows — the darks read as charcoal, never pure digital black
  c += vec3(0.010, 0.0055, 0.0035) * uLift * (1.0 - smoothstep(0.0, 0.25, c));
  // gentle filmic S-curve in perceptual space
  vec3 p = pow(max(c, 0.0), vec3(1.0 / 2.2));
  p = mix(p, p * p * (3.0 - 2.0 * p), uContrast);
  c = pow(p, vec3(2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  outputColor = vec4(min(c, vec3(1.0)), inputColor.a);
}
`

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragment, {
      uniforms: new Map<string, Uniform>([
        ['uLift', new Uniform(1)],
        ['uContrast', new Uniform(0.14)],
        ['uSaturation', new Uniform(1.06)],
      ]),
    })
  }
}

/** Final colour grade, applied after tone mapping. */
export function Grade() {
  const effect = useMemo(() => new GradeEffect(), [])
  return <primitive object={effect} dispose={null} />
}
