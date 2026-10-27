/**
 * World event bus.
 *
 * Every meaningful thing that happens in the world is announced here, so a
 * future character (the stickman) can react without the scene knowing it
 * exists: panic when the monument is struck, flee falling debris, flinch at
 * lava splashes, etc.
 */
export type Vec3Tuple = [number, number, number]

export interface WorldEventMap {
  /** pointer closeness to a digit changed noticeably (0..1) */
  'digit:proximity': { digit: number; amount: number }
  /** a digit was struck (clicked) */
  'digit:strike': { digit: number; point: Vec3Tuple; strength: number }
  /** a physical piece of debris broke loose */
  'debris:spawn': { id: number; position: Vec3Tuple }
  /** debris landed in lava and is melting */
  'debris:melt': { id: number; position: Vec3Tuple }
  /** something hit the lava surface */
  'lava:splash': { position: Vec3Tuple; strength: number }
  /** a floating fragment was knocked away */
  'fragment:knock': { index: number; position: Vec3Tuple }
  /** a loose rock was knocked / fell off the world / respawned */
  'rock:knock': { index: number; position: Vec3Tuple }
  'rock:lost': { index: number; position: Vec3Tuple }
  'rock:respawn': { index: number; position: Vec3Tuple }
  /** ambient rock fall from the island's underside */
  'ambient:rockfall': { position: Vec3Tuple }
  /** the bow was pressed and comes up to draw */
  'bow:raise': Record<string, never>
  /** the bow was pressed and let go without being drawn */
  'bow:tap': Record<string, never>
  /** an arrow was loosed */
  'arrow:fire': { position: Vec3Tuple; direction: Vec3Tuple; power: number }
  /** an arrow struck something; striking the monument wins the way home */
  'arrow:hit': { position: Vec3Tuple; surface: 'monument' | 'stone' | 'prop' | 'lava'; digit?: number }
  /** a digit gave way and came down as loose stones */
  'monument:collapse': { digit: number; position: Vec3Tuple }
  /** the world starts burning away around `origin` (CSS px), taking `duration` seconds */
  'finale:burn': { origin: [number, number]; duration: number }
  /** nothing left but white: time to go home */
  'finale:done': Record<string, never>
}

type Handler<T> = (payload: T) => void

export function createEmitter<M extends object>() {
  const handlers = new Map<keyof M, Set<Handler<never>>>()
  return {
    on<K extends keyof M>(type: K, fn: Handler<M[K]>) {
      let set = handlers.get(type)
      if (!set) handlers.set(type, (set = new Set()))
      set.add(fn as Handler<never>)
      return () => set!.delete(fn as Handler<never>)
    },
    emit<K extends keyof M>(type: K, payload: M[K]) {
      handlers.get(type)?.forEach((fn) => (fn as Handler<M[K]>)(payload))
    },
  }
}

export const worldEvents = createEmitter<WorldEventMap>()
