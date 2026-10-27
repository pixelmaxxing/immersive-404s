/**
 * Molten lava model.
 *
 * Two layers advected by a flow field:
 *  - the molten core: domain-warped fbm that slowly boils, with hot streaks
 *    stretched along the current
 *  - the cooling crust: Voronoi plates that form, drift, stretch and dissolve
 *
 * The flow-map technique (two phases offset by half a period) keeps advection
 * bounded; crust plates are tied to their phase so each plate is born, travels
 * with the current and melts away instead of cross-fading.
 */
export const LAVA_GLSL = /* glsl */ `
#ifndef LW_LAVA
#define LW_LAVA

struct LwLava {
  float temp;   // 0 cold crust … 1+ white hot
  float crust;  // 0 molten … 1 solid plate
  float height; // for bump shading
};

float lw_core(vec2 p, float t) {
  vec2 w = vec2(
    lw_fbm(vec3(p * 0.5, t * 0.05), 2),
    lw_fbm(vec3(p * 0.5 + vec2(7.3, -2.1), t * 0.05 + 3.1), 2)
  );
  return lw_fbm(vec3(p * 0.95 + w * 1.5, t * 0.09), 3);
}

/** crust plates; returns (plate mask, distance to plate border) */
vec2 lw_plates(vec2 p, float coverage, float scale, float t) {
  vec2 q = p * scale;
  q += 0.3 * vec2(lw_snoise(vec3(q * 0.6, t * 0.04)), lw_snoise(vec3(q * 0.6 + 9.1, t * 0.04 + 2.0)));
  vec3 v = lw_voronoi(q);
  float alive = smoothstep(v.z - 0.14, v.z + 0.14, coverage);
  float shrink = mix(0.42, 0.05, alive);
  float plate = smoothstep(shrink, shrink + 0.06, v.y) * step(0.02, alive);
  return vec2(plate, v.y);
}

/**
 * Samples flowing lava at \`pos\` with velocity \`vel\` (units/s).
 * coverage: how much crust can exist here (0..1); heat: extra temperature.
 */
LwLava lw_flowLava(vec2 pos, vec2 vel, float coverage, float heat, float t, float plateScale) {
  float speed = length(vel);
  vec2 dir = speed > 1e-4 ? vel / speed : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float phaseNoise = lw_snoise(pos * 0.23) * 0.35;

  // --- molten core (short period: lively turbulence) ---
  float Tc = 3.2;
  float tc = t / Tc + phaseNoise;
  float c0 = fract(tc), c1 = fract(tc + 0.5);
  float wc = 1.0 - abs(1.0 - 2.0 * c0);
  vec2 pa = pos - vel * c0 * Tc + vec2(floor(tc) * 0.371, floor(tc) * 0.713);
  vec2 pb = pos - vel * c1 * Tc + vec2(floor(tc + 0.5) * 0.371 + 0.5, floor(tc + 0.5) * 0.713 + 0.25);
  float na = lw_core(pa, t);
  float nb = lw_core(pb, t);
  float core = (na * wc + nb * (1.0 - wc)) / sqrt(wc * wc + (1.0 - wc) * (1.0 - wc));

  // hot streaks stretched along the current
  vec2 sa = vec2(dot(pa, dir) * 0.3, dot(pa, perp) * 1.6);
  vec2 sb = vec2(dot(pb, dir) * 0.3, dot(pb, perp) * 1.6);
  float stA = pow(1.0 - abs(lw_snoise(sa)), 4.0);
  float stB = pow(1.0 - abs(lw_snoise(sb)), 4.0);
  float streak = (stA * wc + stB * (1.0 - wc)) * smoothstep(0.03, 0.25, speed);

  float temp = 0.56 + 0.32 * core + 0.16 * streak + heat;

  // --- crust plates (long period: each plate lives one phase) ---
  float Tp = 4.6;
  float tp = t / Tp + phaseNoise * 0.6;
  float p0 = fract(tp), p1 = fract(tp + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * p0);
  float w1 = 1.0 - w0;
  vec2 qa = pos - vel * p0 * Tp + vec2(floor(tp) * 1.37, floor(tp) * 0.61);
  vec2 qb = pos - vel * p1 * Tp + vec2(floor(tp + 0.5) * 1.37 + 3.1, floor(tp + 0.5) * 0.61 + 1.7);
  vec2 A = lw_plates(qa, coverage * smoothstep(0.0, 0.45, w0), plateScale, t);
  vec2 B = lw_plates(qb, coverage * smoothstep(0.0, 0.45, w1), plateScale, t);
  float crust = max(A.x, B.x);
  float edge = A.x > B.x ? A.y : B.y;

  // plates are cold in the middle, glowing along their cracked rims
  float plateTemp = 0.04 + 0.22 * smoothstep(0.16, 0.0, edge) + 0.05 * core;
  float t2 = mix(temp, plateTemp, crust);

  LwLava l;
  l.temp = t2;
  l.crust = crust;
  l.height = crust * (0.05 + 0.03 * smoothstep(0.0, 0.2, edge)) + core * 0.012;
  return l;
}

/**
 * Cheap distant lava: two advection phases of rounded crust plates (cellular
 * F1) over a slow two-octave core. Used where the lake recedes into the haze.
 */
LwLava lw_flowLavaLite(vec2 pos, vec2 vel, float coverage, float heat, float t) {
  float T = 5.5;
  float tt = t / T;
  float p0 = fract(tt);
  float p1 = fract(tt + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * p0);
  vec2 qa = pos - vel * p0 * T + floor(tt) * vec2(1.37, 0.61);
  vec2 qb = pos - vel * p1 * T + floor(tt + 0.5) * vec2(1.37, 0.61) + vec2(3.1, 1.7);
  float thr = mix(0.2, 0.6, coverage);
  float fa = lw_cellF1(qa * 0.8);
  float fb = lw_cellF1(qb * 0.8);
  float plate = (1.0 - smoothstep(thr - 0.07, thr, fa)) * w0 + (1.0 - smoothstep(thr - 0.07, thr, fb)) * (1.0 - w0);
  float rim = smoothstep(thr - 0.22, thr, fa * w0 + fb * (1.0 - w0));
  float core = lw_fbm(vec3(pos * 0.35, t * 0.04), 2);
  LwLava l;
  l.temp = mix(0.58 + 0.3 * core + heat, 0.05 + 0.24 * rim, plate);
  l.crust = plate;
  l.height = plate * 0.05;
  return l;
}

/** Lava in ribbon space for falls: rigid layers moving along the ribbon. */
LwLava lw_fallLava(vec2 q, float across, float t, float fall) {
  // q.x: flow coordinate (already advected), q.y: lateral world units
  float profile = 1.0 - across * across;
  float n1 = lw_fbm(vec3(q.x * 0.55, q.y * 2.2, t * 0.15), 4);
  float n2 = lw_fbm(vec3((q.x - t * 0.6 * profile) * 0.8, q.y * 3.4 + 4.0, t * 0.2), 3);
  float streak = pow(1.0 - abs(lw_snoise(vec2(q.x * 0.22, q.y * 4.2 + 1.7))), 6.0);
  float temp = 0.52 + 0.24 * n1 + 0.14 * n2 + 0.3 * streak * profile + 0.22 * profile;
  // cooling skin: dark streaks dragged down the sheet, clinging to the edges
  float skinN = lw_fbm(vec2(q.x * 0.3, q.y * 3.1 - 2.0), 3);
  float skin = smoothstep(0.16, 0.42, skinN * 0.8 + 0.75 * pow(1.0 - profile, 1.5) - 0.3 * profile);
  vec3 v = lw_voronoi(vec2(q.x * 1.4, q.y * 2.0));
  float shards = smoothstep(0.08, 0.2, v.y) * smoothstep(0.9, 0.96, v.z) * (1.0 - 0.7 * profile);
  float crust = clamp(max(skin * 0.92, shards * 0.85), 0.0, 1.0);
  LwLava l;
  l.temp = mix(temp, 0.1 + 0.2 * n1 + 0.15 * streak, crust);
  l.crust = crust;
  l.height = crust * 0.04 + n1 * 0.02;
  return l;
}

/** Shades a lava sample: emissive molten lava + lit glassy crust. */
vec3 lw_shadeLava(LwLava l, vec3 n, vec3 viewDir, vec3 keyDir, vec3 keyColor, vec3 ambient, float intensity) {
  vec3 emission = lw_lavaEmission(l.temp) * intensity;
  // crust: dark glassy rock lit by the key light and by the glow underneath
  vec3 albedo = vec3(0.028, 0.022, 0.02);
  float ndl = max(dot(n, keyDir), 0.0);
  vec3 under = lw_lavaRamp(0.5) * 0.35;
  vec3 lit = albedo * (keyColor * ndl + ambient + under);
  vec3 h = normalize(keyDir + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * (0.06 + 0.25 * l.crust);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
  return emission + lit * l.crust + keyColor * spec * 0.6 + fres * 0.02 * l.crust;
}

vec3 lw_bumpNormal(vec3 n, vec3 wpos, float h, float strength) {
  vec3 dpdx = dFdx(wpos);
  vec3 dpdy = dFdy(wpos);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad * strength);
}
#endif
`
