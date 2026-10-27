import { Vector3 } from 'three'
import { closestOnPolyline, pointInPolygon, smoothPolyline, type V2 } from '../geometry/polygon'
import type { FieldCell } from './gen/stoneField'
import { CAUSEWAY, DIGITS, LAVA_Y, VIEWER } from './layout'
import { getWorld } from './world'

/**
 * Navigation data for gameplay (a character, an aiming system, …).
 *
 *  - groundAt(x, z, fromY) what is underfoot below a height: stone, the stairs,
 *                          lava, or the void — and the walking height
 *  - nav graph             named waypoints from the viewer's spot along the
 *                          causeway, up the floating stairs to the monument
 *  - findPath              shortest route between two waypoints (A*)
 */

export type Surface = 'stone' | 'stairs' | 'island' | 'lava' | 'void'

export interface Ground {
  surface: Surface
  /** walking height (top of the stone, or the lava surface) */
  y: number
}

export interface Waypoint {
  id: string
  position: Vector3
  links: string[]
  tags: string[]
}

const findCell = (cells: FieldCell[], x: number, z: number) => cells.find((c) => pointInPolygon([x, z], c.poly))

/** The highest surface at (x, z) that lies below `fromY` (default: anywhere). */
export function groundAt(x: number, z: number, fromY = Infinity): Ground {
  const w = getWorld()
  const hits: Ground[] = []
  const ic = findCell(w.island.cells, x, z)
  if (ic) {
    const lava = ic.kind === 'channel' || ic.kind === 'pool' || w.islandField.sample(x, z).molten > 0.6
    hits.push(lava ? { surface: 'lava', y: w.islandLavaY } : { surface: 'island', y: ic.top })
  }
  w.stairs.hulls.forEach((h, i) => {
    const top: V2[] = []
    for (let k = 0; k < h.length; k += 6) top.push([h[k], h[k + 2]])
    if (pointInPolygon([x, z], top)) hits.push({ surface: 'stairs', y: w.stairs.tops[i].y })
  })
  const cc = findCell(w.causeway.cells, x, z) ?? w.formations.map((f) => findCell(f.field.cells, x, z)).find(Boolean)
  if (cc) hits.push(cc.top > LAVA_Y ? { surface: 'stone', y: cc.top } : { surface: 'lava', y: LAVA_Y })
  else hits.push({ surface: 'lava', y: LAVA_Y })
  const below = hits.filter((g) => g.y <= fromY + 0.5).sort((a, b) => b.y - a.y)
  return below[0] ?? { surface: 'void', y: -Infinity }
}

let graph: Map<string, Waypoint> | null = null

function build(): Map<string, Waypoint> {
  const w = getWorld()
  const g = new Map<string, Waypoint>()
  const add = (id: string, p: Vector3, tags: string[]) => g.set(id, { id, position: p, links: [], tags })
  const link = (a: string, b: string) => {
    g.get(a)?.links.push(b)
    g.get(b)?.links.push(a)
  }

  // where the viewer stands, then out along the causeway
  const [vx, , vz] = VIEWER.position
  add('start', new Vector3(vx, groundAt(vx, vz, 1).y, vz), ['start', 'causeway'])
  const line = smoothPolyline(CAUSEWAY.line, 3.5).filter(([, z]) => z < vz - 1)
  let prev = 'start'
  line.forEach(([x, z], i) => {
    const id = `causeway-${i}`
    const nearLava = Math.abs(x) + CAUSEWAY.halfWidth(z) > 3.4
    add(id, new Vector3(x, groundAt(x, z, 1).y, z), ['causeway', ...(nearLava ? ['hot'] : [])])
    link(prev, id)
    prev = id
  })
  const [lx, lz] = CAUSEWAY.landing.center
  add('landing', new Vector3(lx, groundAt(lx, lz, 1).y, lz), ['landing'])
  link(prev, 'landing')

  // up the floating stairs
  prev = 'landing'
  w.stairs.tops.forEach((t, i) => {
    const id = `stair-${i}`
    add(id, t.clone(), ['stairs'])
    link(prev, id)
    prev = id
  })

  // onto the island, to the feet of each digit
  const last = w.stairs.tops[w.stairs.tops.length - 1]
  const edge = new Vector3(last.x, w.island.cells.reduce((m, c) => Math.max(m, c.top), 0), last.z - 1.5)
  add('island-edge', edge, ['island'])
  link(prev, 'island-edge')
  DIGITS.forEach((d, i) => {
    const yaw = d.rotation[0]
    const fx = d.position[0] + Math.sin(yaw) * 2.6
    const fz = d.position[2] + Math.cos(yaw) * 2.6
    add(`digit-${i}`, new Vector3(fx, groundAt(fx, fz).y, fz), ['monument', `digit:${d.char}`])
    link('island-edge', `digit-${i}`)
  })
  link('digit-0', 'digit-1')
  link('digit-1', 'digit-2')
  return g
}

export function getNavGraph(): Map<string, Waypoint> {
  if (!graph) graph = build()
  return graph
}

export function nearestWaypoint(p: Vector3, tag?: string): Waypoint {
  let best: Waypoint | null = null
  let bd = Infinity
  for (const wp of getNavGraph().values()) {
    if (tag && !wp.tags.includes(tag)) continue
    const d = wp.position.distanceToSquared(p)
    if (d < bd) {
      bd = d
      best = wp
    }
  }
  return best!
}

/** A* over the waypoint graph. Returns [] when unreachable. */
export function findPath(fromId: string, toId: string): Waypoint[] {
  const g = getNavGraph()
  const start = g.get(fromId)
  const goal = g.get(toId)
  if (!start || !goal) return []
  const open = new Set([start.id])
  const came = new Map<string, string>()
  const gScore = new Map([[start.id, 0]])
  const fScore = new Map([[start.id, start.position.distanceTo(goal.position)]])
  while (open.size) {
    let cur = ''
    let low = Infinity
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity
      if (f < low) {
        low = f
        cur = id
      }
    }
    if (cur === goal.id) {
      const out = [goal]
      while (came.has(out[0].id)) out.unshift(g.get(came.get(out[0].id)!)!)
      return out
    }
    open.delete(cur)
    const node = g.get(cur)!
    for (const nId of node.links) {
      const n = g.get(nId)!
      const tentative = (gScore.get(cur) ?? Infinity) + node.position.distanceTo(n.position)
      if (tentative < (gScore.get(nId) ?? Infinity)) {
        came.set(nId, cur)
        gScore.set(nId, tentative)
        fScore.set(nId, tentative + n.position.distanceTo(goal.position))
        open.add(nId)
      }
    }
  }
  return []
}

/** Distance from (x, z) to the causeway's centreline (for staying on the path). */
export function causewayOffset(x: number, z: number): number {
  return closestOnPolyline([x, z], smoothPolyline(CAUSEWAY.line, 0.5)).dist
}
