/**
 * Deterministic randomness. The whole world is generated from fixed seeds so
 * every visit shows the exact same art-directed composition.
 */
export class Rng {
  private state: number

  constructor(seed = 1) {
    this.state = seed >>> 0 || 1
  }

  /** mulberry32 — uniform float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** Approximately normal distribution (mean 0, deviation 1). */
  gauss(): number {
    const u = Math.max(this.next(), 1e-9)
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
