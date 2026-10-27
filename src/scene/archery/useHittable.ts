import { useEffect, type RefObject } from 'react'
import type { Mesh } from 'three'
import { registerHittable, type Hittable } from '../../world/archery'

/** Lets arrows strike a mesh for as long as the component is mounted. */
export function useHittable(ref: RefObject<Mesh | null>, surface: Hittable['surface'], moving = false) {
  useEffect(() => {
    const mesh = ref.current
    return mesh ? registerHittable({ mesh, surface, moving }) : undefined
  }, [ref, surface, moving])
}
