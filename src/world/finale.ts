/**
 * How the winning shot plays out, in real seconds after the arrow strikes.
 * Shared by the scene (slow motion, the burn) and the page (text burning off,
 * leaving for home), so it stays free of three.js.
 *
 *  0.00  the arrow strikes: a beat of stillness (hit-stop)
 *  0.07  slow motion as the block shatters and the masonry gives way
 *  0.45  time eases back up to full speed; the other digits crumble
 *  2.00  a hole burns open where the arrow struck, its edge racing outward
 *  3.45  nothing is left but white: home
 */
export const FINALE = {
  hitStop: 0.07,
  slowScale: 0.2,
  slowUntil: 0.45,
  recoverUntil: 1.0,
  burnStart: 2.0,
  burnDuration: 1.45,
}

/** Without motion: no slow motion, and a short, quick burn. */
export const FINALE_REDUCED = { ...FINALE, burnStart: 0.9, burnDuration: 0.9 }

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/** How fast world time runs `r` real seconds after the strike. */
export function timeScaleAt(r: number) {
  const f = FINALE
  if (r < 0 || r >= f.recoverUntil) return 1
  if (r < f.hitStop) return 0.03
  if (r < f.slowUntil) return f.slowScale
  return f.slowScale + (1 - f.slowScale) * smooth((r - f.slowUntil) / (f.recoverUntil - f.slowUntil))
}

/**
 * Radius of the burn front, in screen heights, at progress `p` (0..1) of a burn
 * that has to get `reach` away from its origin: it catches, smoulders open,
 * then races out to the corners.
 */
export function burnRadius(p: number, reach: number) {
  const k = Math.min(1, Math.max(0, p))
  return reach * (0.06 * smooth(k / 0.12) + 0.94 * Math.pow(k, 2.3))
}

/** How ragged the front is at a given radius (screen heights). */
export const burnRoughness = (radius: number) => Math.min(0.24, 0.03 + radius * 0.42)

/** Distance (screen heights) the front must cover from `origin` (0..1 uv, y up) to clear the whole screen. */
export function burnReach(ox: number, oy: number, aspect: number) {
  let far = 0
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    far = Math.max(far, Math.hypot((x - ox) * aspect, y - oy))
  }
  // the ragged edge lags by up to its roughness, plus the scorched band ahead of it
  return far + 0.32
}
