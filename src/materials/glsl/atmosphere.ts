import { Color } from 'three'

/**
 * Atmosphere model shared by the sky dome and every fogged material, so distant
 * geometry dissolves into exactly the colour of the sky behind it.
 */
const lin = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`
}

export const ATMOSPHERE = {
  zenith: '#050405',
  /** the horizon glows with the lava sea reflected in smoke */
  horizon: '#180a07',
  /** looking down at the far lake through the haze */
  low: '#2b1109',
  density: 0.0075,
}

export const ATMOSPHERE_GLSL = /* glsl */ `
#ifndef LW_ATMOSPHERE
#define LW_ATMOSPHERE
const vec3 LW_ZENITH = ${lin(ATMOSPHERE.zenith)};
const vec3 LW_HORIZON = ${lin(ATMOSPHERE.horizon)};
const vec3 LW_LOW = ${lin(ATMOSPHERE.low)};

vec3 lw_skyColor(vec3 dir) {
  float y = dir.y;
  vec3 c = mix(LW_HORIZON, LW_ZENITH, smoothstep(0.0, 0.42, y));
  return mix(c, LW_LOW, smoothstep(0.0, -0.2, y));
}

vec3 lw_applyAtmosphere(vec3 color, vec3 wpos, float density) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  // distance haze: crisp nearby, swallowing the horizon
  float fd = 1.0 - exp(-dist * density);
  fd = fd * fd;
  // smoke hanging low over the lava
  float low = 1.0 - smoothstep(0.0, 14.0, wpos.y);
  float fh = low * (1.0 - exp(-dist * 0.011)) * 0.62;
  float f = clamp(max(fd, fh), 0.0, 1.0);
  return mix(color, lw_skyColor(dir), f);
}
#endif
`
