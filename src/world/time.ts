/**
 * World time can run slow: the winning shot plays out in slow motion.
 *
 * <TimeWarp /> scales the frame clock itself, so everything driven by it
 * follows along (physics, shaders, particles, the camera's sway). Things that
 * should stay crisp, like camera shake, read real time from here instead.
 */
export const timeWarp = {
  /** world seconds per real second */
  scale: 1,
  /** real seconds this frame, and since the scene started */
  realDelta: 0,
  realTime: 0,
}
