import { debugOff } from '../debug'
import { Arrows } from './archery/Arrows'
import { Bow } from './archery/Bow'
import { Victory } from './archery/Victory'
import { CameraRig } from './CameraRig'
import { Atmospherics } from './fx/Atmospherics'
import { Fire } from './fx/Fire'
import { Particles } from './fx/Particles'
import { Island } from './island/Island'
import { Lava } from './lava/Lava'
import { LavaLights } from './lava/LavaLights'
import { Lighting } from './Lighting'
import { Monument } from './monument/Monument'
import { PointerTracker } from './PointerTracker'
import { Debris } from './props/Debris'
import { Fragments } from './props/Fragments'
import { Islets } from './props/Islets'
import { LooseRocks } from './props/LooseRocks'
import { RockFall } from './props/RockFall'
import { Rubble } from './props/Rubble'
import { Sky } from './Sky'
import { Causeway } from './terrain/Causeway'
import { FarLands } from './terrain/FarLands'
import { Formations } from './terrain/Formations'
import { Stairs } from './terrain/Stairs'

export function Scene() {
  return (
    <>
      <CameraRig />
      <PointerTracker />
      {!debugOff('bow') && (
        <>
          <Bow />
          <Arrows />
          <Victory />
        </>
      )}
      <Lighting />
      <LavaLights />
      {!debugOff('sky') && <Sky />}
      {!debugOff('far') && <FarLands />}

      {!debugOff('causeway') && <Causeway />}
      {!debugOff('formations') && <Formations />}
      <Lava />
      {!debugOff('island') && <Island />}
      {!debugOff('monument') && <Monument />}
      <Stairs />
      {!debugOff('islets') && <Islets />}
      <Fragments />
      {!debugOff('rubble') && <Rubble />}

      <LooseRocks />
      <Debris />
      <RockFall />

      {!debugOff('fire') && <Fire />}
      {!debugOff('atmos') && <Atmospherics />}
      {!debugOff('particles') && <Particles />}
    </>
  )
}
