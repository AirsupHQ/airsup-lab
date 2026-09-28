import { BRAND } from '../brand'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { pipe, bentPath, revolve, ringProfile, boltGeo, P2 } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { GEO } from '../engine/raptor'
import { Decor } from './decor'
import { CarBay } from '../car/bay'

export const BENCH_TOP = 0.92
export const ENGINE_SCALE = 0.26
export const ENGINE_AXIS_Y = 1.34
export const THRUST_PLATE_X = -1.42
/** World x of the engine root (injector face). */
export const ENGINE_X = THRUST_PLATE_X + 0.03 + GEO.top * ENGINE_SCALE
/** World x of the nozzle exit plane. */
export const EXIT_X = ENGINE_X - GEO.yE * ENGINE_SCALE
export const PUMP_POS = new THREE.Vector3(4.2, 1.06, -1.7)
/** Floor point under the tokamak axis; the machine's midplane sits TOKAMAK_MID above it. */
export const FUSION_POS = new THREE.Vector3(-8.5, 0, -0.5)
export const FUSION_PLATFORM = 0.42
export const TOKAMAK_MID = FUSION_PLATFORM + 1.36
export const LINE_POS = new THREE.Vector3(9.7, 0, -0.3)
/** Hall extents */
export const HALL = { x0: -13.6, x1: 90.6, z0: -4.6, z1: 8 }
/** The drone's flight cage: centre of the landing pad on the floor. */
export const DRONE_POS = new THREE.Vector3(85.2, 0, 0.3)
/** The F1 car's wind tunnel bay: the car sits centred here, nose to +x. */
export const F1_POS = new THREE.Vector3(72.2, 0, 0.3)
/** The jet engine's fan face; it lies along +x at this height. */
export const JET_POS = new THREE.Vector3(49.6, 2.25, -0.7)
/** Floor point under the centre of the portal ring. */
export const HOLE_POS = new THREE.Vector3(40.8, 0, -1.3)
/** Floor point under the humanoid's treadmill. */
export const ROBOT_POS = new THREE.Vector3(31.4, 0, -0.1)

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

/**
 * The reflections: a dark photo studio with long horizontal softboxes (the
 * engine lies along X, so long strips give long highlights down the nozzle),
 * a big overhead box, cool and warm rims and a dim floor bounce. Image based
 * light is nearly free per pixel, unlike area lights.
 */
function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene()
  const grad = document.createElement('canvas')
  grad.width = 4
  grad.height = 256
  const g = grad.getContext('2d')!
  const lg = g.createLinearGradient(0, 0, 0, 256)
  lg.addColorStop(0, '#4a4c56')
  lg.addColorStop(0.5, '#2c2a2c')
  lg.addColorStop(1, '#17150f')
  g.fillStyle = lg
  g.fillRect(0, 0, 4, 256)
  const gt = new THREE.CanvasTexture(grad)
  gt.colorSpace = THREE.SRGBColorSpace
  const dome = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ map: gt, side: THREE.BackSide }))
  s.add(dome)
  // softbox texture: bright core with a soft falloff to the edge
  const sb = document.createElement('canvas')
  sb.width = sb.height = 128
  const c = sb.getContext('2d')!
  const rg = c.createRadialGradient(64, 64, 10, 64, 64, 64)
  rg.addColorStop(0, '#ffffff')
  rg.addColorStop(0.65, '#f4f4f4')
  rg.addColorStop(1, '#000000')
  c.fillStyle = rg
  c.fillRect(0, 0, 128, 128)
  const st = new THREE.CanvasTexture(sb)
  const panel = (w: number, h: number, p: [number, number, number], look: [number, number, number], color: number, k: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: st, color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(...p)
    m.lookAt(...look)
    s.add(m)
  }
  panel(12, 5, [0, 9, 1], [0, 0, 0], 0xfff3e6, 5.0) // overhead
  panel(16, 1.4, [0, 4.5, 8], [0, 1.2, 0], 0xf4f7ff, 3.2) // long front strip, high
  panel(16, 1.0, [0, 1.6, 9], [0, 1.2, 0], 0xdfe8ff, 1.2) // long front strip, low
  panel(14, 1.6, [0, 5, -9], [0, 1.2, 0], 0x8fb4ff, 2.6) // cool back rim
  panel(2.5, 9, [-10, 3, -2], [0, 2, 0], 0xa8c6ff, 2.0) // cool side
  panel(2.5, 9, [10, 3, 1], [0, 2, 0], 0xffd6ae, 2.2) // warm side
  panel(10, 10, [0, -3, 0], [0, 1, 0], 0x2a241e, 0.6) // floor bounce
  const pm = new THREE.PMREMGenerator(renderer)
  const tex = pm.fromScene(s, 0.02).texture
  pm.dispose()
  return tex
}

export class Room {
  readonly group = new THREE.Group()
  readonly key: THREE.SpotLight
  readonly lights: THREE.Light[] = []
  readonly pumpSpot: THREE.SpotLight
  envMap: THREE.Texture | null = null
  readonly engineMount = new THREE.Group()
  readonly pumpMount = new THREE.Group()
  readonly fusionMount = new THREE.Group()
  readonly lineMount = new THREE.Group()
  readonly bay: CarBay
  /** fixtures that hang from the ceiling; hidden when the camera looks down from above it */
  readonly ceiling = new THREE.Group()
  fusionKey!: THREE.SpotLight
  readonly glows: THREE.Mesh[] = []
  readonly posters: THREE.Mesh[] = []
  beacon!: THREE.Mesh

  decor!: Decor

  /** Beacon pulses while the engine runs. */
  update(t: number, running: number) {
    this.decor?.update(t)
    const pulse = Math.pow(Math.max(0, Math.sin(t * 5.2)), 3)
    const k = running * (0.25 + 0.75 * pulse)
    ;(this.beacon.material as THREE.MeshBasicMaterial).color.setRGB(1.0 * (0.25 + 3 * k), 0.45 * (0.25 + 3 * k), 0.05 * (0.25 + 3 * k))
  }

  constructor(renderer: THREE.WebGLRenderer) {
    const G = this.group
    G.add(this.ceiling)
    this.envMap = studioEnvironment(renderer)

    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = G, cast = true, receive = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = receive
      parent.add(mesh)
      return mesh
    }
    const glow = (color: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) })

    /* ---------------- shell ---------------- */
    const floorTex = canvasTex(1024, 1024, (g) => {
      g.fillStyle = '#8c8a86'
      g.fillRect(0, 0, 1024, 1024)
      for (let i = 0; i <= 2; i++) {
        g.fillStyle = '#4c4f55'
        g.fillRect(i * 512 - 2, 0, 4, 1024)
        g.fillRect(0, i * 512 - 2, 1024, 4)
      }
    })
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set((HALL.x1 - HALL.x0 + 12) / 2.22, 12)
    const floor = add(new THREE.PlaneGeometry(HALL.x1 - HALL.x0 + 12, 26), surf({ color: 0xb3aea6, map: floorTex, metalness: 0, roughness: 0.38, detail: 1.1, roughVar: 1.0, colorVar: 0.25, clearcoat: 0.5, clearcoatRoughness: 0.22 }), G, false, true)
    floor.rotation.x = -Math.PI / 2
    floor.position.x = (HALL.x0 + HALL.x1) / 2

    const panelTex = canvasTex(512, 1024, (g) => {
      g.fillStyle = '#5b5c61'
      g.fillRect(0, 0, 512, 1024)
      const grd = g.createLinearGradient(0, 0, 512, 0)
      grd.addColorStop(0, 'rgba(255,255,255,0.03)')
      grd.addColorStop(1, 'rgba(0,0,0,0.05)')
      g.fillStyle = grd
      g.fillRect(0, 0, 512, 1024)
      g.fillStyle = '#12151a'
      g.fillRect(0, 0, 8, 1024)
    })
    panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping
    panelTex.repeat.set(Math.round((HALL.x1 - HALL.x0) * 0.97), 1)
    const wallMat = surf({ color: 0xffffff, map: panelTex, metalness: 0.1, roughness: 0.62, detail: 1.6, colorVar: 0.06, roughVar: 0.3 })
    const HW = HALL.x1 - HALL.x0, HX = (HALL.x0 + HALL.x1) / 2
    const WALL_H = 11
    const back = add(new THREE.PlaneGeometry(HW, WALL_H), wallMat, G, false, true)
    back.position.set(HX, WALL_H / 2, -4.6)
    const sideMat = wallMat.clone()
    const left = add(new THREE.PlaneGeometry(16, WALL_H), sideMat, G, false, true)
    left.position.set(HALL.x0, WALL_H / 2, 1)
    left.rotation.y = Math.PI / 2
    const right = add(new THREE.PlaneGeometry(16, WALL_H), sideMat, G, false, true)
    right.position.set(HALL.x1, WALL_H / 2, 1)
    right.rotation.y = -Math.PI / 2
    const front = add(new THREE.PlaneGeometry(HW, 5.2), wallMat, G, false, true)
    front.position.set(HX, 2.6, 8)
    front.rotation.y = Math.PI
    const ceil = add(new THREE.PlaneGeometry(HW, 16), matte(0x2b2b2e, 0.9), G, false, true)
    ceil.position.set(HX, 5.2, 1)
    ceil.rotation.x = Math.PI / 2
    const base = add(new THREE.BoxGeometry(HW, 0.1, 0.04), matte(0x0d0f12, 0.5), G, false, true)
    base.position.set(HX, 0.05, -4.58)

    // light strips: ceiling and wall accents
    const strip = glow(0xfff6ea, 1.7)
    for (let x = HALL.x0 + 2.4; x < HALL.x1 - 1; x += 3.4) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 6.5), strip)
      s.position.set(x, 5.17, -0.5)
      this.ceiling.add(s)
    }
    const led = new THREE.Mesh(new THREE.BoxGeometry(HW - 1, 0.02, 0.02), glow(0x5aa0ff, 1.6))
    led.position.set(HX, 3.3, -4.57)
    G.add(led)

    // framed light panels on the back wall: the three plume regimes
    const posterTex = (kind: number) =>
      canvasTex(900, 600, (g) => {
        g.fillStyle = '#0c1422'
        g.fillRect(0, 0, 900, 600)
        g.strokeStyle = 'rgba(120,190,255,0.9)'
        g.lineWidth = 5
        const cx = 190, cy = 300
        // nozzle bell
        g.beginPath()
        g.moveTo(60, 250); g.lineTo(120, 250); g.quadraticCurveTo(150, 250, 190, 200)
        g.moveTo(60, 350); g.lineTo(120, 350); g.quadraticCurveTo(150, 350, 190, 400)
        g.stroke()
        g.globalCompositeOperation = 'lighter'
        const shape = (k: number) => {
          g.beginPath()
          const w0 = 100
          for (let i = 0; i <= 120; i++) {
            const x = cx + i * 5.6
            const osc = Math.cos((i / 120) * Math.PI * 2 * 3.2)
            let w = w0
            if (k === 0) w = w0 * (0.82 + 0.18 * osc)
            if (k === 1) w = w0 * (1.0 + 0.04 * osc)
            if (k === 2) w = w0 * (1 + i / 40)
            if (i === 0) g.moveTo(x, cy - w)
            else g.lineTo(x, cy - w)
          }
          for (let i = 120; i >= 0; i--) {
            const x = cx + i * 5.6
            const osc = Math.cos((i / 120) * Math.PI * 2 * 3.2)
            let w = w0
            if (k === 0) w = w0 * (0.82 + 0.18 * osc)
            if (k === 1) w = w0 * (1.0 + 0.04 * osc)
            if (k === 2) w = w0 * (1 + i / 40)
            g.lineTo(x, cy + w)
          }
          g.closePath()
        }
        shape(kind)
        g.fillStyle = kind === 2 ? 'rgba(140,110,255,0.25)' : 'rgba(170,120,255,0.22)'
        g.fill()
        g.stroke()
        if (kind < 2) {
          for (let k = 0; k < 4; k++) {
            const x = cx + (0.55 + k) * (600 / 3.2)
            const r = g.createRadialGradient(x, cy, 0, x, cy, 60 - k * 8)
            r.addColorStop(0, `rgba(255,230,200,${0.95 - k * 0.2})`)
            r.addColorStop(1, 'rgba(255,150,120,0)')
            g.fillStyle = r
            g.beginPath(); g.arc(x, cy, 70, 0, Math.PI * 2); g.fill()
          }
        }
        g.globalCompositeOperation = 'source-over'
      })
    const frameMat = surf({ color: 0x2a2f37, metalness: 0.7, roughness: 0.35, detail: 4 })
    for (let i = 0; i < 3; i++) {
      const x = 1.9 + i * 2.05
      const fr = add(new RoundedBoxGeometry(1.62, 1.12, 0.06, 2, 0.01), frameMat, G, false, true)
      fr.position.set(x, 2.3, -4.54)
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshBasicMaterial({ map: posterTex(i), color: new THREE.Color(1, 1, 1).multiplyScalar(1.1) }))
      pic.position.set(x, 2.3, -4.505)
      G.add(pic)
      this.posters.push(pic)
    }

    /* ---------------- window: the launch site at night ---------------- */
    {
      const night = canvasTex(1600, 1100, (g) => {
        const W = 1600, H = 1100
        const sky = g.createLinearGradient(0, 0, 0, H)
        sky.addColorStop(0, '#03050c')
        sky.addColorStop(0.55, '#0b1630')
        sky.addColorStop(0.8, '#1b2a4a')
        sky.addColorStop(0.9, '#3a3140')
        sky.addColorStop(1, '#0a0a0e')
        g.fillStyle = sky
        g.fillRect(0, 0, W, H)
        let seed = 3
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 420; i++) {
          const x = rnd() * W, y = rnd() * H * 0.72, r = rnd() * 1.4 + 0.3
          g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
        }
        const horizon = H * 0.9
        // distant ground lights
        for (let i = 0; i < 60; i++) {
          const x = rnd() * W, y = horizon - 4 + rnd() * 10
          g.fillStyle = rnd() > 0.5 ? 'rgba(255,190,110,0.9)' : 'rgba(255,240,220,0.8)'
          g.fillRect(x, y, 2 + rnd() * 3, 2)
        }
        // launch tower
        const tx = W * 0.56, tw = 64, th = H * 0.66
        g.fillStyle = '#07090f'
        g.fillRect(tx, horizon - th, tw, th)
        g.strokeStyle = 'rgba(80,95,120,0.55)'
        g.lineWidth = 2
        for (let y = horizon - th; y < horizon; y += 26) {
          g.beginPath(); g.moveTo(tx, y); g.lineTo(tx + tw, y + 26); g.moveTo(tx + tw, y); g.lineTo(tx, y + 26); g.stroke()
        }
        g.fillStyle = '#07090f'
        g.fillRect(tx - 110, horizon - th * 0.62, 110, 10)
        g.fillRect(tx - 110, horizon - th * 0.56, 110, 10)
        // the stack beside it, lit by floodlights
        const sx = W * 0.46, sw = 58, sh = H * 0.7
        const steel = g.createLinearGradient(sx, 0, sx + sw, 0)
        steel.addColorStop(0, '#5d6573')
        steel.addColorStop(0.35, '#c7ced8')
        steel.addColorStop(0.6, '#e9eef5')
        steel.addColorStop(1, '#6d7684')
        g.fillStyle = steel
        g.fillRect(sx, horizon - sh, sw, sh)
        g.beginPath()
        g.moveTo(sx, horizon - sh)
        g.quadraticCurveTo(sx + sw / 2, horizon - sh - 120, sx + sw, horizon - sh)
        g.fill()
        g.fillStyle = 'rgba(20,24,32,0.8)'
        g.fillRect(sx - 12, horizon - sh * 0.93, 12, 34)
        g.fillRect(sx + sw, horizon - sh * 0.93, 12, 34)
        g.fillRect(sx, horizon - sh * 0.43, sw, 5)
        // floodlight glow at the base
        const fl = g.createRadialGradient(sx + sw / 2, horizon, 10, sx + sw / 2, horizon, 360)
        fl.addColorStop(0, 'rgba(255,245,230,0.55)')
        fl.addColorStop(1, 'rgba(255,245,230,0)')
        g.fillStyle = fl
        g.fillRect(0, 0, W, H)
        // aviation lights
        for (const [x, y] of [[tx + tw / 2, horizon - th - 6], [tx + 4, horizon - th * 0.5], [tx + tw - 4, horizon - th * 0.75]]) {
          const rg = g.createRadialGradient(x, y, 0, x, y, 16)
          rg.addColorStop(0, 'rgba(255,60,50,1)')
          rg.addColorStop(1, 'rgba(255,60,50,0)')
          g.fillStyle = rg
          g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill()
        }
        g.fillStyle = '#050608'
        g.fillRect(0, horizon + 6, W, H - horizon)
      })
      const wx = -2.0, wy = 2.15, ww = 3.4, wh = 2.3
      const scene = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: night, color: new THREE.Color(1, 1, 1).multiplyScalar(1.15) }))
      scene.position.set(wx, wy, -4.585)
      G.add(scene)
      const mull = surf({ color: 0x1a1d22, metalness: 0.6, roughness: 0.4, detail: 3 })
      const bar = (w: number, h: number, x: number, y: number) => {
        const b = add(new THREE.BoxGeometry(w, h, 0.06), mull, G, false, true)
        b.position.set(x, y, -4.56)
      }
      bar(ww + 0.12, 0.08, wx, wy + wh / 2)
      bar(ww + 0.12, 0.08, wx, wy - wh / 2)
      bar(0.08, wh, wx - ww / 2, wy)
      bar(0.08, wh, wx + ww / 2, wy)
      bar(0.05, wh, wx - ww / 6, wy)
      bar(0.05, wh, wx + ww / 6, wy)
      bar(ww, 0.04, wx, wy + 0.2)
      const sill = add(new THREE.BoxGeometry(ww + 0.3, 0.05, 0.22), surf({ color: 0x2a2e35, metalness: 0.2, roughness: 0.5 }), G, false, true)
      sill.position.set(wx, wy - wh / 2 - 0.03, -4.48)
    }

    /* ---------------- props ---------------- */
    {
      // tool chest
      const red = surf({ color: 0x9e1f1f, metalness: 0.5, roughness: 0.38, detail: 3, colorVar: 0.06, clearcoat: 0.6 })
      const chest = add(new RoundedBoxGeometry(0.75, 0.95, 0.46, 3, 0.02), red)
      chest.position.set(-2.75, 0.5, -1.25)
      for (let i = 0; i < 6; i++) {
        const h = add(new THREE.BoxGeometry(0.5, 0.012, 0.012), surf({ color: 0xc9ccd1, metalness: 1, roughness: 0.25 }), G, false, true)
        h.position.set(-2.75, 0.18 + i * 0.14, -1.015)
      }
      // gas cylinders for spin start, against the left wall
      const cyl = surf({ color: 0x2f5d3a, metalness: 0.4, roughness: 0.45, detail: 3, clearcoat: 0.4 })
      for (let i = 0; i < 3; i++) {
        const c = add(revolve([[0, 0], [0.11, 0], [0.12, 0.03], [0.12, 1.25], [0.08, 1.38], [0.035, 1.42], [0.035, 1.5], [0, 1.5]], 32), cyl)
        c.position.set(-5.3 + i * 0.3, 0, -4.1)
      }
      // floor safety lines around the test bench
      const ymat = new THREE.MeshStandardMaterial({ color: 0xd8a51c, roughness: 0.6 })
      const line = (w: number, d: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ymat)
        m.rotation.x = -Math.PI / 2
        m.position.set(x, 0.002, z)
        m.receiveShadow = true
        G.add(m)
      }
      line(5.2, 0.07, 0.35, -1.05)
      line(5.2, 0.07, 0.35, 1.05)
      line(0.07, 2.1, -2.25, 0)
      line(0.07, 2.1, 2.95, 0)
    }

    /* ---------------- bench ---------------- */
    const benchTop = surf({ color: 0x33373e, metalness: 0.1, roughness: 0.42, detail: 1.2, roughVar: 0.35, colorVar: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.18 })
    const frame = surf({ color: 0x1c1f24, metalness: 0.8, roughness: 0.42, detail: 6 })
    const steel = surf({ color: 0xb4b8be, metalness: 1, roughness: 0.28, detail: 8, anisotropy: 0.45 })
    const top = add(new RoundedBoxGeometry(4.2, 0.07, 1.15, 3, 0.012), benchTop)
    top.position.set(0.1, BENCH_TOP - 0.035, 0)
    for (const x of [-1.9, 2.1]) for (const z of [-0.47, 0.47]) {
      const leg = add(new THREE.BoxGeometry(0.08, BENCH_TOP - 0.07, 0.08), frame)
      leg.position.set(x, (BENCH_TOP - 0.07) / 2, z)
    }
    for (const z of [-0.49, 0.49]) {
      const apron = add(new THREE.BoxGeometry(4.0, 0.12, 0.05), frame)
      apron.position.set(0.1, BENCH_TOP - 0.13, z)
    }
    const shelf = add(new THREE.BoxGeometry(3.9, 0.03, 0.95), frame)
    shelf.position.set(0.1, 0.22, 0)

    // ruler along the front edge: full-size metres from the nozzle exit
    const rulerLen = 4.0
    const r0 = -1.9
    const rulerTex = canvasTex(4096, 128, (g) => {
      g.fillStyle = '#c4c8ce'
      g.fillRect(0, 0, 4096, 128)
      g.fillStyle = '#1f2227'
      const px = (x: number) => ((x - r0) / rulerLen) * 4096
      for (let m = -4; m <= 14; m += 0.25) {
        const x = EXIT_X + m * ENGINE_SCALE
        if (x < r0 || x > r0 + rulerLen) continue
        const major = Math.abs(m - Math.round(m)) < 1e-6
        const half = Math.abs(m * 2 - Math.round(m * 2)) < 1e-6
        const h = major ? 58 : half ? 38 : 24
        g.fillRect(px(x) - (major ? 3 : 2), 0, major ? 6 : 4, h)
        if (major && m >= 0) {
          g.font = '500 42px "DM Mono", ui-monospace, monospace'
          g.textAlign = 'center'
          g.fillText(`${m} m`, px(x), 110)
        }
      }
    })
    const ruler = add(new THREE.PlaneGeometry(rulerLen, 0.066), surf({ color: 0xffffff, map: rulerTex, metalness: 0.25, roughness: 0.45 }), G, false, true)
    ruler.position.set(r0 + rulerLen / 2, BENCH_TOP - 0.035, 0.5761)

    /* ---------------- test stand ---------------- */
    const paint = surf({ color: 0x1d2a3d, metalness: 0.55, roughness: 0.46, detail: 5, colorVar: 0.12, roughVar: 0.45 })
    const yellow = surf({ color: 0xcf9a1c, metalness: 0.3, roughness: 0.5, detail: 5, colorVar: 0.1 })
    const X = THRUST_PLATE_X
    const plate = add(new RoundedBoxGeometry(0.06, 0.66, 0.66, 3, 0.012), paint)
    plate.position.set(X - 0.03, ENGINE_AXIS_Y, 0)
    const lc = add(revolve([[0, 0], [0.085, 0], [0.085, 0.03], [0.06, 0.035], [0, 0.035]], 48), steel)
    lc.rotation.z = -Math.PI / 2
    lc.position.set(X, ENGINE_AXIS_Y, 0)
    for (const z of [-0.29, 0.29]) {
      const h = ENGINE_AXIS_Y - BENCH_TOP + 0.36
      const up = add(new THREE.BoxGeometry(0.09, h, 0.09), paint)
      up.position.set(X - 0.1, BENCH_TOP + h / 2, z)
      const br = add(new THREE.BoxGeometry(0.065, 0.66, 0.055), paint)
      br.position.set(X - 0.33, BENCH_TOP + 0.27, z)
      br.rotation.z = -0.64
      const foot = add(new THREE.BoxGeometry(0.56, 0.026, 0.16), yellow)
      foot.position.set(X - 0.24, BENCH_TOP + 0.013, z)
    }
    const cross = add(new THREE.BoxGeometry(0.09, 0.09, 0.67), paint)
    cross.position.set(X - 0.1, ENGINE_AXIS_Y + 0.36, 0)
    const bolt = boltGeo(0.012, 0.014)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const b = add(bolt, steel)
      b.rotation.z = -Math.PI / 2
      b.position.set(X, ENGINE_AXIS_Y + Math.cos(a) * 0.27, Math.sin(a) * 0.27)
    }
    // name plate on the stand
    const plateTex = canvasTex(1024, 256, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, 256)
      grd.addColorStop(0, '#d9b36a')
      grd.addColorStop(1, '#a8823d')
      g.fillStyle = grd
      g.fillRect(0, 0, 1024, 256)
      g.fillStyle = '#2b1f0c'
      g.font = '600 92px Outfit, system-ui, sans-serif'
      g.textAlign = 'center'
      if (BRAND.shortUrl) g.fillText(BRAND.shortUrl, 512, 118)
      g.font = '500 44px "DM Mono", ui-monospace, monospace'
      g.fillText('Raptor 3 · full flow · 1:4 scale', 512, 196)
    })
    const np = add(new THREE.PlaneGeometry(0.34, 0.085), surf({ color: 0xffffff, map: plateTex, metalness: 0.85, roughness: 0.32 }), G, false, true)
    np.position.set(X - 0.1, BENCH_TOP + 0.2, 0.3355)

    {
      const base = add(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 20), frame)
      base.position.set(X - 0.1, ENGINE_AXIS_Y + 0.42, 0.18)
      this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.05).multiplyScalar(3) }))
      this.beacon.position.set(X - 0.1, ENGINE_AXIS_Y + 0.445, 0.18)
      G.add(this.beacon)
    }
    this.engineMount.position.set(ENGINE_X, ENGINE_AXIS_Y, 0)
    this.engineMount.rotation.z = Math.PI / 2
    this.engineMount.scale.setScalar(ENGINE_SCALE)
    G.add(this.engineMount)

    /* ---------------- propellant supply ---------------- */
    const dewarMat = surf({ color: 0xc9ced4, metalness: 0.95, roughness: 0.24, detail: 3, anisotropy: 0.5 })
    const frost = surf({ color: 0xe9eef4, metalness: 0, roughness: 0.82, detail: 60, bump: 0.0015, colorVar: 0.12, sheen: 0.7, sheenColor: 0xffffff })
    const hose = surf({ color: 0x8d939b, metalness: 1, roughness: 0.34, detail: 40, bump: 0.001 })
    const dewar = (x: number, z: number, label: string, color: string) => {
      const prof: P2[] = [[0, 0], [0.27, 0], [0.3, 0.04], [0.3, 1.45], [0.25, 1.58], [0.12, 1.64], [0.06, 1.66], [0, 1.66]]
      const d = add(revolve(prof, 64), dewarMat)
      d.position.set(x, 0, z)
      for (const y of [0.3, 1.1]) {
        const ring = add(revolve(ringProfile(0.3, 0.316, y, y + 0.04, 0.004), 64), frame)
        ring.position.set(x, 0, z)
      }
      const tex = canvasTex(512, 256, (g) => {
        g.fillStyle = color
        g.fillRect(0, 0, 512, 256)
        g.fillStyle = '#0d0f12'
        g.font = '600 96px Outfit, system-ui, sans-serif'
        g.textAlign = 'center'
        g.fillText(label, 256, 160)
      })
      const lab = add(new THREE.CylinderGeometry(0.302, 0.302, 0.18, 48, 1, true, -0.6, 1.2), surf({ color: 0xffffff, map: tex, metalness: 0, roughness: 0.6 }), G, false, true)
      lab.position.set(x, 0.9, z)
      lab.rotation.y = 0.35
    }
    dewar(-4.3, -3.4, 'LOX', '#86d6ff')
    dewar(-3.5, -3.7, 'CH4', '#ffb866')
    // supply lines run along the wall, drop behind the stand and feed the engine
    const loxLine = bentPath([[X - 0.06, ENGINE_AXIS_Y, 0], [X - 0.36, ENGINE_AXIS_Y, 0], [X - 0.5, ENGINE_AXIS_Y - 0.12, -0.2], [X - 0.52, BENCH_TOP + 0.05, -0.36], [X - 0.52, 0.02, -0.36]], 0.14)
    add(pipe(loxLine, { r: 0.05, tubular: 260, radial: 20 }), frost)
    const ch4In = new THREE.Vector3(0.86 * ENGINE_SCALE, 0, 0)
    void ch4In
    const ch4x = ENGINE_X - 0.86 * ENGINE_SCALE, ch4y = ENGINE_AXIS_Y + 0.63 * ENGINE_SCALE
    const ch4Line = bentPath([[ch4x - 0.005, ch4y, 0], [ch4x - 0.14, ch4y + 0.03, -0.02], [X + 0.02, ch4y + 0.16, -0.2], [X - 0.34, ch4y + 0.05, -0.38], [X - 0.4, BENCH_TOP + 0.05, -0.42], [X - 0.4, 0.02, -0.42]], 0.12)
    add(pipe(ch4Line, { r: 0.028, tubular: 260, radial: 16 }), hose)

    /* ---------------- exhaust collector ---------------- */
    const heat = surf({
      color: 0x34363a, metalness: 1, roughness: 0.55, detail: 4, streaks: 0.45, colorVar: 0.2,
      tint: { y0: 0, y1: 1.2, a: 0x34363a, b: 0x5e5044, c: 0x34363a, strength: 0.35 },
    })
    const col: P2[] = [[0.34, 0], [0.37, 0], [0.37, 0.95], [0.54, 1.18], [0.56, 1.2], [0.51, 1.22], [0.34, 1.0]]
    const collector = add(revolve(col, 72), heat)
    collector.rotation.z = -Math.PI / 2
    collector.position.set(3.25, ENGINE_AXIS_Y - 0.03, 0)
    const cs = add(new THREE.BoxGeometry(0.1, ENGINE_AXIS_Y - 0.4, 0.55), frame)
    cs.position.set(2.75, (ENGINE_AXIS_Y - 0.4) / 2, 0)
    const cs2 = cs.clone()
    cs2.position.x = 3.9
    G.add(cs2)

    /* ---------------- turbopump pedestal ---------------- */
    const P = PUMP_POS
    const ped = add(revolve([[0, 0], [0.5, 0], [0.5, 0.04], [0.4, 0.08], [0.36, P.y - 0.07], [0.44, P.y - 0.045], [0.44, P.y - 0.01], [0, P.y - 0.01]], 72), surf({ color: 0x2a2f37, metalness: 0.3, roughness: 0.5, detail: 1.5, roughVar: 0.3, colorVar: 0.05 }))
    ped.position.set(P.x, 0, P.z)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.442, 0.005, 8, 128), glow(0x62b4ff, 2.2))
    ring.rotation.x = Math.PI / 2
    ring.position.set(P.x, P.y - 0.02, P.z)
    G.add(ring)
    this.pumpMount.position.copy(P)
    G.add(this.pumpMount)

    /* ---------------- lights ---------------- */
    this.key = new THREE.SpotLight(0xfff0de, 110, 14, 0.5, 0.9, 2)
    this.key.position.set(0.7, 4.6, 2.2)
    this.key.target.position.set(-0.4, BENCH_TOP, 0)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1536, 1536)
    this.key.shadow.bias = -0.0001
    this.key.shadow.normalBias = 0.012
    this.key.shadow.camera.near = 2
    this.key.shadow.camera.far = 9
    G.add(this.key, this.key.target)
    const rim = new THREE.SpotLight(0x8fb8ff, 70, 14, 0.5, 0.9, 2)
    rim.position.set(-3.2, 3.6, -3.4)
    rim.target.position.set(-0.6, 1.3, 0)
    G.add(rim, rim.target)
    const hemi = new THREE.HemisphereLight(0xd9dbe6, 0x4a3b2c, 0.75)
    G.add(hemi)
    this.pumpSpot = new THREE.SpotLight(0xfff2e2, 90, 9, 0.46, 0.8, 2)
    this.pumpSpot.position.set(P.x + 0.7, 4.6, P.z + 1.4)
    this.pumpSpot.target.position.set(P.x, P.y + 0.2, P.z)
    this.pumpSpot.castShadow = false
    this.pumpSpot.shadow.mapSize.set(1024, 1024)
    this.pumpSpot.shadow.bias = -0.0002
    this.pumpSpot.shadow.normalBias = 0.02
    G.add(this.pumpSpot, this.pumpSpot.target)
    const pumpRim = new THREE.SpotLight(0x8fb8ff, 70, 9, 0.5, 0.85, 2)
    pumpRim.position.set(P.x - 1.6, 3.0, P.z - 1.9)
    pumpRim.target.position.set(P.x, P.y + 0.25, P.z)
    G.add(pumpRim, pumpRim.target)
    const pumpFill = new THREE.PointLight(0xdfe8ff, 3.5, 5, 2)
    pumpFill.position.set(P.x + 0.4, P.y + 0.6, P.z + 1.6)
    G.add(pumpFill)
    this.lights.push(this.key, rim, hemi, this.pumpSpot, pumpRim, pumpFill)

    /* ---------------- the fusion platform ---------------- */
    const F = FUSION_POS
    {
      const platMat = surf({ color: 0x20242b, metalness: 0.35, roughness: 0.4, detail: 1.5, roughVar: 0.3, colorVar: 0.05, clearcoat: 0.55, clearcoatRoughness: 0.2 })
      const plat = add(revolve([[0, 0], [2.45, 0], [2.45, FUSION_PLATFORM - 0.05], [2.4, FUSION_PLATFORM], [0, FUSION_PLATFORM]], 160), platMat)
      plat.position.set(F.x, 0, F.z)
      const step = add(revolve(ringProfile(2.45, 2.9, 0, 0.16, 0.012), 160), platMat)
      step.position.set(F.x, 0, F.z)
      for (const [r, y, k] of [[2.43, FUSION_PLATFORM - 0.035, 2.4], [2.88, 0.13, 1.2]] as const) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 256), glow(0x62b4ff, k))
        ring.rotation.x = Math.PI / 2
        ring.position.set(F.x, y, F.z)
        G.add(ring)
      }
      // hazard ring painted on the deck
      const hz = canvasTex(2048, 64, (g) => {
        g.fillStyle = '#d8a51c'
        g.fillRect(0, 0, 2048, 64)
        g.fillStyle = '#16181c'
        for (let i = 0; i < 64; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 32, 64); g.lineTo(i * 32 + 16, 64); g.fill() }
      })
      hz.wrapS = THREE.RepeatWrapping
      hz.repeat.set(3, 1)
      const hzr = add(new THREE.RingGeometry(2.12, 2.2, 192, 1), new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6 }), G, false, true)
      hzr.rotation.x = -Math.PI / 2
      hzr.position.set(F.x, FUSION_PLATFORM + 0.002, F.z)
      // fix up the ring UVs so the stripes run around
      const uv = hzr.geometry.attributes.uv as THREE.BufferAttribute
      const pos = hzr.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) {
        const x = pos.getX(i), y = pos.getY(i)
        uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 0.5) * 8, Math.hypot(x, y) > 2.16 ? 1 : 0)
      }
      this.fusionMount.position.set(F.x, TOKAMAK_MID, F.z)
      G.add(this.fusionMount)
    }

    /* ---------------- backdrops ---------------- */
    const posterFrame = surf({ color: 0x2a2f37, metalness: 0.7, roughness: 0.35, detail: 4 })
    const poster = (x: number, y: number, w: number, h: number, tex: THREE.Texture, k = 1.1, z = HALL.z0) => {
      const fr = add(new RoundedBoxGeometry(w + 0.12, h + 0.12, 0.06, 2, 0.012), posterFrame, G, false, true)
      fr.position.set(x, y, z + 0.06)
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(k) }))
      pic.position.set(x, y, z + 0.095)
      G.add(pic)
      this.posters.push(pic)
    }
    // behind the tokamak: a cross section of the machine, drawn like a blueprint
    poster(F.x, 2.75, 4.6, 2.3, canvasTex(2300, 1150, (g) => {
      const W = 2300, H = 1150
      g.fillStyle = '#081222'
      g.fillRect(0, 0, W, H)
      g.strokeStyle = 'rgba(80,140,210,0.14)'
      g.lineWidth = 2
      for (let x = 0; x < W; x += 50) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
      for (let y = 0; y < H; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
      const cx = W / 2, cy = H / 2 + 20, sc = 330
      const D = (s: number, grow = 0, side = 1) => {
        g.beginPath()
        for (let i = 0; i <= 120; i++) {
          const th = (i / 120) * Math.PI * 2
          const sn = Math.sin(th)
          const R = 0.8 - 0.3 * s * 0.38 * sn * sn + (0.3 * s + grow) * Math.cos(th)
          const Z = (1.7 * 0.3 * s + grow) * sn
          const x = cx + side * R * sc, y = cy - Z * sc
          if (i) g.lineTo(x, y); else g.moveTo(x, y)
        }
        g.closePath()
      }
      for (const side of [-1, 1]) {
        g.globalCompositeOperation = 'lighter'
        for (let k = 10; k >= 1; k--) {
          D(k / 10, 0, side)
          const t = k / 10
          g.fillStyle = `rgba(${Math.round(255 - 60 * (1 - t))},${Math.round(70 + 150 * (1 - t))},${Math.round(170 + 80 * (1 - t))},0.13)`
          g.fill()
        }
        g.globalCompositeOperation = 'source-over'
        g.strokeStyle = 'rgba(140,200,255,0.9)'
        g.lineWidth = 3
        for (const [s, gr] of [[1.17, 0], [1.42, 0], [1.5, 0], [1.72, 0]] as const) { D(s, gr, side); g.stroke() }
        g.strokeStyle = 'rgba(255,200,120,0.9)'
        g.lineWidth = 4
        D(1.72, 0.05, side); g.stroke()
        D(1.72, 0.16, side); g.stroke()
        g.strokeStyle = 'rgba(120,220,255,0.45)'
        g.lineWidth = 2
        for (const s of [0.3, 0.55, 0.8]) { D(s, 0, side); g.stroke() }
      }
      g.strokeStyle = 'rgba(255,200,120,0.9)'
      g.lineWidth = 4
      g.strokeRect(cx - 0.135 * sc, cy - 0.95 * sc, 0.27 * sc, 1.9 * sc)
      g.setLineDash([14, 10])
      g.strokeStyle = 'rgba(140,200,255,0.6)'
      g.beginPath(); g.moveTo(cx, 40); g.lineTo(cx, H - 40); g.stroke()
      g.setLineDash([])
    }), 1.05)
    // the sun and the machine, side by side
    const heatPoster = (hot: boolean) => canvasTex(900, 1200, (g) => {
      g.fillStyle = '#070b14'
      g.fillRect(0, 0, 900, 1200)
      const cx = 450, cy = 520
      const rg = g.createRadialGradient(cx, cy, 10, cx, cy, 330)
      if (hot) {
        rg.addColorStop(0, 'rgba(250,240,255,1)')
        rg.addColorStop(0.35, 'rgba(230,120,255,0.95)')
        rg.addColorStop(0.7, 'rgba(255,60,160,0.5)')
        rg.addColorStop(1, 'rgba(255,60,160,0)')
      } else {
        rg.addColorStop(0, 'rgba(255,250,220,1)')
        rg.addColorStop(0.4, 'rgba(255,190,70,0.95)')
        rg.addColorStop(0.75, 'rgba(255,110,30,0.45)')
        rg.addColorStop(1, 'rgba(255,110,30,0)')
      }
      g.fillStyle = rg
      g.beginPath(); g.arc(cx, cy, 330, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ffffff'
      g.font = '600 96px Outfit, system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(hot ? '150' : '15', cx, 1000)
      g.fillStyle = 'rgba(190,210,240,0.85)'
      g.font = '500 40px Outfit, system-ui, sans-serif'
      g.fillText(hot ? 'million °C in a tokamak' : 'million °C in the Sun’s core', cx, 1070)
    })
    poster(F.x - 3.55, 2.55, 1.2, 1.6, heatPoster(false))
    poster(F.x + 3.55, 2.55, 1.2, 1.6, heatPoster(true))

    // behind the line: storage racking with boxes
    {
      const L = LINE_POS
      const upr = surf({ color: 0xd8641c, metalness: 0.4, roughness: 0.45, detail: 3, clearcoat: 0.4 })
      const beam = surf({ color: 0x2d5d9c, metalness: 0.5, roughness: 0.4, detail: 3, clearcoat: 0.4 })
      const card = matte(0xb58a57, 0.75, { detail: 30, colorVar: 0.14, roughVar: 0.2 })
      let seed = 5
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let bay = 0; bay < 3; bay++) {
        const x0 = L.x - 3.3 + bay * 2.25
        for (const dx of [0, 2.1]) for (const dz of [0, 0.8]) {
          add(new THREE.BoxGeometry(0.07, 3.4, 0.07), upr).position.set(x0 + dx, 1.7, HALL.z0 + 0.3 + dz)
        }
        for (const y of [0.15, 1.2, 2.25, 3.3]) for (const dz of [0, 0.8]) {
          add(new THREE.BoxGeometry(2.1, 0.09, 0.05), beam).position.set(x0 + 1.05, y, HALL.z0 + 0.3 + dz)
        }
        for (const y of [0.2, 1.25, 2.3]) {
          for (let i = 0; i < 4; i++) {
            if (rnd() < 0.2) continue
            const w = 0.36 + rnd() * 0.12, h = 0.3 + rnd() * 0.35
            const b = add(new THREE.BoxGeometry(w, h, 0.62), card)
            b.position.set(x0 + 0.3 + i * 0.5, y + 0.045 + h / 2, HALL.z0 + 0.7)
            b.rotation.y = (rnd() - 0.5) * 0.08
          }
        }
      }
    }

    /* ---------------- halo lights over each exhibit and ring lights on the walls ---------------- */
    const halo = (x: number, z: number, r: number, y = 4.55) => {
      const C = this.ceiling
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 12, 192), glow(0xfff1de, 2.4))
      ring.rotation.x = Math.PI / 2
      ring.position.set(x, y, z)
      C.add(ring)
      const housing = add(new THREE.TorusGeometry(r, 0.045, 12, 192), matte(0x15181d, 0.5), C, false, false)
      housing.rotation.x = Math.PI / 2
      housing.position.set(x, y + 0.035, z)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        const c = add(new THREE.CylinderGeometry(0.004, 0.004, 5.2 - y, 6), matte(0x0d0f12, 0.6), C, false, false)
        c.position.set(x + Math.cos(a) * r, y + (5.2 - y) / 2, z + Math.sin(a) * r)
      }
    }
    halo(F.x, F.z, 2.3, 4.7)
    halo(LINE_POS.x, LINE_POS.z + 0.2, 1.7)
    halo(PUMP_POS.x, PUMP_POS.z, 0.8, 4.2)
    const wallRing = (x: number, y: number, z: number, r: number, rotY: number, k = 2.2) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 10, 128), glow(0x9cc8ff, k))
      ring.position.set(x, y, z)
      ring.rotation.y = rotY
      G.add(ring)
      const disc = add(new THREE.CircleGeometry(r * 0.94, 64), matte(0x161a22, 0.55), G, false, true)
      disc.position.set(x, y, z)
      disc.rotation.y = rotY
      disc.translateZ(-0.01)
    }
    for (const [y, r] of [[3.4, 0.42], [2.2, 0.32], [1.2, 0.22]] as const) {
      wallRing(HALL.x0 + 0.02, y, -2.4 + r * 2, r, Math.PI / 2)
      wallRing(HALL.x0 + 0.02, y, 1.2 - r * 2, r, Math.PI / 2)
      wallRing(HALL.x1 - 0.02, y, 2.2 + r * 2, r, -Math.PI / 2)
    }
    // columns along the back wall with light slots
    const colMat = surf({ color: 0x252a33, metalness: 0.2, roughness: 0.55, detail: 1.2, colorVar: 0.05 })
    for (const x of [-12.95, -6.1, 5.9, 14.5, 18.45, 24.75]) {
      add(new THREE.BoxGeometry(0.5, 5.2, 0.4), colMat).position.set(x, 2.6, HALL.z0 + 0.2)
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 4.6, 0.02), glow(0xffe2c0, 2.6))
      slot.position.set(x, 2.6, HALL.z0 + 0.41)
      G.add(slot)
    }

    /* ---------------- lights for the new exhibits ---------------- */
    const fKey = new THREE.SpotLight(0xfff0de, 120, 16, 0.62, 0.9, 2)
    fKey.position.set(F.x - 1.4, 5.0, F.z + 3.2)
    fKey.target.position.set(F.x, TOKAMAK_MID - 0.2, F.z)
    fKey.castShadow = true
    fKey.shadow.mapSize.set(2048, 2048)
    fKey.shadow.bias = -0.0001
    fKey.shadow.normalBias = 0.02
    fKey.shadow.camera.near = 2
    fKey.shadow.camera.far = 11
    G.add(fKey, fKey.target)
    const fRim = new THREE.SpotLight(0x9dc0ff, 150, 14, 0.6, 0.9, 2)
    fRim.position.set(F.x - 3.6, 4.2, F.z - 3.6)
    fRim.target.position.set(F.x, TOKAMAK_MID, F.z)
    G.add(fRim, fRim.target)
    const lKey = new THREE.SpotLight(0xfff2e2, 150, 14, 0.78, 0.8, 2)
    lKey.position.set(LINE_POS.x, 4.8, LINE_POS.z + 2.8)
    lKey.target.position.set(LINE_POS.x, 0.9, LINE_POS.z - 0.2)
    G.add(lKey, lKey.target)
    const lRim = new THREE.SpotLight(0x9dc0ff, 90, 12, 0.8, 0.9, 2)
    lRim.position.set(LINE_POS.x - 2.5, 3.8, LINE_POS.z - 3.2)
    lRim.target.position.set(LINE_POS.x, 1.0, LINE_POS.z)
    G.add(lRim, lRim.target)
    this.fusionKey = fKey
    this.lights.push(fKey, fRim, lKey, lRim)
    this.lineMount.position.copy(LINE_POS)
    G.add(this.lineMount)
    this.decor = new Decor(HALL, FUSION_POS, LINE_POS)
    G.add(this.decor.group)
    this.bay = new CarBay()
    G.add(this.bay.group)
    this.lights.push(...this.bay.lights)

    G.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).type === 'MeshBasicMaterial') {
        mesh.layers.set(LAYER_GLOW)
        mesh.castShadow = false
        this.glows.push(mesh)
      }
    })
  }
}
