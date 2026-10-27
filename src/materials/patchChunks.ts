import { ShaderChunk } from 'three'
import { ATMOSPHERE_GLSL } from './glsl/atmosphere'

/**
 * Replaces three.js' fog with the world's atmosphere model (distance fog that
 * matches the sky colour + a warm haze deep below the island). Applies to every
 * material rendered while `scene.fog` is set.
 */
let patched = false
export function patchShaderChunks() {
  if (patched) return
  patched = true
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vLwFogWorld;
#endif
`
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vLwFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vLwFogWorld;
  ${ATMOSPHERE_GLSL}
#endif
`
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = lw_applyAtmosphere(gl_FragColor.rgb, vLwFogWorld, fogDensity);
#endif
`
}
