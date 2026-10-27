import { interactionGroups } from '@react-three/rapier'

/** The physics world steps at a fixed rate; bodies are interpolated between steps. */
export const PHYSICS_STEP = 1 / 60
export const PHYSICS_GRAVITY = 9.81

/**
 * Collision groups. A future character controller should collide with
 * `walkable` (ground it can stand on) and `solid` (things it bumps into),
 * and can listen for `debris` to dodge falling rocks.
 */
export const LAYER = {
  walkable: 0,
  solid: 1,
  debris: 2,
  props: 3,
  character: 4,
} as const

export const GROUPS = {
  walkable: interactionGroups(LAYER.walkable, [LAYER.debris, LAYER.props, LAYER.character]),
  solid: interactionGroups(LAYER.solid, [LAYER.debris, LAYER.props, LAYER.character]),
  debris: interactionGroups(LAYER.debris, [LAYER.walkable, LAYER.solid, LAYER.props, LAYER.debris]),
  props: interactionGroups(LAYER.props, [LAYER.walkable, LAYER.solid, LAYER.debris, LAYER.props, LAYER.character]),
}
