import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial, Vector3 } from 'three'
import { LAVA_RAMP_GLSL } from '../../materials/glsl/lavaRamp'
import { shared } from '../../materials/shared'
import { centroid, type V2 } from '../../geometry/polygon'
import { Rng } from '../../geometry/random'
import { pointer } from '../../world/interaction'
import { ISLAND, LAVA_Y } from '../../world/layout'
import { getWorld } from '../../world/world'
import { getBurstPools, setBurstScale } from './bursts'

/**
 * Ambient particles, fully GPU-driven (one draw call):
 *  0 embers   — rise from open lava, wobble, cool from yellow to dull red
 *  1 sparks   — rare, fast and bright
 *  2 droplets — molten beads dripping from the island's hot underside
 *  3 ash      — dim motes drifting through the air
 * Every particle is gently pushed away from the pointer ray.
 */
const TYPE = { ember: 0, spark: 1, droplet: 2, ash: 3 }

function randomPointInPoly(poly: V2[], rng: Rng): V2 {
  const c = centroid(poly)
  const v = poly[rng.int(0, poly.length - 1)]
  const w = poly[(poly.indexOf(v) + 1) % poly.length]
  const a = rng.next()
  const b = rng.next() * (1 - a)
  return [c[0] + (v[0] - c[0]) * a + (w[0] - c[0]) * b, c[1] + (v[1] - c[1]) * a + (w[1] - c[1]) * b]
}

export function Particles() {
  const { island, islandLavaY, falls, lakeField } = getWorld()
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const dpr = useThree((s) => s.viewport.dpr)
  const scene = useThree((s) => s.scene)

  const { geometry, material } = useMemo(() => {
    const rng = new Rng(9)
    const origin: number[] = []
    const data: number[] = []
    const type: number[] = []
    const push = (p: [number, number, number], t: number, life: number, speed: number, sz: number) => {
      origin.push(...p)
      data.push(rng.next(), life, speed, sz)
      type.push(t)
    }
    // embers rising off the lake, mostly from the molten currents beside the causeway
    for (let i = 0, tries = 0; i < 560 && tries < 40000; tries++) {
      const x = rng.range(-18, 18)
      const z = rng.range(-44, 16)
      const m = lakeField.sample(x, z).molten
      if (m < 0.12 || rng.next() > m * m) continue
      i++
      push([x, LAVA_Y + 0.05, z], TYPE.ember, rng.range(3, 7), rng.range(0.4, 1.0), rng.range(0.035, 0.075))
    }
    // rare sparks near you
    for (let i = 0, tries = 0; i < 40 && tries < 8000; tries++) {
      const x = rng.range(-14, 14)
      const z = rng.range(-30, 12)
      if (lakeField.sample(x, z).molten < 0.6) continue
      i++
      push([x, LAVA_Y + 0.05, z], TYPE.spark, rng.range(3, 9), rng.range(1.6, 3.2), rng.range(0.06, 0.1))
    }
    for (const f of falls) {
      // embers peeling off the stream as it falls
      for (let i = 0; i < 70; i++) {
        const p = f.path[Math.floor(rng.range(0.2, 0.95) * f.path.length)]
        push([p.x, p.y, p.z], TYPE.ember, rng.range(2, 5), rng.range(0.4, 0.9), rng.range(0.08, 0.14))
      }
      // sparks bursting up where it hits the lake
      for (let i = 0; i < 60; i++) {
        const p = f.bottom
        push([p.x + rng.range(-1.6, 1.6), LAVA_Y + 0.1, p.z + rng.range(-1.6, 1.6)], TYPE.spark, rng.range(1.5, 3.5), rng.range(3, 6.5), rng.range(0.1, 0.18))
      }
    }
    // embers rising from the island's molten rivers around the monument
    const lavaCells = island.cells.filter((c) => c.kind === 'channel' || c.kind === 'pool')
    for (let i = 0; i < 170 && lavaCells.length; i++) {
      const [x, z] = randomPointInPoly(rng.pick(lavaCells).poly, rng)
      push([x, islandLavaY + 0.1, z], TYPE.ember, rng.range(4, 8), rng.range(0.6, 1.4), rng.range(0.12, 0.22))
    }
    // molten beads dripping from the island's hot underside
    const tips = island.cells.filter((c) => c.bottom < ISLAND.top - 5)
    for (let i = 0; i < 90 && tips.length; i++) {
      const c = rng.pick(tips)
      push([c.center[0] + rng.range(-0.3, 0.3), c.bottom - rng.range(0.4, 1.6), c.center[1] + rng.range(-0.3, 0.3)], TYPE.droplet, rng.range(2, 3.5), rng.range(0.1, 0.4), rng.range(0.08, 0.14))
    }
    // ash drifting through the air around you and up toward the island
    for (let i = 0; i < 520; i++) {
      push([rng.range(-24, 24), rng.range(0.2, 22), rng.range(-55, 14)], TYPE.ash, rng.range(10, 22), rng.range(0.05, 0.18), rng.range(0.02, 0.045))
    }

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(origin), 3))
    g.setAttribute('aData', new BufferAttribute(new Float32Array(data), 4))
    g.setAttribute('aType', new BufferAttribute(new Float32Array(type), 1))
    g.boundingSphere = null

    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: shared.uTime,
        uScale: { value: 800 },
        uRayOrigin: { value: new Vector3() },
        uRayDir: { value: new Vector3(0, 0, -1) },
        uRepel: { value: 0 },
      },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform vec3 uRayOrigin;
uniform vec3 uRayDir;
uniform float uRepel;
attribute vec4 aData;  // seed, life, speed, size
attribute float aType;
varying float vAge;
varying float vType;
varying float vSeed;
varying float vNear;

vec3 hash3(float n) { return fract(sin(vec3(n, n + 1.31, n + 2.77)) * vec3(43758.5453, 22578.1459, 19642.3490)); }

void main() {
  float seed = aData.x;
  float life = aData.y;
  float speed = aData.z;
  float t = uTime + seed * 97.0;
  float age = mod(t, life);
  float cycle = floor(t / life);
  float k = age / life;
  vAge = k;
  vType = aType;
  vSeed = seed;
  vec3 r = hash3(seed * 131.7 + cycle * 7.13);
  vec3 p = position;

  if (aType < 0.5) {
    // ember: buoyant, accelerating, curling in the hot air
    p.xz += (r.xz - 0.5) * 0.6;
    p.y += age * speed * (1.0 + 0.25 * age);
    p.x += sin(age * 1.7 + seed * 40.0) * 0.25 * k + age * 0.08;
    p.z += cos(age * 1.3 + seed * 23.0) * 0.25 * k - age * 0.04;
  } else if (aType < 1.5) {
    // spark: rare, shoots up fast, then slows
    p.xz += (r.xz - 0.5) * 0.4;
    vec3 v = normalize(vec3(r.x - 0.5, 1.6, r.z - 0.5)) * speed;
    p += v * (1.0 - exp(-1.4 * age)) / 1.4 + vec3(0.0, -1.2, 0.0) * age * age * 0.5;
  } else if (aType < 2.5) {
    // droplet: tears off the fall, accelerates down
    p.xz += (r.xz - 0.5) * 0.5;
    p.y -= 0.5 * 7.5 * age * age + age * speed;
    p.x += (r.y - 0.5) * age * 0.6;
  } else {
    // ash: slow, wide drift with gentle updraft
    p += vec3(sin(t * 0.05 + seed * 9.0) * 1.5 + age * 0.06, age * speed, cos(t * 0.04 + seed * 7.0) * 1.2);
  }

  // drift away from the pointer ray
  vec3 toP = p - uRayOrigin;
  vec3 closest = uRayOrigin + uRayDir * max(dot(toP, uRayDir), 0.0);
  vec3 away = p - closest;
  float d = length(away);
  p += (away / max(d, 1e-3)) * uRepel * 0.9 * (1.0 - smoothstep(0.0, 1.6, d));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vNear = smoothstep(0.6, 2.2, -mv.z);
  float size = aData.w;
  if (aType < 0.5) size *= 1.0 - 0.55 * k;
  if (aType > 2.5) size *= 0.8 + 0.4 * sin(t * 0.7 + seed * 50.0);
  gl_PointSize = max(1.0, size * uScale / -mv.z);
}`,
      fragmentShader: /* glsl */ `
${LAVA_RAMP_GLSL}
varying float vAge;
varying float vType;
varying float vSeed;
varying float vNear;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float soft = pow(1.0 - d, 1.8);
  float fade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.6, 1.0, vAge));
  vec3 col;
  if (vType < 0.5) {
    col = lw_lavaEmission(mix(1.0, 0.42, vAge)) * 1.3;
  } else if (vType < 1.5) {
    col = lw_lavaEmission(1.15 - vAge * 0.4) * 2.2;
  } else if (vType < 2.5) {
    col = lw_lavaEmission(0.95 - vAge * 0.35) * 1.4;
  } else {
    col = vec3(0.05, 0.03, 0.022) * (0.6 + 0.4 * sin(vSeed * 80.0));
    fade *= 0.8;
  }
  gl_FragColor = vec4(col * soft * fade * vNear, 1.0);
}`,
    })
    return { geometry: g, material: m }
  }, [island, islandLavaY, falls, lakeField])

  const pools = useMemo(getBurstPools, [])
  useEffect(() => {
    scene.add(pools.hot.points, pools.grit.points)
    return () => void scene.remove(pools.hot.points, pools.grit.points)
  }, [scene, pools])

  useFrame(() => {
    const scale = size.height * dpr * 0.5 * camera.projectionMatrix.elements[5]
    material.uniforms.uScale.value = scale
    setBurstScale(scale)
    material.uniforms.uRayOrigin.value.copy(pointer.ray.origin)
    material.uniforms.uRayDir.value.copy(pointer.ray.direction)
    const target = pointer.active ? 1 : 0
    material.uniforms.uRepel.value += (target - material.uniforms.uRepel.value) * 0.05
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}
