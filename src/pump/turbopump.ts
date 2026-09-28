import * as THREE from 'three'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import { revolve, ringProfile, circleProfile, pipe, boltGeo, ringMatrices, helixBlade, impellerBlade, hollowTorus, spline2, flangeAt, boltCircle } from '../core/geometry'
import { fluidMat, FluidKind } from '../engine/fluid'
import { rng } from '../core/noise'

/** The pump's own flow controls, separate from the engine's. */
export const PUMP_FLUID = {
  rate: { value: 1 },
  on: { value: 1 },
  emph: { lox: { value: 1 }, oxgas: { value: 1 } } as Record<string, { value: number }>,
}

const D = Math.PI / 180

/** Spiral volute centre line: grows from the tongue around one turn, then leaves tangentially. */
class VoluteCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private y: number, private rBase: number, private r0: number, private r1: number, private exitLen: number) { super() }
  radiusAt(u: number) {
    const s = Math.min(u / 0.82, 1)
    return this.r0 + (this.r1 - this.r0) * Math.pow(s, 0.8)
  }
  getPoint(u: number, target = new THREE.Vector3()) {
    if (u <= 0.82) {
      const s = u / 0.82
      const a = s * Math.PI * 2 * 0.97
      const R = this.rBase + this.radiusAt(u)
      return target.set(Math.sin(a) * R, this.y, Math.cos(a) * R)
    }
    const aE = Math.PI * 2 * 0.97
    const R = this.rBase + this.r1
    const p = new THREE.Vector3(Math.sin(aE) * R, this.y, Math.cos(aE) * R)
    const t = new THREE.Vector3(Math.cos(aE), 0, -Math.sin(aE))
    const k = (u - 0.82) / 0.18
    return target.copy(p).addScaledVector(t, k * this.exitLen)
  }
}

export class Turbopump {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly rotor = new THREE.Group()
  readonly parts: { group: THREE.Group; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly bubbles: THREE.InstancedMesh
  readonly fluids: THREE.Mesh[] = []
  private bubbleSeeds: { a: number; r: number; ph: number; sp: number }[] = []
  angle = 0

  constructor() {
    this.root.name = 'turbopump'
    this.cut = new CutState(this.root, 0.45, 0)
    const cut = this.cut
    const cap = 0xb4b9bf
    const M = {
      cast: surf({ color: 0xa6abb1, metalness: 1, roughness: 0.44, detail: 1.1, roughVar: 0.22, colorVar: 0.035, bump: 0.00012, cut, capColor: cap }),
      printed: surf({ color: 0xa2a7ad, metalness: 1, roughness: 0.5, detail: 1.2, roughVar: 0.22, colorVar: 0.035, layers: [2600, 0.00003], cut, capColor: cap }),
      machined: surf({ color: 0xc4c8cd, metalness: 1, roughness: 0.3, detail: 3, roughVar: 0.15, anisotropy: 0.5, cut, capColor: 0xc0c4ca }),
      hot: surf({
        color: 0x8d8a8a, metalness: 1, roughness: 0.46, detail: 1.2, roughVar: 0.25, colorVar: 0.05, cut, capColor: cap,
        tint: { y0: -0.45, y1: -0.12, a: 0x5b5e66, b: 0x7a6552, c: 0x8a8e94, strength: 0.45 },
      }),
      dark: surf({ color: 0x33363b, metalness: 0.9, roughness: 0.4, detail: 8, cut, capColor: 0x8a8f96 }),
      rotor: surf({ color: 0xc2c6cc, metalness: 1, roughness: 0.24, detail: 6, roughVar: 0.25, side: THREE.DoubleSide }),
      bladeHot: surf({ color: 0x9a8f86, metalness: 1, roughness: 0.3, detail: 6, side: THREE.DoubleSide, tint: { y0: -0.3, y1: -0.18, a: 0x6f6a8a, b: 0x9a8a7a, c: 0xb0a898, strength: 0.4 } }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.3, detail: 8, cut, capColor: 0xd9b25e }),
      stand: surf({ color: 0x1d232c, metalness: 0.5, roughness: 0.45, detail: 4 }),
    }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], parent: THREE.Object3D) => {
      const im = new THREE.InstancedMesh(g, m, mats.length)
      mats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.castShadow = true
      im.receiveShadow = true
      parent.add(im)
      return im
    }
    const part = (explode: [number, number, number]) => {
      const group = new THREE.Group()
      this.root.add(group)
      this.parts.push({ group, explode: new THREE.Vector3(...explode) })
      return group
    }
    const fluid = (g: THREE.BufferGeometry, kind: FluidKind, parent: THREE.Object3D, mode: 0 | 1 | 2 | 3 | 4, extra: Record<string, unknown> = {}) => {
      const m = fluidMat(cut, { kind, mode, rate: PUMP_FLUID.rate, on: PUMP_FLUID.on, emph: PUMP_FLUID.emph[kind], ...extra })
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(m.userData.gas ? 1 : 2)
      mesh.userData.fluid = kind
      parent.add(mesh)
      this.fluids.push(mesh)
      return mesh
    }
    const bolts = (count: number, r: number, y: number, s: number, parent: THREE.Object3D, down = false, phase = 0) =>
      inst(boltGeo(s, s * 1.1), M.dark, ringMatrices(count, r, y, phase, down ? new THREE.Euler(Math.PI, 0, 0) : undefined), parent)

    /* ---------- inlet and inducer casing (oxygen enters on the axis) ---------- */
    const inlet = part([0, 0.32, 0])
    add(revolve([[0.098, 0.25], [0.118, 0.25], [0.118, 0.4], [0.13, 0.43], [0.19, 0.43], [0.19, 0.465], [0.104, 0.465], [0.104, 0.44], [0.098, 0.42]], 128), M.machined, inlet)
    fluid(revolve([[0, 0.23], [0.096, 0.23], [0.096, 0.47], [0, 0.47]], 96), 'lox', inlet, 2, { scale: 0.05, speed: 1.2, gas: false })
    bolts(16, 0.165, 0.465, 0.009, inlet, false, 0.1)

    /* ---------- pump casing and spiral volute ---------- */
    const pumpC = part([0, 0.14, 0])
    // shroud side casing and back plate (with the impeller discharge slot between them)
    add(revolve(spline2([[0.098, 0.25], [0.11, 0.22], [0.15, 0.2], [0.168, 0.196], [0.168, 0.205], [0.15, 0.212], [0.118, 0.232], [0.112, 0.25]], 6), 128), M.cast, pumpC)
    add(revolve([[0.06, 0.12], [0.168, 0.12], [0.168, 0.152], [0.07, 0.152]], 128), M.cast, pumpC)
    const vol = new VoluteCurve(0.176, 0.162, 0.018, 0.068, 0.18)
    add(pipe(vol, { r: (u) => vol.radiusAt(u) + 0.012, ri: (u) => vol.radiusAt(u), tubular: 160, radial: 36, up: new THREE.Vector3(0, 1, 0) }), M.cast, pumpC)
    fluid(pipe(vol, { r: (u) => vol.radiusAt(u) - 0.001, tubular: 160, radial: 24, up: new THREE.Vector3(0, 1, 0) }), 'lox', pumpC, 0, { scale: 0.06, speed: 1.6, gas: false })
    // discharge flange
    {
      const aE = Math.PI * 2 * 0.97
      const R = 0.162 + 0.078
      const p = new THREE.Vector3(Math.sin(aE) * R, 0.176, Math.cos(aE) * R).addScaledVector(new THREE.Vector3(Math.cos(aE), 0, -Math.sin(aE)), 0.2)
      const fl = revolve(ringProfile(0.078, 0.13, -0.018, 0.0, 0.004), 64)
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(aE), 0, -Math.sin(aE)))
      fl.applyQuaternion(q).translate(p.x, p.y, p.z)
      add(fl, M.machined, pumpC)
      const n = new THREE.Vector3(Math.cos(aE), 0, -Math.sin(aE))
      inst(boltGeo(1, 1.1), M.dark, boltCircle(p.clone().addScaledVector(n, 0.001), n, 0.108, 12, 0.008), pumpC)
      this.anchors.discharge = [pumpC, p.clone()]
    }
    // impeller passage fluid
    fluid(revolve([[0.04, 0.155], [0.152, 0.158], [0.168, 0.176], [0.152, 0.194], [0.11, 0.216], [0.07, 0.232], [0.04, 0.236]], 128), 'lox', pumpC, 4, { scale: 0.05, speed: 2.4, gas: false })

    /* ---------- bearing housing ---------- */
    const brg = part([0, 0.0, 0])
    add(revolve(spline2([[0.07, 0.12], [0.1, 0.11], [0.112, 0.06], [0.112, -0.06], [0.12, -0.11], [0.15, -0.13], [0.07, -0.13]], 6).concat([[0.07, -0.13]]), 128), M.printed, brg)
    // bearings: races and balls
    for (const yb of [0.07, -0.07]) {
      add(revolve(ringProfile(0.036, 0.046, yb - 0.012, yb + 0.012, 0.002), 64), M.machined, brg)
      add(revolve(ringProfile(0.058, 0.07, yb - 0.012, yb + 0.012, 0.002), 64), M.machined, brg)
      inst(new THREE.SphereGeometry(0.0072, 14, 10), M.machined, ringMatrices(14, 0.052, yb), brg)
    }
    // labyrinth seal teeth
    for (let i = 0; i < 6; i++) add(revolve(ringProfile(0.037, 0.06, 0.1 + i * 0.004, 0.102 + i * 0.004), 48), M.machined, brg)

    /* ---------- turbine: inlet manifold, stator, casing, exhaust ---------- */
    const turb = part([0, -0.2, 0])
    for (const h of hollowTorus(0.235, -0.185, 0.066, 0.052)) add(revolve(h, 160), M.hot, turb)
    fluid(revolve(circleProfile(0.235, -0.185, 0.05, 20), 160), 'oxgas', turb, 4, { scale: 0.05, speed: 1.6, intensity: 1.8 })
    add(revolve([[0.19, -0.13], [0.2, -0.13], [0.2, -0.3], [0.232, -0.34], [0.26, -0.36], [0.26, -0.39], [0.2, -0.39], [0.19, -0.35]], 128), M.hot, turb)
    add(revolve([[0.06, -0.13], [0.15, -0.13], [0.15, -0.15], [0.08, -0.16], [0.06, -0.16]], 96), M.hot, turb)
    // stator ring with vanes
    add(revolve(ringProfile(0.128, 0.134, -0.21, -0.18), 128), M.hot, turb)
    add(revolve(ringProfile(0.186, 0.192, -0.21, -0.18), 128), M.hot, turb)
    {
      const g = new THREE.BoxGeometry(0.052, 0.03, 0.005)
      const mats = ringMatrices(36, 0.16, -0.195, 0.03)
      mats.forEach((m) => m.multiply(new THREE.Matrix4().makeRotationX(-40 * D)))
      inst(g, M.hot, mats, turb)
    }
    // hot gas passage and exhaust
    fluid(revolve([[0.13, -0.16], [0.19, -0.16], [0.19, -0.3], [0.25, -0.37], [0.25, -0.39], [0.13, -0.39], [0.13, -0.3]], 128), 'oxgas', turb, 2, { scale: 0.05, speed: 2.0, intensity: 1.3 })
    // hot gas inlet pipe from the preburner
    {
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0.24, -0.185, -0.2), new THREE.Vector3(0.3, -0.185, -0.28), new THREE.Vector3(0.42, -0.22, -0.3)])
      add(pipe(c, { r: 0.05, ri: 0.038, tubular: 40, radial: 24, up: new THREE.Vector3(0, 1, 0) }), M.hot, turb)
      // blind flange where the preburner would bolt on
      const end = c.getPointAt(1), t = c.getTangentAt(1)
      add(flangeAt(end, t, 0.0, 0.082, 0.02), M.machined, turb)
      inst(boltGeo(1, 1.1), M.dark, boltCircle(end.clone().addScaledVector(t, 0.01), t, 0.066, 10, 0.0075), turb)
      // igniter stub and a pressure tap on the manifold
      const tap = new THREE.CylinderGeometry(0.014, 0.014, 0.06, 14)
      tap.rotateX(Math.PI / 2)
      tap.translate(0.235, -0.12, 0.05)
      add(tap, M.gold, turb)
    }
    bolts(28, 0.225, -0.39, 0.009, turb, true, 0.05)

    /* ---------- rotor: inducer, impeller, shaft, turbine ---------- */
    add(revolve([[0, -0.3], [0.036, -0.3], [0.036, 0.3], [0.03, 0.33], [0.012, 0.35], [0, 0.352]], 64), M.rotor, this.rotor)
    for (let k = 0; k < 3; k++) add(helixBlade(0.03, 0.094, 0.25, 0.345, 0.55, 0.005, (k / 3) * Math.PI * 2), M.rotor, this.rotor)
    // impeller hub, blades, shroud
    add(revolve(spline2([[0.036, 0.232], [0.05, 0.2], [0.09, 0.168], [0.15, 0.158], [0.158, 0.162], [0.158, 0.156], [0.036, 0.15]], 6), 128), M.rotor, this.rotor)
    for (let i = 0; i < 8; i++) add(impellerBlade(0.05, 0.156, 0.226, 0.236, 0.162, 0.19, -1.2, 0.006, (i / 8) * Math.PI * 2), M.rotor, this.rotor)
    for (let i = 0; i < 8; i++) add(impellerBlade(0.1, 0.156, 0.19, 0.2, 0.162, 0.19, -0.7, 0.005, ((i + 0.5) / 8) * Math.PI * 2 - 0.25), M.rotor, this.rotor)
    add(revolve(spline2([[0.098, 0.242], [0.104, 0.236], [0.13, 0.205], [0.158, 0.192], [0.158, 0.198], [0.132, 0.212], [0.108, 0.244]], 6), 128), M.rotor, this.rotor)
    // turbine disc and blades
    add(revolve([[0.036, -0.215], [0.118, -0.22], [0.126, -0.232], [0.118, -0.246], [0.036, -0.25]], 128), M.bladeHot, this.rotor)
    {
      const g = new THREE.BoxGeometry(0.058, 0.03, 0.0045)
      const mats = ringMatrices(54, 0.157, -0.232, 0)
      mats.forEach((m) => m.multiply(new THREE.Matrix4().makeRotationX(38 * D)))
      inst(g, M.bladeHot, mats, this.rotor)
      add(revolve(ringProfile(0.186, 0.19, -0.248, -0.216), 128), M.bladeHot, this.rotor)
    }
    this.root.add(this.rotor)

    /* ---------- cavitation bubbles ---------- */
    const bg = new THREE.SphereGeometry(1, 10, 8)
    const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.0), transparent: true, opacity: 0.85, depthWrite: false })
    this.bubbles = new THREE.InstancedMesh(bg, bm, 220)
    this.bubbles.layers.set(2)
    this.bubbles.frustumCulled = false
    this.root.add(this.bubbles)
    const rnd = rng(11)
    for (let i = 0; i < 220; i++) this.bubbleSeeds.push({ a: rnd() * Math.PI * 2, r: 0.06 + rnd() * 0.035, ph: rnd(), sp: 0.7 + rnd() * 0.6 })

    /* ---------- cradle ---------- */
    const cradle = new THREE.Group()
    this.root.add(cradle)
    // saddles under the casing (local +x points down to the pedestal)
    for (const [y, r] of [[0.33, 0.122], [-0.02, 0.118], [-0.33, 0.205]] as [number, number][]) {
      const foot = new THREE.BoxGeometry(0.05, 0.05, 0.3)
      foot.translate(0.33, y, 0)
      add(foot, M.stand, cradle)
      const web = new THREE.BoxGeometry(0.353 - r, 0.03, 0.2)
      web.translate(r + (0.353 - r) / 2 - 0.02, y, 0)
      add(web, M.stand, cradle)
      const strap = new THREE.TorusGeometry(r + 0.006, 0.006, 8, 40, Math.PI)
      strap.rotateX(Math.PI / 2)
      strap.rotateY(-Math.PI / 2)
      strap.translate(0, y, 0)
      add(strap, M.dark, cradle)
    }

    const A = (name: string, obj: THREE.Object3D, x: number, y: number, z: number) => { this.anchors[name] = [obj, new THREE.Vector3(x, y, z)] }
    A('inlet', inlet, 0, 0.45, 0.2)
    A('inducer', this.root, 0.07, 0.3, 0.1)
    A('impeller', this.root, 0.11, 0.18, 0.1)
    A('volute', pumpC, 0.27, 0.176, 0.2)
    A('bearings', brg, 0.1, 0.0, 0.12)
    A('stator', turb, 0.16, -0.19, 0.2)
    A('turbine', this.root, 0.16, -0.235, 0.1)
    A('hotgas', turb, 0.3, -0.185, 0.1)
    A('exhaust', turb, 0.22, -0.39, 0.25)
  }

  update(dt: number, t: number, speed: number, explode: number, strobe: boolean, cav: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    this.rotor.position.set(0, 0, 0)
    // visual spin: a few revolutions per second at full speed; strobe freezes it
    const omega = speed * 2.6 * Math.PI * 2
    this.angle += dt * omega
    const shown = strobe ? this.angle * 0.02 + Math.sin(t * 0.7) * 0.02 : this.angle
    this.rotor.rotation.y = shown

    // bubbles near the inducer tips, collapsing further in
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    for (let i = 0; i < this.bubbleSeeds.length; i++) {
      const b = this.bubbleSeeds[i]
      const life = (b.ph + t * 0.9 * b.sp) % 1
      const y = 0.33 - life * 0.16
      const a = b.a + shown + life * 1.4
      const r = b.r + life * 0.03
      p.set(Math.sin(a) * r, y, Math.cos(a) * r)
      const grow = Math.sin(Math.min(life / 0.75, 1) * Math.PI * 0.5)
      const collapse = life > 0.75 ? 1 - (life - 0.75) / 0.25 : 1
      const size = cav * 0.0065 * grow * collapse * (0.6 + 0.8 * ((i * 7919) % 13) / 13)
      s.setScalar(Math.max(size, 1e-5))
      m.compose(p, q, s)
      this.bubbles.setMatrixAt(i, m)
    }
    this.bubbles.instanceMatrix.needsUpdate = true
    this.bubbles.visible = cav > 0.01
  }
}
