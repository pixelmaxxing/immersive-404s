import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Plane, Raycaster, Vector3 } from 'three'
import { pointer } from '../world/interaction'

/**
 * Keeps the shared pointer ray (world space) up to date every frame. Mounted
 * after CameraRig so it sees this frame's camera.
 */
export function PointerTracker() {
  const gl = useThree((s) => s.gl)
  const raycaster = useMemo(() => new Raycaster(), [])
  const plane = useMemo(() => new Plane(), [])
  const normal = useMemo(() => new Vector3(), [])

  useEffect(() => {
    const el = gl.domElement
    const onMove = () => (pointer.active = true)
    const onLeave = () => (pointer.active = false)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [gl])

  useFrame((state) => {
    raycaster.setFromCamera(state.pointer, state.camera)
    pointer.ray.copy(raycaster.ray)
    // a vertical plane through the monument, facing the camera
    normal.set(state.camera.position.x, 0, state.camera.position.z).normalize()
    plane.setFromNormalAndCoplanarPoint(normal, new Vector3(0, 1.5, -1.8))
    raycaster.ray.intersectPlane(plane, pointer.world)
  })

  return null
}
