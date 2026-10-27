/**
 * Development switches, read once from the URL:
 *   ?off=ao,bloom,smaa,haze,sheet,falls,sky,particles,shadows,fire,islets
 * Used for profiling and visual validation; inert in normal use.
 */
const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
const off = new Set((params.get('off') ?? '').split(',').filter(Boolean))

export const debugOff = (feature: string) => off.has(feature)
export const debugParam = (key: string) => params.get(key)
