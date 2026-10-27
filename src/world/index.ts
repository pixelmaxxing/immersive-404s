/**
 * Public world API — everything a future character controller needs.
 *
 *   import { worldEvents, groundAt, findPath, sampleHeat, GROUPS } from '../world'
 */
export { bow, game, lookDirection, predict, registerHittable, sweep, type ArrowHit, type Hittable } from './archery'
export { worldEvents, type WorldEventMap } from './events'
export { sampleHeat, isLava } from './heat'
export { pointer, shake } from './interaction'
export * as layout from './layout'
export { findPath, getNavGraph, groundAt, nearestWaypoint, type Ground, type Surface, type Waypoint } from './navigation'
export { GROUPS, LAYER } from './physics'
export { getWorld, type World } from './world'
