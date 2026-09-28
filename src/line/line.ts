import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { surf, matte } from '../core/materials'
import { revolve, ringProfile } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { LineSim, LINE_X, STATIONS, Item } from './sim'

export const LINE_TOP = 0.92
const BELT_Y = LINE_TOP + 0.1
const MAX_ITEMS = 48
/** drones are drawn a bit larger than life so they read from across the room */
const K = 1.3
const ARM_L = 0.27
/** wrist joint to the base of the held motor */
const GRIP = 0.075 + 0.036 * 1.3

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

interface Arm {
  root: THREE.Group
  yaw: THREE.Group
  shoulder: THREE.Group
  elbow: THREE.Group
  wrist: THREE.Group
  held: THREE.Mesh
}

/** The drone line diorama, driven by LineSim. */
export class ProductionLine {
  readonly root = new THREE.Group()
  readonly sim = new LineSim()
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  private inst: Record<string, THREE.InstancedMesh> = {}
  private arms: Arm[] = []
  private spindle!: THREE.Group
  private spark!: THREE.Mesh
  private gantryHead!: THREE.Group
  private gantryCarriage!: THREE.Group
  private gantryPod!: THREE.Mesh
  private scan!: THREE.Mesh
  private beltTex!: THREE.Texture
  private towers: THREE.MeshBasicMaterial[][] = []
  private rings: THREE.MeshBasicMaterial[] = []
  private screenTex!: THREE.CanvasTexture
  private screenCtx!: CanvasRenderingContext2D
  private history: number[] = []
  private histT = 0
  private screenT = 0
  private propAngle = 0
  private d = new THREE.Object3D()
  bottleneck = 1
  bottleneckGlow = 0

  constructor() {
    const G = this.root
    G.name = 'line'
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const glowMat = (c: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) })
    const glow = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = G) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      parent.add(mesh)
      return mesh
    }
    const M = {
      top: surf({ color: 0x2f333a, metalness: 0.1, roughness: 0.4, detail: 1.2, roughVar: 0.35, colorVar: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.18 }),
      frame: surf({ color: 0x1c1f24, metalness: 0.8, roughness: 0.42, detail: 6 }),
      steel: surf({ color: 0xb4b8be, metalness: 1, roughness: 0.28, detail: 8, anisotropy: 0.45 }),
      white: surf({ color: 0xe9ebee, metalness: 0.1, roughness: 0.34, detail: 3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
      orange: surf({ color: 0xe06a1f, metalness: 0.2, roughness: 0.38, detail: 3, clearcoat: 0.6 }),
      blue: surf({ color: 0x23466e, metalness: 0.5, roughness: 0.38, detail: 3, clearcoat: 0.5 }),
      dark: surf({ color: 0x15181d, metalness: 0.5, roughness: 0.5, detail: 4 }),
      carbon: surf({ color: 0x24272c, metalness: 0.4, roughness: 0.3, detail: 20, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
      motor: surf({ color: 0xc6a24a, metalness: 1, roughness: 0.3, detail: 8 }),
      pod: surf({ color: 0x3a6ea5, metalness: 0.3, roughness: 0.35, clearcoat: 0.8 }),
      prop: surf({ color: 0xf2f3f5, metalness: 0, roughness: 0.4 }),
      card: matte(0xb58a57, 0.75, { detail: 30, colorVar: 0.12, roughVar: 0.2 }),
      belt: surf({ color: 0xffffff, metalness: 0, roughness: 0.7 }),
    }

    /* ---------------- bench ---------------- */
    add(new RoundedBoxGeometry(6.7, 0.07, 1.05, 3, 0.012), M.top).position.set(0.1, LINE_TOP - 0.035, 0)
    for (const x of [-3.1, -1.0, 1.1, 3.3]) for (const z of [-0.43, 0.43]) {
      add(new THREE.BoxGeometry(0.08, LINE_TOP - 0.07, 0.08), M.frame).position.set(x, (LINE_TOP - 0.07) / 2, z)
    }
    for (const z of [-0.45, 0.45]) add(new THREE.BoxGeometry(6.5, 0.12, 0.05), M.frame).position.set(0.1, LINE_TOP - 0.13, z)
    add(new THREE.BoxGeometry(6.4, 0.03, 0.9), M.frame).position.set(0.1, 0.22, 0)
    glow(new THREE.BoxGeometry(6.6, 0.012, 0.012), glowMat(0x5aa0ff, 1.8)).position.set(0.1, LINE_TOP - 0.075, 0.53)

    /* ---------------- conveyor ---------------- */
    {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 64
      const g = c.getContext('2d')!
      g.fillStyle = '#23262b'
      g.fillRect(0, 0, 256, 64)
      g.fillStyle = '#2e3238'
      for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 14, 64)
      this.beltTex = new THREE.CanvasTexture(c)
      this.beltTex.colorSpace = THREE.SRGBColorSpace
      this.beltTex.wrapS = this.beltTex.wrapT = THREE.RepeatWrapping
      this.beltTex.repeat.set(24, 1)
      M.belt.map = this.beltTex
    }
    const bx0 = LINE_X[0] - 0.78, bx1 = LINE_X[4] + 0.38
    const blen = bx1 - bx0
    add(new THREE.BoxGeometry(blen, 0.02, 0.32), M.belt).position.set((bx0 + bx1) / 2, BELT_Y - 0.01, 0)
    for (const z of [-0.175, 0.175]) {
      add(new RoundedBoxGeometry(blen + 0.04, 0.06, 0.03, 2, 0.008), M.steel).position.set((bx0 + bx1) / 2, BELT_Y - 0.01, z)
    }
    add(new THREE.BoxGeometry(blen, 0.08, 0.28), M.dark).position.set((bx0 + bx1) / 2, BELT_Y - 0.06, 0)
    for (let x = bx0 + 0.3; x < bx1; x += 0.9) {
      for (const z of [-0.1, 0.1]) add(new THREE.BoxGeometry(0.04, BELT_Y - LINE_TOP - 0.06, 0.04), M.frame).position.set(x, LINE_TOP + (BELT_Y - LINE_TOP - 0.06) / 2, z)
    }
    // raw frame stack and the finished goods pallet
    {
      const stack = new THREE.Group()
      stack.position.set(LINE_X[0] - 0.62, BELT_Y, 0)
      stack.scale.setScalar(K)
      G.add(stack)
      add(new THREE.BoxGeometry(0.2, 0.012, 0.2), M.frame, stack)
      const fr = frameGeo()
      for (let i = 0; i < 7; i++) {
        const m = add(fr, M.carbon, stack)
        m.position.y = 0.012 + i * 0.016
        m.rotation.y = (i % 2) * 0.08
      }
      const pal = add(new RoundedBoxGeometry(0.86, 0.05, 0.6, 2, 0.006), matte(0x9a7a4e, 0.7, { detail: 12, colorVar: 0.15 }))
      pal.position.set(LINE_X[4] + 0.85, LINE_TOP + 0.025, 0)
    }

    /* ---------------- stations ---------------- */
    const machine = (s: number) => {
      const g = new THREE.Group()
      g.position.set(LINE_X[s], 0, 0)
      G.add(g)
      // status tower
      const tower = new THREE.Group()
      tower.position.set(0.3, LINE_TOP, -0.34)
      g.add(tower)
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 10), M.steel, tower).position.y = 0.15
      const mats: THREE.MeshBasicMaterial[] = []
      ;[0xff3b30, 0xffb020, 0x34d399].forEach((c, i) => {
        const m = glowMat(c, 0.15)
        mats.push(m)
        glow(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 16), m, tower).position.y = 0.33 + (2 - i) * 0.04
      })
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 16), M.dark, tower).position.y = 0.44
      this.towers.push(mats)
      // bottleneck ring on the bench
      const ringTex = roundedRectTex()
      const rm = new THREE.MeshBasicMaterial({ map: ringTex, color: new THREE.Color(1, 0.55, 0.15).multiplyScalar(0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      const ring = glow(new THREE.PlaneGeometry(0.86, 0.86), rm, g)
      ring.rotation.x = -Math.PI / 2
      ring.position.set(0, LINE_TOP + 0.003, 0)
      this.rings.push(rm)
      this.anchors['s' + s] = [g, new THREE.Vector3(0, LINE_TOP + 0.5, 0.05)]
      return g
    }

    // 0 frame: an enclosed cutting cell with a moving spindle
    {
      const g = machine(0)
      add(new RoundedBoxGeometry(0.56, 0.05, 0.5, 2, 0.01), M.white, g).position.set(0, LINE_TOP + 0.52, 0)
      for (const x of [-0.26, 0.26]) for (const z of [-0.22, 0.22]) add(new RoundedBoxGeometry(0.04, 0.52, 0.04, 2, 0.008), M.white, g).position.set(x, LINE_TOP + 0.26, z)
      add(new RoundedBoxGeometry(0.56, 0.05, 0.08, 2, 0.01), M.orange, g).position.set(0, LINE_TOP + 0.49, -0.22)
      add(new RoundedBoxGeometry(0.52, 0.46, 0.025, 2, 0.008), M.white, g).position.set(0, LINE_TOP + 0.25, -0.235)
      const glass = new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false })
      for (const x of [-0.26, 0.26]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.3, 0.42), glass); p.position.set(x, LINE_TOP + 0.33, 0); g.add(p) }
      glow(new THREE.BoxGeometry(0.46, 0.01, 0.01), glowMat(0xbfe3ff, 3), g).position.set(0, LINE_TOP + 0.49, 0.2)
      this.spindle = new THREE.Group()
      this.spindle.position.set(0, LINE_TOP + 0.4, 0)
      g.add(this.spindle)
      add(new RoundedBoxGeometry(0.1, 0.12, 0.1, 2, 0.01), M.orange, this.spindle).position.y = 0.04
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 16), M.steel, this.spindle).position.y = -0.08
      add(new THREE.CylinderGeometry(0.004, 0.006, 0.05, 10), M.steel, this.spindle).position.y = -0.17
      add(new THREE.BoxGeometry(0.5, 0.03, 0.03), M.steel, g).position.set(0, LINE_TOP + 0.46, 0)
      this.spark = glow(new THREE.SphereGeometry(0.012, 12, 8), glowMat(0xffc27a, 6), this.spindle)
      this.spark.position.y = -0.2
    }

    // 1 motors: one or two arms beside a tray of motors
    {
      const g = machine(1)
      const tray = add(new RoundedBoxGeometry(0.2, 0.03, 0.14, 2, 0.006), M.blue, g)
      tray.position.set(-0.28, LINE_TOP + 0.015, -0.28)
      const mg = motorGeo()
      for (let i = 0; i < 12; i++) { const mm = add(mg, M.motor, g); mm.position.set(-0.36 + (i % 4) * 0.05, LINE_TOP + 0.04, -0.32 + Math.floor(i / 4) * 0.04); mm.scale.setScalar(K) }
      const tray2 = tray.clone()
      tray2.position.z = 0.28
      g.add(tray2)
      for (let i = 0; i < 12; i++) { const mm = add(mg, M.motor, g); mm.position.set(-0.36 + (i % 4) * 0.05, LINE_TOP + 0.04, 0.24 + Math.floor(i / 4) * 0.04); mm.scale.setScalar(K) }
      this.arms.push(this.arm(g, -0.3, M), this.arm(g, 0.3, M))
    }

    // 2 electronics: a gantry that places the board and battery
    {
      const g = machine(2)
      for (const z of [-0.26, 0.26]) {
        add(new RoundedBoxGeometry(0.05, 0.46, 0.05, 2, 0.01), M.white, g).position.set(0, LINE_TOP + 0.23, z)
      }
      add(new RoundedBoxGeometry(0.07, 0.06, 0.6, 2, 0.01), M.white, g).position.set(0, LINE_TOP + 0.47, 0)
      this.gantryCarriage = new THREE.Group()
      this.gantryCarriage.position.set(0, LINE_TOP + 0.47, 0)
      g.add(this.gantryCarriage)
      add(new RoundedBoxGeometry(0.1, 0.09, 0.08, 2, 0.01), M.orange, this.gantryCarriage)
      this.gantryHead = new THREE.Group()
      this.gantryCarriage.add(this.gantryHead)
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 12), M.steel, this.gantryHead).position.y = -0.12
      add(new RoundedBoxGeometry(0.05, 0.025, 0.05, 2, 0.006), M.dark, this.gantryHead).position.y = -0.23
      const feeder = add(new RoundedBoxGeometry(0.16, 0.08, 0.14, 2, 0.01), M.blue, g)
      feeder.position.set(0, LINE_TOP + 0.04, -0.3)
      this.gantryPod = add(podGeo(), M.pod, this.gantryHead)
      this.gantryPod.scale.setScalar(K)
      this.gantryPod.rotation.y = 0.785
      this.gantryPod.position.y = -0.2425 - 0.053 * K
      glow(new THREE.BoxGeometry(0.1, 0.004, 0.004), glowMat(0x7fd8ff, 3), g).position.set(0, LINE_TOP + 0.082, -0.23)
    }

    // 3 test: a cage where the props spin up under a scan light
    {
      const g = machine(3)
      const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => add(new THREE.BoxGeometry(w, h, d), M.dark, g).position.set(x, y, z)
      for (const x of [-0.22, 0.22]) for (const z of [-0.2, 0.2]) bar(0.025, 0.4, 0.025, x, LINE_TOP + 0.2, z)
      for (const z of [-0.2, 0.2]) bar(0.465, 0.025, 0.025, 0, LINE_TOP + 0.4, z)
      for (const x of [-0.22, 0.22]) bar(0.025, 0.025, 0.425, x, LINE_TOP + 0.4, 0)
      const net = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.38), new THREE.MeshStandardMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.08, roughness: 0.1, metalness: 0, depthWrite: false }))
      net.position.set(0, LINE_TOP + 0.21, -0.2)
      g.add(net)
      this.scan = glow(new THREE.BoxGeometry(0.44, 0.004, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.6).multiplyScalar(0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), g)
      this.scan.position.set(0, BELT_Y + 0.05, 0)
    }

    // 4 pack: a box erector with a tape head
    {
      const g = machine(4)
      add(new RoundedBoxGeometry(0.1, 0.34, 0.36, 2, 0.01), M.white, g).position.set(-0.2, LINE_TOP + 0.17, -0.12)
      add(new RoundedBoxGeometry(0.38, 0.05, 0.1, 2, 0.01), M.white, g).position.set(0, LINE_TOP + 0.37, -0.2)
      add(new RoundedBoxGeometry(0.08, 0.1, 0.08, 2, 0.01), M.orange, g).position.set(0.04, LINE_TOP + 0.32, -0.12)
      add(revolve(ringProfile(0.02, 0.04, -0.015, 0.015, 0.003), 24), M.card, g).position.set(0.04, LINE_TOP + 0.3, -0.05)
      const flat = new THREE.Group()
      flat.position.set(-0.36, LINE_TOP, -0.2)
      g.add(flat)
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.22, 0.006, 0.28), M.card, flat).position.y = 0.003 + i * 0.007
    }

    /* ---------------- parts: one instanced mesh per component ---------------- */
    const mk = (name: string, g: THREE.BufferGeometry, m: THREE.Material, n = MAX_ITEMS) => {
      const im = new THREE.InstancedMesh(g, m, n)
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      for (let i = 0; i < n; i++) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0))
      G.add(im)
      this.inst[name] = im
    }
    mk('frame', frameGeo(), M.carbon)
    mk('motor', motorGeo(), M.motor, MAX_ITEMS * 4)
    mk('plate', new RoundedBoxGeometry(0.2, 0.008, 0.2, 1, 0.003), M.carbon)
    mk('pod', podGeo(), M.pod)
    mk('prop', propGeo(), M.prop, MAX_ITEMS * 4)
    mk('box', new RoundedBoxGeometry(0.2, 0.11, 0.2, 2, 0.006), M.card)
    mk('lid', new THREE.BoxGeometry(0.2, 0.006, 0.1), M.card, MAX_ITEMS * 2)

    /* ---------------- live screen ---------------- */
    {
      const c = document.createElement('canvas')
      c.width = 1280
      c.height = 640
      this.screenCtx = c.getContext('2d')!
      this.screenTex = new THREE.CanvasTexture(c)
      this.screenTex.colorSpace = THREE.SRGBColorSpace
      this.screenTex.anisotropy = 8
      const stand = new THREE.Group()
      stand.position.set(0.05, 0, -0.9)
      G.add(stand)
      add(new RoundedBoxGeometry(2.3, 1.2, 0.07, 3, 0.02), M.dark, stand).position.set(0, 2.05, 0)
      const scr = glow(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.25) }), stand)
      scr.position.set(0, 2.05, 0.037)
      for (const x of [-0.8, 0.8]) add(new THREE.BoxGeometry(0.06, 1.45, 0.06), M.frame, stand).position.set(x, 0.72, -0.02)
      this.anchors.screen = [stand, new THREE.Vector3(0.9, 2.55, 0.05)]
    }
    this.anchors.pallet = [G, new THREE.Vector3(LINE_X[4] + 0.85, LINE_TOP + 0.3, 0)]
    this.drawScreen()
  }

  private arm(g: THREE.Group, z: number, M: Record<string, THREE.MeshStandardMaterial>): Arm {
    const root = new THREE.Group()
    root.position.set(0.02, LINE_TOP, z)
    g.add(root)
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 32), M.dark, root).position.y = 0.025
    const yaw = new THREE.Group()
    yaw.position.y = 0.05
    root.add(yaw)
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.08, 32), M.orange, yaw).position.y = 0.04
    const shoulder = new THREE.Group()
    shoulder.position.y = 0.1
    yaw.add(shoulder)
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 24).rotateX(Math.PI / 2), M.dark, shoulder)
    add(new RoundedBoxGeometry(0.05, ARM_L, 0.05, 2, 0.015), M.orange, shoulder).position.y = ARM_L / 2
    const elbow = new THREE.Group()
    elbow.position.y = ARM_L
    shoulder.add(elbow)
    add(new THREE.CylinderGeometry(0.032, 0.032, 0.075, 24).rotateX(Math.PI / 2), M.dark, elbow)
    add(new RoundedBoxGeometry(0.04, ARM_L, 0.04, 2, 0.012), M.orange, elbow).position.y = ARM_L / 2
    const wrist = new THREE.Group()
    wrist.position.y = ARM_L
    elbow.add(wrist)
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 16), M.steel, wrist).position.y = 0.025
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.008, 0.035, 0.02), M.steel, wrist).position.set(s * 0.014, 0.06, 0)
    // the motor hangs upright below the gripper, drawn at the same size as the ones on the drones
    const held = add(motorGeo(), M.motor, wrist)
    held.scale.setScalar(K)
    held.rotation.x = Math.PI
    held.position.y = GRIP
    return { root, yaw, shoulder, elbow, wrist, held }
  }

  /** Put the arm's motor base exactly on T (station frame), gripper straight down. */
  private ik(a: Arm, T: THREE.Vector3) {
    const S = a.root.position.clone().add(new THREE.Vector3(0, 0.15, 0))
    const W = T.clone().add(new THREE.Vector3(0, GRIP, 0))
    const d = W.sub(S)
    a.yaw.rotation.y = Math.atan2(-d.z, d.x)
    const h = Math.hypot(d.x, d.z), v = d.y
    const D = Math.min(Math.hypot(h, v), ARM_L * 2 - 1e-4)
    const c2 = (D * D - 2 * ARM_L * ARM_L) / (2 * ARM_L * ARM_L)
    const a2 = Math.acos(Math.max(-1, Math.min(1, c2)))
    const a1 = Math.atan2(h, v) - Math.atan2(ARM_L * Math.sin(a2), ARM_L + ARM_L * Math.cos(a2))
    a.shoulder.rotation.z = -a1
    a.elbow.rotation.z = -a2
    a.wrist.rotation.z = -(Math.PI - a1 - a2)
  }

  /** Where motor k of this drone sits (its base), in the frame of the station at stationX. */
  private motorMount(it: Item, k: number, stationX: number) {
    const ang = (k * Math.PI) / 2
    const lx = Math.cos(ang) * 0.076 * K, lz = Math.sin(ang) * 0.076 * K
    const c = Math.cos(0.785), s = Math.sin(0.785)
    return new THREE.Vector3(it.x - stationX + lx * c + lz * s, BELT_Y + 0.012 + 0.005 * K, it.z - lx * s + lz * c)
  }

  private drawScreen() {
    const g = this.screenCtx
    const W = 1280, H = 640
    const sim = this.sim
    g.fillStyle = '#0a1220'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#7fa6d6'
    g.font = '500 30px Outfit, system-ui, sans-serif'
    g.fillText('Drones per hour', 56, 70)
    g.fillStyle = '#ffffff'
    g.font = '600 96px Outfit, system-ui, sans-serif'
    g.fillText(String(Math.round(sim.throughput)), 56, 170)
    // history
    const x0 = 56, x1 = 760, y0 = 560, y1 = 230
    const maxV = 100
    g.strokeStyle = 'rgba(127,166,214,0.25)'
    g.lineWidth = 2
    for (const v of [0, 25, 50, 75, 100]) {
      const y = y0 + (y1 - y0) * (v / maxV)
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke()
      g.fillStyle = 'rgba(127,166,214,0.6)'
      g.font = '400 20px "DM Mono", ui-monospace, monospace'
      g.fillText(String(v), x1 + 10, y + 7)
    }
    const hist = this.history
    if (hist.length > 1) {
      const n = 90
      g.beginPath()
      hist.forEach((v, i) => {
        const x = x1 - (hist.length - 1 - i) * ((x1 - x0) / n)
        const y = y0 + (y1 - y0) * Math.min(1, v / maxV)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.strokeStyle = '#4fd1ff'
      g.lineWidth = 5
      g.stroke()
    }
    // utilisation bars
    const bx = 860, bw = 60, gap = 20
    g.fillStyle = '#7fa6d6'
    g.font = '500 30px Outfit, system-ui, sans-serif'
    g.fillText('Busy', bx, 70)
    STATIONS.forEach((st, i) => {
      const x = bx + i * (bw + gap)
      const u = sim.util[i]
      const h = 330 * u
      g.fillStyle = 'rgba(127,166,214,0.15)'
      g.fillRect(x, 230, bw, 330)
      g.fillStyle = i === this.bottleneck && this.bottleneckGlow > 0.5 ? '#ff8a2a' : '#4fd1ff'
      g.fillRect(x, 560 - h, bw, h)
      g.save()
      g.translate(x + bw / 2 + 8, 600)
      g.fillStyle = 'rgba(200,215,235,0.8)'
      g.font = '400 20px Outfit, system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(st.name.slice(0, 5), -8, 18)
      g.restore()
      g.fillStyle = '#ffffff'
      g.font = '500 22px "DM Mono", ui-monospace, monospace'
      g.textAlign = 'center'
      g.fillText(`${Math.round(u * 100)}`, x + bw / 2, 560 - h - 12)
      g.textAlign = 'left'
    })
    this.screenTex.needsUpdate = true
  }

  /** dt in real seconds. */
  update(dt: number, t: number) {
    const sim = this.sim
    sim.step(dt)
    this.beltTex.offset.x -= dt * 0.9 * (24 / 6.3)
    this.propAngle += dt * 60

    // bottleneck: the busiest station once the line has settled
    const b = sim.bottleneck()
    if (b !== this.bottleneck) this.bottleneck = b
    const settled = sim.t > 240 ? 1 : 0
    this.bottleneckGlow += (settled - this.bottleneckGlow) * (1 - Math.exp(-dt * 2))
    const pulse = 0.65 + 0.35 * Math.sin(t * 4)
    this.rings.forEach((m, i) => {
      const on = i === this.bottleneck ? this.bottleneckGlow * pulse : 0
      m.color.setRGB(1, 0.5, 0.12).multiplyScalar(on * 2.2)
    })

    // tower lights
    sim.stations.forEach((ms, s) => {
      const down = ms.some((m) => m.state === 'down')
      const work = ms.some((m) => m.state === 'work')
      const L = this.towers[s]
      const blink = 0.5 + 0.5 * Math.sign(Math.sin(t * 7))
      L[0].color.setRGB(1, 0.23, 0.19).multiplyScalar(down ? 4 * blink + 0.2 : 0.12)
      L[1].color.setRGB(1, 0.69, 0.13).multiplyScalar(!down && !work ? 3 : 0.12)
      L[2].color.setRGB(0.2, 0.83, 0.6).multiplyScalar(!down && work ? 3 : 0.12)
    })

    // frame cutter: the tool follows the two arms of the X it is cutting
    {
      const m = sim.stations[0][0]
      const working = m.state === 'work' && !!m.item
      const u = m.item ? m.item.prog : 0
      const ix = m.item ? m.item.x - LINE_X[0] : 0, iz = m.item ? m.item.z : 0
      const half = 0.1 * K * 0.95
      const cutY = LINE_TOP + 0.1185 + 0.195, liftY = cutY + 0.07
      // item axes after its 45 degree turn
      const ax = [Math.cos(0.785), -Math.sin(0.785)], bx = [Math.sin(0.785), Math.cos(0.785)]
      let px = 0, pz = 0, py = liftY + 0.05, cutting = false
      if (working) {
        const seg = (u0: number, u1: number) => Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))
        if (u < 0.5) {
          const k = seg(0.08, 0.42)
          const s0 = -half + 2 * half * smooth(k)
          px = ix + ax[0] * s0
          pz = iz + ax[1] * s0
          py = u < 0.08 ? liftY - (liftY - cutY) * smooth(u / 0.08) : u < 0.42 ? cutY : cutY + (liftY - cutY) * smooth((u - 0.42) / 0.08)
          cutting = u >= 0.08 && u < 0.42
        } else {
          const k = seg(0.58, 0.92)
          const s0 = -half + 2 * half * smooth(k)
          const mv = smooth((u - 0.5) / 0.08)
          const aEnd = [ix + ax[0] * half, iz + ax[1] * half]
          const bStart = [ix - bx[0] * half, iz - bx[1] * half]
          px = u < 0.58 ? aEnd[0] + (bStart[0] - aEnd[0]) * mv : ix + bx[0] * s0
          pz = u < 0.58 ? aEnd[1] + (bStart[1] - aEnd[1]) * mv : iz + bx[1] * s0
          py = u < 0.58 ? liftY - (liftY - cutY) * smooth((u - 0.5) / 0.08) : u < 0.92 ? cutY : cutY + (liftY - cutY) * smooth((u - 0.92) / 0.08)
          cutting = u >= 0.58 && u < 0.92
        }
      }
      const k = 1 - Math.exp(-dt * 14)
      this.spindle.position.x += (px - this.spindle.position.x) * (working ? 1 : k)
      this.spindle.position.z += (pz - this.spindle.position.z) * (working ? 1 : k)
      this.spindle.position.y += (py - this.spindle.position.y) * (working ? 1 : k)
      ;(this.spark.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.76, 0.48).multiplyScalar(cutting ? 5 + 3 * Math.sin(t * 40) : 0)
    }
    // arms: each trip picks a motor from the tray and sets it on its mount
    {
      const ms = sim.stations[1]
      this.arms.forEach((a, i) => {
        const m = ms[i]
        a.root.visible = !!m
        if (!m) return
        const side = i === 0 ? -1 : 1
        const pick = new THREE.Vector3(-0.285, LINE_TOP + 0.04, side * 0.28)
        const hov = 0.09
        if (m.state === 'work' && m.item) {
          const trip = Math.min(3, Math.floor(m.item.prog * 4))
          const u = m.item.prog * 4 - trip
          const q = this.motorMount(m.item, trip, LINE_X[1])
          const P = pick, Pu = pick.clone().setY(pick.y + hov), Q = q, Qu = q.clone().setY(q.y + hov)
          const lerp = (A: THREE.Vector3, B: THREE.Vector3, k: number) => A.clone().lerp(B, smooth(k))
          let T: THREE.Vector3
          if (u < 0.08) T = lerp(Pu, P, u / 0.08)
          else if (u < 0.12) T = P.clone()
          else if (u < 0.2) T = lerp(P, Pu, (u - 0.12) / 0.08)
          else if (u < 0.42) T = lerp(Pu, Qu, (u - 0.2) / 0.22)
          else if (u < 0.52) T = lerp(Qu, Q, (u - 0.42) / 0.1)
          else if (u < 0.58) T = Q.clone()
          else if (u < 0.66) T = lerp(Q, Qu, (u - 0.58) / 0.08)
          else T = lerp(Qu, Pu, (u - 0.66) / 0.34)
          this.ik(a, T)
          a.held.visible = u > 0.1 && u < 0.55
        } else if (m.state !== 'down') {
          this.ik(a, pick.clone().setY(pick.y + hov))
          a.held.visible = false
        }
      })
    }
    // gantry: board and battery from the feeder onto the drone
    {
      const m = sim.stations[2][0]
      const working = m.state === 'work' && !!m.item
      const u = m.item ? m.item.prog : 0
      const iz = m.item ? m.item.z : 0
      const feedZ = -0.3
      const pickY = -0.085, placeY = -0.0465, upY = 0
      let z = feedZ, y = upY
      if (working) {
        if (u < 0.1) y = pickY * smooth(u / 0.1)
        else if (u < 0.16) y = pickY * (1 - smooth((u - 0.1) / 0.06))
        else if (u < 0.4) z = feedZ + (iz - feedZ) * smooth((u - 0.16) / 0.24)
        else if (u < 0.56) { z = iz; y = placeY * (u < 0.5 ? smooth((u - 0.4) / 0.1) : 1) }
        else if (u < 0.66) { z = iz; y = placeY * (1 - smooth((u - 0.56) / 0.1)) }
        else z = iz + (feedZ - iz) * smooth((u - 0.66) / 0.24)
        if (u < 0.16) z = feedZ
      }
      this.gantryCarriage.position.z = z
      this.gantryHead.position.y = y
      this.gantryPod.visible = working && u > 0.08 && u < 0.52
    }
    // test scan
    {
      const m = sim.stations[3][0]
      const working = m.state === 'work'
      const u = m.item ? m.item.prog : 0
      ;(this.scan.material as THREE.MeshBasicMaterial).color.setRGB(0.3, 1, 0.6).multiplyScalar(working ? 0.35 : 0)
      this.scan.position.y = BELT_Y + 0.02 + (0.5 + 0.5 * Math.sin(u * Math.PI * 4)) * 0.28
    }

    // parts
    const d = this.d
    const I = this.inst
    const hide = new THREE.Matrix4().makeScale(0, 0, 0)
    let pi = 0
    const items = sim.items.slice(0, MAX_ITEMS)
    items.forEach((it, i) => {
      const inMachine = it.at.kind === 'machine' ? it.at.s : -1
      const working = inMachine >= 0 ? sim.stations[inMachine].some((m) => m.item === it && m.state === 'work') : false
      // components appear partway through the station that adds them
      const has = (stage: number) => it.stage >= stage || (inMachine === stage - 1 && it.prog > (stage === 3 ? 0.52 : 0.55))
      const layer = (it as Item & { layer?: number }).layer ?? 0
      const y = it.at.kind === 'done' ? LINE_TOP + 0.05 + layer * 0.115 * K : BELT_Y + 0.012
      d.position.set(it.x, y, it.z)
      d.rotation.set(0, 0.785, 0)
      d.scale.setScalar(K)
      d.updateMatrix()
      const boxK = it.stage >= 5 ? 1 : inMachine === 4 ? smooth((it.prog - 0.15) / 0.5) : 0
      const inside = boxK >= 0.999
      // the cutter turns a square plate into the X frame
      const cut = it.stage >= 1 || (inMachine === 0 && it.prog > 0.92)
      I.plate.setMatrixAt(i, !cut ? d.matrix : hide)
      I.frame.setMatrixAt(i, inside || !cut ? hide : d.matrix)
      const itemM = d.matrix.clone()
      const mi = inMachine === 1 ? sim.stations[1].findIndex((mm) => mm.item === it) : -1
      const prog1 = mi >= 0 ? it.prog * 4 : 0
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2
        const placed = it.stage >= 2 || (mi >= 0 && (k < Math.floor(prog1) || (k === Math.floor(prog1) && prog1 - k > 0.55)))
        I.motor.setMatrixAt(i * 4 + k, placed && !inside ? itemM.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(ang) * 0.076, 0.005, Math.sin(ang) * 0.076)) : hide)
      }
      I.pod.setMatrixAt(i, has(3) && !inside ? d.matrix : hide)
      const spin = inMachine === 3 && working
      for (let k = 0; k < 4; k++) {
        const a = 0.785 + (k * Math.PI) / 2
        const px = it.x + Math.cos(a) * 0.076 * K, pz = it.z - Math.sin(a) * 0.076 * K
        const show = has(4) && !inside
        d.position.set(px, y + 0.034 * K, pz)
        d.rotation.set(0, spin ? this.propAngle * (k % 2 ? 1 : -1) : 0.4 * k, 0)
        d.scale.setScalar(show ? K : 0)
        d.updateMatrix()
        I.prop.setMatrixAt(pi++, d.matrix)
      }
      // the box rises around the drone, then the flaps close
      d.position.set(it.x, y + 0.055 * boxK * K - 0.002, it.z)
      d.rotation.set(0, 0, 0)
      d.scale.set(boxK > 0 ? K : 0, Math.max(0.001, boxK) * K, boxK > 0 ? K : 0)
      d.updateMatrix()
      I.box.setMatrixAt(i, d.matrix)
      const flap = it.stage >= 5 ? 0 : inMachine === 4 ? 1 - smooth((it.prog - 0.7) / 0.25) : 1
      for (const s of [-1, 1]) {
        d.position.set(it.x, y + 0.11 * boxK * K, it.z + s * 0.1 * K)
        d.rotation.set(s * flap * 1.9, 0, 0)
        d.scale.setScalar(boxK > 0.9 ? K : 0)
        d.translateZ(-s * 0.05 * K)
        d.updateMatrix()
        I.lid.setMatrixAt(i * 2 + (s < 0 ? 0 : 1), d.matrix)
      }
    })
    for (let i = items.length; i < MAX_ITEMS; i++) {
      for (const k of ['frame', 'plate', 'pod', 'box']) I[k].setMatrixAt(i, hide)
      for (let k = 0; k < 4; k++) I.motor.setMatrixAt(i * 4 + k, hide)
      I.lid.setMatrixAt(i * 2, hide)
      I.lid.setMatrixAt(i * 2 + 1, hide)
    }
    for (; pi < MAX_ITEMS * 4; pi++) I.prop.setMatrixAt(pi, hide)
    for (const k in I) I[k].instanceMatrix.needsUpdate = true

    // screen: history sampled from the sim clock
    this.histT += dt
    if (this.histT > 0.5) {
      this.histT = 0
      this.history.push(sim.throughput)
      if (this.history.length > 91) this.history.shift()
    }
    this.screenT += dt
    if (this.screenT > 0.25) {
      this.screenT = 0
      this.drawScreen()
    }
  }

  resetHistory() {
    this.history = []
  }

  /** Run the line for a while without drawing, so it is full and settled when seen. */
  warm(seconds: number) {
    const dt = 1 / 30
    for (let i = 0; i < seconds * 30; i++) {
      this.sim.step(dt)
      this.histT += dt
      if (this.histT > 0.5) {
        this.histT = 0
        this.history.push(this.sim.throughput)
        if (this.history.length > 91) this.history.shift()
      }
    }
    this.bottleneck = this.sim.bottleneck()
    this.bottleneckGlow = 1
    this.drawScreen()
  }
}

function frameGeo() {
  const a = new RoundedBoxGeometry(0.2, 0.01, 0.024, 2, 0.004)
  const b = a.clone().rotateY(Math.PI / 2)
  const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24)
  const pads: THREE.BufferGeometry[] = []
  for (let k = 0; k < 4; k++) {
    const p = new THREE.CylinderGeometry(0.022, 0.022, 0.008, 20)
    const ang = (k * Math.PI) / 2
    p.translate(Math.cos(ang) * 0.1 * 0.76, 0, Math.sin(ang) * 0.1 * 0.76)
    pads.push(p)
  }
  return strip(mergeGeometries([a, b, hub, ...pads].map(strip))!)
}

function motorGeo() {
  const g = revolve([[0, 0], [0.016, 0], [0.018, 0.004], [0.018, 0.024], [0.012, 0.028], [0.003, 0.03], [0.003, 0.036], [0, 0.036]], 20)
  return g
}

function motorsGeo() {
  const geos: THREE.BufferGeometry[] = []
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2
    const g = motorGeo().clone()
    g.translate(Math.cos(ang) * 0.076, 0.005, Math.sin(ang) * 0.076)
    geos.push(strip(g))
  }
  return mergeGeometries(geos)!
}

function podGeo() {
  const body = new RoundedBoxGeometry(0.07, 0.03, 0.09, 2, 0.01)
  body.translate(0, 0.02, 0)
  const bat = new RoundedBoxGeometry(0.05, 0.018, 0.07, 2, 0.006)
  bat.translate(0, 0.044, 0)
  return mergeGeometries([strip(body), strip(bat)])!
}

function propGeo() {
  const a = new RoundedBoxGeometry(0.1, 0.003, 0.014, 1, 0.0015)
  return strip(a)
}

function strip(g: THREE.BufferGeometry) {
  const out = g.index ? g.toNonIndexed() : g
  for (const n of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(n)) out.deleteAttribute(n)
  return out
}

function roundedRectTex() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.strokeStyle = '#ffffff'
  g.lineWidth = 7
  g.shadowColor = '#ffffff'
  g.shadowBlur = 16
  const r = 36, m = 22
  g.beginPath()
  g.moveTo(m + r, m)
  g.arcTo(256 - m, m, 256 - m, 256 - m, r)
  g.arcTo(256 - m, 256 - m, m, 256 - m, r)
  g.arcTo(m, 256 - m, m, m, r)
  g.arcTo(m, m, 256 - m, m, r)
  g.closePath()
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
