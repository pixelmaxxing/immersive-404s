import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CylinderGeometry, Group, MathUtils, Mesh, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { hud } from '../../ui/hud'
import { ARROW, arrowSpeed, bow, game, launcher, lookDirection, predict, refreshHittables, type Prediction } from '../../world/archery'
import { worldEvents } from '../../world/events'
import { createPropMaterial, flexPoint } from './materials'
import { buildArrow, buildBow } from './model'

/** How far the nock comes back at full draw (bow space). */
const DRAW_LEN = 0.3
/** Distance of the bow in front of the eye. */
const HOLD = 0.85
/** Reticle travel per pixel of pull, relative to the screen's own angle per pixel. */
const GAIN = 1.3

const FORWARD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)

/** At rest the bow tips down and rolls a little (before its idle sway). */
const REST_DIP = -0.16
const REST_ROLL = 0.06
const REST = new Quaternion()
  .setFromUnitVectors(FORWARD, new Vector3(0, REST_DIP, -1).normalize())
  .multiply(new Quaternion().setFromAxisAngle(FORWARD, REST_ROLL))

/**
 * The first-person bow. Press anywhere and pull down to draw: the bow comes
 * up, the string comes back and the reticle climbs, slingshot-style, the
 * further you pull. The reticle sits where the arrow will land, path and
 * gravity included. Let go to loose. Space + arrow keys work too.
 */
export function Bow() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const rig = useMemo(() => {
    const model = buildBow()
    const arrow = buildArrow()
    const flex = { value: 0 }
    const wood = createPropMaterial({ color: '#2b1911', roughness: 0.42, grain: 240, inlay: true, flex })
    const mats = {
      wood,
      riser: createPropMaterial({ color: '#1b1513', roughness: 0.3, metalness: 0.5 }),
      grip: createPropMaterial({ color: '#4e2317', roughness: 0.85, wrap: true }),
      bronze: createPropMaterial({ color: '#b98a4c', roughness: 0.3, metalness: 1 }),
      bone: createPropMaterial({ color: '#d6c8b0', roughness: 0.55, flex }),
      string: createPropMaterial({ color: '#a89c8a', roughness: 0.7 }),
      shaft: createPropMaterial({ color: '#3a2417', roughness: 0.55, grain: 900 }),
      head: createPropMaterial({ color: '#0d0b0b', roughness: 0.24, metalness: 0.35 }),
      fletch: createPropMaterial({ color: '#902712', roughness: 0.9 }),
    }
    mats.head.emissive.set('#ff5a16')

    const root = new Group()
    const holder = new Group()
    root.add(holder)
    const mesh = (g: Mesh['geometry'], m: Mesh['material']) => {
      const x = new Mesh(g, m)
      x.frustumCulled = false
      return x
    }
    holder.add(mesh(model.limbs, mats.wood), mesh(model.riser, mats.riser), mesh(model.grip, mats.grip), mesh(model.fittings, mats.bronze), mesh(model.tips, mats.bone))
    // the string: two thin strands from the tips to the nock
    const strand = new CylinderGeometry(0.0021, 0.0021, 1, 5, 1, true).translate(0, 0.5, 0)
    const strands = [mesh(strand, mats.string), mesh(strand, mats.string)]
    holder.add(...strands)
    // the nocked arrow (tip at its origin, pointing -Z)
    const nocked = new Group()
    nocked.add(mesh(arrow.shaft, mats.shaft), mesh(arrow.nock, mats.bone), mesh(arrow.head, mats.head), mesh(arrow.fletching, mats.fletch))
    holder.add(nocked)
    return { root, holder, strands, nocked, model, mats, flex }
  }, [])

  const pred = useMemo<Prediction>(() => ({ hit: null, point: new Vector3(), passed: false, time: 0 }), [])
  const tmp = useMemo(
    () => ({
      aim: new Vector3(),
      aimCam: new Vector3(),
      idle: new Vector3(),
      dir: new Vector3(),
      q: new Quaternion(),
      camInv: new Quaternion(),
      roll: new Quaternion(),
      tip: new Vector3(),
      vel: new Vector3(),
      a: new Vector3(),
      b: new Vector3(),
      nock: new Vector3(),
      ndc: new Vector3(),
    }),
    [],
  )
  // input and animation state
  const st = useRef({
    mode: 'none' as 'none' | 'pointer' | 'key',
    id: -1,
    x0: 0,
    y0: 0,
    yaw0: 0,
    pitch0: 0,
    fov0: 48,
    pull: 0,
    moved: 0,
    keys: { up: false, down: false, left: false, right: false },
    raise: 0,
    released: 10,
    releaseDraw: 0,
    renock: 1,
    cueY: -1,
  })

  // the bow rides along with the camera
  useEffect(() => {
    const { root } = rig
    scene.add(camera)
    camera.add(root)
    return () => {
      camera.remove(root)
      scene.remove(camera)
    }
  }, [scene, camera, rig])

  useEffect(() => {
    const el = gl.domElement
    const s = st.current
    el.style.cursor = 'grab'

    const begin = (mode: 'pointer' | 'key') => {
      if (game.won) return false
      s.mode = mode
      s.yaw0 = bow.camYaw
      s.pitch0 = bow.camPitch
      s.fov0 = camera.fov
      s.pull = 0
      s.moved = 0
      bow.yaw = s.yaw0
      bow.pitch = s.pitch0
      bow.aiming = true
      el.style.cursor = 'grabbing'
      worldEvents.emit('bow:raise', {})
      return true
    }
    const end = (loose: boolean) => {
      if (s.mode === 'none') return
      s.mode = 'none'
      s.id = -1
      bow.aiming = false
      el.style.cursor = 'grab'
      if (loose && bow.draw >= ARROW.minDraw && launcher.fire && !game.won) {
        launcher.fire(tmp.tip.clone(), tmp.vel.clone(), bow.draw)
        worldEvents.emit('arrow:fire', { position: tmp.tip.toArray(), direction: tmp.aim.toArray(), power: bow.draw })
        s.released = 0
        s.releaseDraw = bow.draw
        s.renock = 0
      } else if (loose && s.moved < 8) {
        worldEvents.emit('bow:tap', {})
      }
      bow.draw = 0
      s.pull = 0
    }

    const aimFromPointer = (x: number, y: number) => {
      const dx = x - s.x0
      const dy = y - s.y0
      const h = sizeRef.current.height
      const perPx = MathUtils.degToRad(s.fov0) / Math.max(1, h)
      s.moved = Math.max(s.moved, Math.hypot(dx, dy))
      // slingshot: pull down and the shot climbs, pull right and it swings left
      bow.yaw = MathUtils.clamp(s.yaw0 + dx * perPx * GAIN, -0.9, 0.9)
      bow.pitch = MathUtils.clamp(s.pitch0 + dy * perPx * GAIN, -0.45, 1.0)
      const full = MathUtils.clamp(h * 0.1, 70, 130)
      s.pull = MathUtils.clamp(Math.hypot(dx, dy) / full, 0, 1)
    }

    const down = (e: PointerEvent) => {
      if (s.mode !== 'none' || (e.pointerType === 'mouse' && e.button !== 0)) return
      if (!begin('pointer')) return
      s.id = e.pointerId
      s.x0 = e.clientX
      s.y0 = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (s.mode === 'pointer' && e.pointerId === s.id) aimFromPointer(e.clientX, e.clientY)
    }
    const up = (e: PointerEvent) => {
      if (s.mode === 'pointer' && e.pointerId === s.id) end(true)
    }
    const cancel = (e: PointerEvent) => {
      if (s.mode === 'pointer' && e.pointerId === s.id) end(false)
    }

    const KEYS: Record<string, keyof typeof s.keys> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    const free = () => document.activeElement === document.body || document.activeElement === el || document.activeElement === null
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && free()) {
        e.preventDefault()
        if (s.mode === 'none') begin('key')
      } else if (e.code === 'Escape' && s.mode !== 'none') {
        end(false)
      } else if (KEYS[e.code] && s.mode === 'key') {
        e.preventDefault()
        s.keys[KEYS[e.code]] = true
      }
    }
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space' && s.mode === 'key') end(true)
      if (KEYS[e.code]) s.keys[KEYS[e.code]] = false
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('lostpointercapture', cancel)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('lostpointercapture', cancel)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  }, [gl, camera, tmp])

  useFrame((state, dt) => {
    const d = Math.min(dt, 1 / 30)
    const t = state.clock.elapsedTime
    const s = st.current
    const { holder, strands, nocked, model, mats, flex } = rig
    const aiming = bow.aiming && !game.won

    // keyboard: hold to draw, arrows to aim
    if (s.mode === 'key') {
      s.pull = Math.min(1, s.pull + d / 0.7)
      const k = s.keys
      bow.yaw = MathUtils.clamp(bow.yaw + ((k.left ? 1 : 0) - (k.right ? 1 : 0)) * 0.3 * d, -0.9, 0.9)
      bow.pitch = MathUtils.clamp(bow.pitch + ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * 0.22 * d, -0.45, 1.0)
    }
    if (game.won && s.mode !== 'none') {
      s.mode = 'none'
      bow.aiming = false
    }

    // --- draw, raise, release ---
    if (aiming) bow.draw += (s.pull - bow.draw) * (1 - Math.exp(-d * 16))
    s.raise += ((aiming ? 1 : 0) - s.raise) * (1 - Math.exp(-d * (aiming ? 12 : 4)))
    s.released += d
    s.renock = Math.min(1, s.renock + d * 2.6)
    const snap = s.released < 0.6 ? s.releaseDraw * Math.exp(-s.released * 22) : 0
    const twang = s.released < 0.6 ? s.releaseDraw * 0.06 * Math.exp(-s.released * 9) * Math.sin(s.released * 120) : 0
    const draw = aiming ? bow.draw : snap
    flex.value = draw
    mats.wood.userData.uniforms.uInlay.value = draw
    mats.head.emissiveIntensity = Math.pow(bow.draw, 1.5) * 4.5

    // --- pose in camera space: low in the frame, as wide as the screen allows ---
    const halfV = MathUtils.degToRad(camera.fov / 2)
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect)
    const scale = MathUtils.clamp((Math.tan(halfH * 0.74) * HOLD) / 0.43, 0.55, 1)
    const yRest = -Math.tan(halfV * 0.64) * HOLD
    const raise = s.raise * s.raise * (3 - 2 * s.raise)
    holder.scale.setScalar(scale)
    holder.position.set(
      Math.sin(t * 0.7) * 0.004 * (1 - raise),
      yRest - (1 - raise) * 0.05 * scale + Math.sin(t * 1.3) * 0.003 + (game.won ? -Math.min(1, (t - game.wonAt) * 0.8) * 0.25 : 0),
      -HOLD + (1 - raise) * 0.04,
    )

    // where the arrow points: the aim while drawn, a relaxed angle otherwise
    camera.updateMatrixWorld()
    lookDirection(bow.yaw, bow.pitch, tmp.aim)
    tmp.camInv.copy(camera.quaternion).invert()
    tmp.aimCam.copy(tmp.aim).applyQuaternion(tmp.camInv)
    tmp.idle.set(Math.sin(t * 0.5) * 0.02, REST_DIP, -1).normalize()
    tmp.dir.copy(tmp.idle).lerp(tmp.aimCam, raise).normalize()
    tmp.q.setFromUnitVectors(FORWARD, tmp.dir)
    const roll = REST_ROLL - (bow.yaw - s.yaw0) * 0.5 * raise + Math.sin(t * 0.6) * 0.01
    tmp.roll.setFromAxisAngle(FORWARD, roll)
    holder.quaternion.copy(tmp.q).multiply(tmp.roll)

    // --- string and arrow ---
    const tipZ = model.tipLeft.z
    const nockZ = tipZ + draw * DRAW_LEN + twang
    tmp.nock.set(0, model.restY * 0.5, nockZ)
    ;[model.tipLeft, model.tipRight].forEach((tp, i) => {
      flexPoint(tp.x, tp.y, tp.z, draw, tmp.a)
      tmp.b.subVectors(tmp.nock, tmp.a)
      const len = tmp.b.length()
      const strandMesh = strands[i]
      strandMesh.position.copy(tmp.a)
      strandMesh.quaternion.setFromUnitVectors(UP, tmp.b.divideScalar(len))
      strandMesh.scale.set(1, len, 1)
    })
    const ready = s.renock
    nocked.visible = ready > 0.05 && !game.won
    nocked.position.set(0, model.restY - (1 - ready) * 0.06, tipZ + (aiming ? bow.draw * DRAW_LEN : 0) - ARROW.length + (1 - ready) * 0.12)
    nocked.scale.setScalar(0.6 + 0.4 * ready)

    // the line of text above the arrow: just over its tip at rest, sway aside
    const cue = hud.cue
    if (cue) {
      tmp.a.set(0, model.restY, tipZ - ARROW.length).multiplyScalar(scale).applyQuaternion(REST)
      tmp.a.y += yRest - 0.05 * scale
      tmp.a.z += 0.04 - HOLD
      tmp.a.applyMatrix4(camera.projectionMatrix)
      const y = Math.round((0.5 - tmp.a.y * 0.5) * size.height)
      if (y !== s.cueY) {
        s.cueY = y
        cue.style.setProperty('--tip', `${y}px`)
      }
    }

    // --- the shot this draw would make, and its reticle ---
    nocked.updateWorldMatrix(true, false)
    nocked.getWorldPosition(tmp.tip)
    tmp.vel.copy(tmp.aim).multiplyScalar(arrowSpeed(bow.draw))
    const el = hud.reticle
    bow.lock = -1
    if (aiming && bow.draw > 0.03 && ready > 0.9) {
      refreshHittables(state.clock.elapsedTime)
      predict(tmp.tip, tmp.vel, pred)
      tmp.ndc.copy(pred.point).project(camera)
      const visible = (pred.hit !== null || pred.passed) && tmp.ndc.z < 1 && Math.abs(tmp.ndc.x) < 1.2 && Math.abs(tmp.ndc.y) < 1.2
      const onTarget = pred.hit?.surface === 'monument'
      if (onTarget) bow.lock = pred.hit!.target!.index ?? -1
      if (el) {
        const x = (tmp.ndc.x * 0.5 + 0.5) * size.width
        const y = (-tmp.ndc.y * 0.5 + 0.5) * size.height
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        el.style.setProperty('--draw', bow.draw.toFixed(3))
        // locked on the 404, landing on something else, or flying on past it
        el.dataset.state = !visible ? 'off' : onTarget ? 'lock' : pred.passed ? 'miss' : 'on'
      }
    } else if (el && el.dataset.state !== 'off') {
      el.dataset.state = 'off'
    }
  })

  return null
}
