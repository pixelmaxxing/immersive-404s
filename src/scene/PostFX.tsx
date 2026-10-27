import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { debugOff } from '../debug'
import { Burn } from './fx/Burn'
import { Grade } from './fx/Grade'
import { HeatHaze } from './fx/HeatHaze'

/**
 * Post stack, in order:
 *  N8AO      — screen-space AO (ultra tier only; baked AO is always present)
 *  HeatHaze  — shimmer in the columns of hot air above the lava
 *  Bloom     — HDR threshold above 1.0, so only white-hot lava and sparks bloom
 *  ToneMap   — ACES: rich, saturated molten oranges and deep, contrasty stone
 *  Grade     — warm shadow lift, gentle S-curve
 *  Vignette  — gentle frame
 *  Burn      — the way home: impact shockwave, then the world burns away to white
 *  SMAA      — edge antialiasing
 */
const TONE: Record<string, ToneMappingMode> = {
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  neutral: ToneMappingMode.NEUTRAL,
}
const toneMode = TONE[new URLSearchParams(window.location.search).get('tm') ?? ''] ?? ToneMappingMode.ACES_FILMIC

/**
 * Ambient occlusion is baked into the stone geometry (gaps, contact with the
 * monument); screen-space AO is layered on top only on the "ultra" tier.
 */
export function PostFX({ ssao, aa }: { ssao: boolean; aa: boolean }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <>{ssao && !debugOff('ao') && <N8AO aoRadius={1.1} distanceFalloff={0.6} intensity={2.0} quality="performance" halfRes depthAwareUpsampling color="#060302" />}</>
      <>{!debugOff('haze') && <HeatHaze />}</>
      <>{!debugOff('bloom') && <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.25} intensity={0.7} radius={0.72} />}</>
      <ToneMapping mode={toneMode} />
      <Grade />
      <Vignette offset={0.28} darkness={0.62} />
      <Burn />
      <>{aa && !debugOff('smaa') && <SMAA />}</>
    </EffectComposer>
  )
}
