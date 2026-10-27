import { Color } from 'three'

const lin = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`
}

/** Temperature → colour, from cold crust to white-hot core. */
export const LAVA_PALETTE = {
  crust: '#0e0806',
  ember: '#3d0c04',
  deepRed: '#9c1d08',
  molten: '#f0520e',
  hot: '#ff9426',
  white: '#ffe2a0',
}

export const LAVA_RAMP_GLSL = /* glsl */ `
#ifndef LW_LAVA_RAMP
#define LW_LAVA_RAMP
vec3 lw_lavaRamp(float t) {
  t = clamp(t, 0.0, 1.25);
  vec3 c = mix(${lin(LAVA_PALETTE.crust)}, ${lin(LAVA_PALETTE.ember)}, smoothstep(0.0, 0.2, t));
  c = mix(c, ${lin(LAVA_PALETTE.deepRed)}, smoothstep(0.14, 0.4, t));
  c = mix(c, ${lin(LAVA_PALETTE.molten)}, smoothstep(0.34, 0.64, t));
  c = mix(c, ${lin(LAVA_PALETTE.hot)}, smoothstep(0.6, 0.88, t));
  c = mix(c, ${lin(LAVA_PALETTE.white)}, smoothstep(0.86, 1.15, t));
  return c;
}
/** Emitted radiance: cool crust barely glows, only the hottest lava exceeds bloom threshold. */
vec3 lw_lavaEmission(float t) {
  t = max(t, 0.0);
  return lw_lavaRamp(t) * (0.04 + 2.7 * pow(t, 2.4));
}
#endif
`
