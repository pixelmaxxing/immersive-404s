/**
 * Two deprecation notices come from dependencies and can't be fixed from this
 * codebase; everything else passes through untouched.
 *  - @react-three/fiber 9 still constructs THREE.Clock, deprecated in three r18x
 *  - @dimforge/rapier3d-compat boots its inlined WASM with the legacy
 *    wasm-bindgen init signature
 * (Deliberately dependency-free so it doesn't pull three into the entry chunk.)
 */
const UPSTREAM_NOTICES = [
  'THREE.Clock: This module has been deprecated',
  'using deprecated parameters for the initialization function',
]

const warn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  const msg = args[0]
  if (typeof msg === 'string' && UPSTREAM_NOTICES.some((n) => msg.includes(n))) return
  warn(...args)
}
