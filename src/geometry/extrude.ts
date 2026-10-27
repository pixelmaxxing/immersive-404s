import { ExtrudeGeometry, Matrix4, Shape, Vector2, Vector3 } from 'three'
import type { V2 } from './polygon'

export interface BlockOptions {
  depth: number
  bevelThickness?: number
  bevelSize?: number
  /** gap kept between neighbouring blocks (each block shrinks by gap / 2) */
  gap?: number
  segments?: number
}

/**
 * Extrudes a 2D outline (in the XY plane) along Z into a stone block with
 * rounded bevels, centred on z = 0. Returns raw non-indexed positions.
 */
export function extrudeBlock(poly: V2[], o: BlockOptions, transform?: Matrix4): Float32Array {
  const bt = o.bevelThickness ?? 0.08
  const bs = o.bevelSize ?? 0.07
  const gap = o.gap ?? 0
  const shape = new Shape(poly.map(([x, y]) => new Vector2(x, y)))
  const geo = new ExtrudeGeometry(shape, {
    depth: Math.max(0.01, o.depth - bt * 2),
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bs,
    bevelOffset: -bs - gap / 2,
    bevelSegments: o.segments ?? 3,
    curveSegments: 1,
    steps: 1,
  })
  geo.translate(0, 0, -(o.depth - bt * 2) / 2)
  const flat = geo.index ? geo.toNonIndexed() : geo
  const pos = (flat.getAttribute('position').array as Float32Array).slice()
  geo.dispose()
  flat.dispose()
  if (transform) {
    const v = new Vector3()
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(transform)
      pos[i] = v.x
      pos[i + 1] = v.y
      pos[i + 2] = v.z
    }
  }
  return pos
}
