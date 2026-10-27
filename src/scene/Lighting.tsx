import { Environment, Lightformer } from '@react-three/drei'
import { useLayoutEffect, useRef } from 'react'
import { Box3, Matrix4, Vector3, type DirectionalLight } from 'three'
import { shared } from '../materials/shared'

/**
 * Lighting plan (seen from the ground)
 *  key   — cool moonlight from over your left shoulder: shapes the stones and
 *          the faces of the 404, casts the shadows
 *  rim   — warm backlight from the fires behind the island, peeling the digits
 *          and the island's edge off the smoke
 *  lake  — the lava lake lights everything facing it (in the stone shader),
 *          turning the island's underside into a glowing ceiling
 *  fill  — restrained hemisphere; IBL softbox + lava glow for bevel sheen
 */
const SHADOW_BOUNDS = new Box3(new Vector3(-31, -1, -74), new Vector3(31, 26, 17))
const TARGET = new Vector3(0, 6, -26)

export function Lighting() {
  const key = useRef<DirectionalLight>(null)
  const keyDir = shared.uKeyDir.value

  useLayoutEffect(() => {
    const light = key.current
    if (!light) return
    light.position.copy(TARGET).addScaledVector(keyDir, 80)
    light.target.position.copy(TARGET)
    light.target.updateMatrixWorld()
    light.updateMatrixWorld()
    // fit the orthographic shadow frustum to the playable world, seen from the light
    const view = new Matrix4().lookAt(light.position, TARGET, new Vector3(0, 1, 0)).setPosition(light.position).invert()
    const box = new Box3()
    const p = new Vector3()
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? SHADOW_BOUNDS.max.x : SHADOW_BOUNDS.min.x, i & 2 ? SHADOW_BOUNDS.max.y : SHADOW_BOUNDS.min.y, i & 4 ? SHADOW_BOUNDS.max.z : SHADOW_BOUNDS.min.z)
      box.expandByPoint(p.applyMatrix4(view))
    }
    const cam = light.shadow.camera
    cam.left = box.min.x
    cam.right = box.max.x
    cam.bottom = box.min.y
    cam.top = box.max.y
    cam.near = Math.max(0.5, -box.max.z)
    cam.far = -box.min.z
    cam.updateProjectionMatrix()
  }, [keyDir])

  return (
    <>
      <directionalLight
        ref={key}
        intensity={2.9}
        color="#dfe6f2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.06}
        shadow-radius={2.5}
      />
      <directionalLight position={[8, 40, -150]} intensity={1.35} color="#ff9a5a" />
      <directionalLight position={[-30, 10, 30]} intensity={0.3} color="#9fb2d6" />
      <hemisphereLight args={['#3a4352', '#2a120a', 0.32]} />
      <Environment resolution={128} frames={1} environmentIntensity={0.42}>
        <color attach="background" args={['#020202']} />
        <Lightformer form="rect" intensity={2.0} color="#dfe6f2" position={[-6, 9, 8]} scale={[10, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#ff8a4a" position={[0, 6, -12]} scale={[14, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={1.8} color="#ff5a18" position={[0, -8, 0]} rotation-x={-Math.PI / 2} scale={16} />
      </Environment>
    </>
  )
}
