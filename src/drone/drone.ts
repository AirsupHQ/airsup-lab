import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf } from '../core/materials'
import { revolve, pipe } from '../core/geometry'
import { CutState } from '../core/cut'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from '../fusion/plasma'
import { loft, wing, foil, strut, carbonTexture } from '../f1/f1'

/**
 * An industrial quadcopter at full size, in the class of the big inspection
 * drones: 0.9 m between opposite motors, 21 inch props, two hot swap 12S
 * batteries, RTK GPS, a stabilised camera and vision sensors on every side.
 * Built in its own frame: +x forward, +y up, +z to the right.
 */
export const DR = {
  mass: 6.5, // kg with batteries
  payload: 2.5, // kg
  d: 0.318, // m, motor offset along x and z (0.9 m diagonal)
  R: 0.266, // m, prop radius (21 inch)
  ct: 0.1, // thrust coefficient on n² D⁴
  fm: 0.7, // rotor figure of merit
  eta: 0.85, // motor and controller efficiency
  avionics: 35, // W
  battery: 526, // Wh, two packs
  usable: 0.9,
  cda: 0.12, // m², drag area
  hoverY: 1.75, // m, hover height of the body centre
}
const RHO = 1.225
const DISK = Math.PI * DR.R * DR.R

/** Motors: position (x, z) and spin (+1 counter clockwise seen from above). */
export const MOTORS: { x: number; z: number; dir: number; name: string }[] = [
  { x: DR.d, z: DR.d, dir: 1, name: 'Front right' },
  { x: -DR.d, z: -DR.d, dir: 1, name: 'Rear left' },
  { x: DR.d, z: -DR.d, dir: -1, name: 'Front left' },
  { x: -DR.d, z: DR.d, dir: -1, name: 'Rear right' },
]

export const rpmOf = (T: number) => 60 * Math.sqrt(Math.max(0, T) / (DR.ct * RHO * Math.pow(2 * DR.R, 4)))
/** Electrical power to hold one rotor at thrust T: momentum theory, figure of merit, drive losses. */
export const rotorWatts = (T: number) => Math.pow(Math.max(0, T), 1.5) / Math.sqrt(2 * RHO * DISK) / DR.fm / DR.eta

/**
 * The flight: a rigid body held by a cascaded controller, position outside,
 * attitude inside, mixed into four motor thrusts. Small angle model, enough to
 * show what a flight controller does against wind and weight.
 */
export class DroneSim {
  p = new THREE.Vector3(0, DR.hoverY, 0)
  v = new THREE.Vector3()
  tilt = new THREE.Vector2() // x: toward +x (nose down), y: toward +z (roll right)
  rate = new THREE.Vector2()
  integ = new THREE.Vector3()
  thrust = [0, 0, 0, 0]
  mass = DR.mass
  wind = new THREE.Vector3()
  target = new THREE.Vector3(0, DR.hoverY, 0)

  step(dt: number, wind: THREE.Vector3, mass: number) {
    const n = Math.max(1, Math.ceil(dt / 0.004))
    const h = dt / n
    this.mass = mass
    this.wind.copy(wind)
    for (let i = 0; i < n; i++) this.sub(h)
  }

  private sub(h: number) {
    const m = this.mass, g = 9.81
    const e = new THREE.Vector3().subVectors(this.target, this.p)
    this.integ.addScaledVector(e, h).clampLength(0, 4)
    // position loop: desired acceleration
    const a = new THREE.Vector3(
      2.4 * e.x - 3.0 * this.v.x + 0.9 * this.integ.x,
      3.2 * e.y - 3.2 * this.v.y + 0.8 * this.integ.y,
      2.4 * e.z - 3.0 * this.v.z + 0.9 * this.integ.z,
    )
    const lim = 0.5
    const want = new THREE.Vector2(THREE.MathUtils.clamp(a.x / g, -lim, lim), THREE.MathUtils.clamp(a.z / g, -lim, lim))
    // attitude loop: a stiff, well damped second order response
    const acc = new THREE.Vector2(180 * (want.x - this.tilt.x) - 24 * this.rate.x, 180 * (want.y - this.tilt.y) - 24 * this.rate.y)
    this.rate.addScaledVector(acc, h)
    this.tilt.addScaledVector(this.rate, h)
    const cos = Math.cos(Math.hypot(this.tilt.x, this.tilt.y))
    const T = (m * (g + a.y)) / Math.max(0.6, cos)
    // mixer: moment of inertia about 0.16 kg m², four motors on a square
    const I = 0.16
    const tp = I * acc.x, tr = I * acc.y
    for (let k = 0; k < 4; k++) {
      const M = MOTORS[k]
      this.thrust[k] = Math.max(0.5, T / 4 - Math.sign(M.x) * tp / (4 * DR.d) - Math.sign(M.z) * tr / (4 * DR.d))
    }
    // body: thrust along the tilted axis, gravity, drag from the air moving past
    const Tt = this.thrust.reduce((s, x) => s + x, 0)
    const rel = new THREE.Vector3().subVectors(this.wind, this.v)
    const drag = rel.clone().multiplyScalar(0.5 * RHO * DR.cda * rel.length())
    const F = new THREE.Vector3(Tt * Math.sin(this.tilt.x), Tt * cos - m * g, Tt * Math.sin(this.tilt.y)).add(drag)
    this.v.addScaledVector(F, h / m)
    this.p.addScaledVector(this.v, h)
  }

  rpm(k: number) { return rpmOf(this.thrust[k]) }
  watts() { return this.thrust.reduce((s, T) => s + rotorWatts(T), 0) + DR.avionics }
}

export const DRONE_FLOW = {
  air: { value: 0.6 },
  tip: { value: 0.5 },
  power: { value: 0 },
  signal: { value: 0 },
  sense: { value: 0 },
  wind: { value: 0 },
  rate: { value: 1 },
}

/* ---------------- the airframe ---------------- */

export class Drone {
  readonly root = new THREE.Group()
  readonly body = new THREE.Group()
  readonly cut: CutState
  readonly M: Record<string, THREE.MeshStandardMaterial>
  readonly parts: { group: THREE.Object3D; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly props: { spin: THREE.Group; blur: THREE.Mesh; blades: THREE.Object3D; dir: number }[] = []
  readonly gimbal = new THREE.Group()
  readonly camHead = new THREE.Group()
  /** downwash and tip vortices: they follow the drone's position but stay upright */
  readonly air = new THREE.Group()
  readonly flows: THREE.Mesh[] = []
  readonly inner: THREE.Mesh[] = []
  readonly senseMeshes: THREE.Mesh[] = []
  readonly lidar = new THREE.Group()
  private leds: THREE.MeshBasicMaterial[] = []
  private blurMat: THREE.ShaderMaterial

  constructor() {
    this.root.name = 'drone'
    this.root.rotation.order = 'YXZ'
    this.root.add(this.body)
    this.cut = new CutState(this.root, 0.6, 0.0)
    const cut = this.cut
    const carbonTex = carbonTexture()
    carbonTex.repeat.set(3, 3)
    const M = (this.M = {
      shell: surf({ color: 0x3a3d42, metalness: 0.15, roughness: 0.42, detail: 14, roughVar: 0.12, colorVar: 0.03, clearcoat: 0.25, clearcoatRoughness: 0.35, cut, capColor: 0x2a2c30, side: THREE.DoubleSide, name: 'dr-shell' }),
      light: surf({ color: 0xd9dce0, metalness: 0.05, roughness: 0.38, detail: 10, clearcoat: 0.3, cut, capColor: 0x8a8e94, side: THREE.DoubleSide, name: 'dr-light' }),
      dark: surf({ color: 0x17181b, metalness: 0.3, roughness: 0.5, detail: 6, cut, capColor: 0x2a2c30, name: 'dr-dark' }),
      carbon: surf({ color: 0xffffff, map: carbonTex, metalness: 0.25, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.08, cut, capColor: 0x222326, name: 'dr-carbon' }),
      prop: surf({ color: 0x141518, metalness: 0.2, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1, cut, capColor: 0x222326, side: THREE.DoubleSide, name: 'dr-prop' }),
      alu: surf({ color: 0x9aa0a8, metalness: 1, roughness: 0.3, detail: 12, anisotropy: 0.6, cut, capColor: 0x6a6f76, name: 'dr-alu' }),
      bell: surf({ color: 0x202226, metalness: 0.9, roughness: 0.32, detail: 10, anisotropy: 0.5, cut, capColor: 0x6a6f76, name: 'dr-bell' }),
      copper: surf({ color: 0xc27a3e, metalness: 1, roughness: 0.34, detail: 30, cut, capColor: 0xc27a3e, name: 'dr-copper' }),
      magnet: surf({ color: 0x6d7178, metalness: 0.9, roughness: 0.4, cut, capColor: 0x6d7178, name: 'dr-magnet' }),
      orange: surf({ color: 0xff7a1c, metalness: 0.1, roughness: 0.45, clearcoat: 0.3, cut, capColor: 0xff7a1c, name: 'dr-orange' }),
      pcb: surf({ color: 0x1b4d33, metalness: 0.3, roughness: 0.5, detail: 60, colorVar: 0.1, cut, capColor: 0x1b4d33, name: 'dr-pcb' }),
      chip: surf({ color: 0x111214, metalness: 0.4, roughness: 0.4, cut, capColor: 0x111214, name: 'dr-chip' }),
      glass: surf({ color: 0x07080a, metalness: 0.9, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, cut, capColor: 0x222222, name: 'dr-glass' }),
      cell: surf({ color: 0x2b3038, metalness: 0.6, roughness: 0.35, cut, capColor: 0x47c8ff, name: 'dr-cell' }),
      rubber: surf({ color: 0x1a1b1d, metalness: 0, roughness: 0.75, cut, capColor: 0x1a1b1d, name: 'dr-rubber' }),
    })

    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, inner = false) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      p.add(mesh)
      if (inner) this.inner.push(mesh)
      return mesh
    }
    const part = (dx: number, dy: number, dz = 0) => {
      const group = new THREE.Group()
      this.body.add(group)
      this.parts.push({ group, explode: new THREE.Vector3(dx, dy, dz) })
      return group
    }
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const glow = (color: THREE.ColorRepresentation, k: number) => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) })
      this.leds.push(m)
      return m
    }

    /* ---------------- body shell: an upper cover and the lower tub ---------------- */
    const top = part(0, 0.32)
    const GRAPH = 0x3a3d42, LIGHTC = 0xd9dce0, ORANGE = 0xff7a1c
    add(loft([
      { x: 0.27, y: 0.005, w: 0.045, t: 0.03, b: 0.02, n: 2.4, nb: 2.4 },
      { x: 0.22, y: 0.01, w: 0.1, t: 0.055, b: 0.035, n: 2.8, nb: 3 },
      { x: 0.1, y: 0.015, w: 0.135, t: 0.07, b: 0.045, n: 3.4, nb: 4 },
      { x: -0.08, y: 0.015, w: 0.14, t: 0.075, b: 0.05, n: 3.6, nb: 4 },
      { x: -0.24, y: 0.01, w: 0.12, t: 0.06, b: 0.045, n: 3.2, nb: 3.5 },
      { x: -0.3, y: 0.005, w: 0.07, t: 0.035, b: 0.03, n: 2.6, nb: 2.6 },
    ], (x, y, z) => (y > 0.06 && Math.abs(z) < 0.02 && x > -0.2 ? ORANGE : y > 0.03 ? LIGHTC : GRAPH), 12, 72), M.light, top).material = surf({ color: 0xffffff, vertexColors: true, metalness: 0.1, roughness: 0.4, detail: 10, clearcoat: 0.3, cut, capColor: 0x6a6e74, side: THREE.DoubleSide, name: 'dr-body' })
    ;(top.children[top.children.length - 1] as THREE.Mesh).userData.hollow = true
    // cooling vents along the sides
    for (const s of [-1, 1])
      for (let k = 0; k < 6; k++) add(new RoundedBoxGeometry(0.018, 0.006, 0.01, 1, 0.002), M.dark, top).position.set(-0.05 - k * 0.028, 0.03, s * 0.138)
    this.anchors.body = [top, V(0.0, 0.1, 0.12)]

    // two hot swap batteries slotted into the back, with charge lights
    const bat = part(-0.25, 0.25)
    for (const s of [-1, 1]) {
      const b = add(new RoundedBoxGeometry(0.2, 0.06, 0.075, 3, 0.012), M.light, bat)
      b.position.set(-0.14, 0.085, s * 0.05)
      add(new RoundedBoxGeometry(0.03, 0.02, 0.06, 2, 0.006), M.dark, bat).position.set(-0.245, 0.085, s * 0.05)
      for (let k = 0; k < 4; k++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.004, 0.008), glow(0x5aff9a, 2.4))
        l.position.set(-0.261, 0.085, s * 0.05 - 0.015 + k * 0.01)
        l.layers.set(LAYER_GLOW)
        bat.add(l)
      }
      // cells inside each pack, seen in the cutaway
      for (let c = 0; c < 6; c++) {
        const cell = add(new THREE.CylinderGeometry(0.0105, 0.0105, 0.065, 16).rotateZ(Math.PI / 2), M.cell, bat, true)
        cell.position.set(-0.14, 0.072 + (c % 2) * 0.024, s * 0.05 - 0.022 + Math.floor(c / 2) * 0.022)
      }
    }
    this.anchors.battery = [bat, V(-0.16, 0.12, 0.09)]

    // RTK antennas on folding masts, GPS dome
    const ant = part(0, 0.55)
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 10), M.dark, ant).position.set(0.02, 0.13, s * 0.09)
      add(revolve([[0, 0], [0.028, 0], [0.032, 0.012], [0.02, 0.024], [0, 0.026]], 32), M.light, ant).position.set(0.02, 0.2, s * 0.09)
    }
    add(revolve([[0, 0], [0.04, 0], [0.042, 0.006], [0.03, 0.018], [0, 0.022]], 40), M.light, ant).position.set(0.1, 0.075, 0)
    this.anchors.rtk = [ant, V(0.02, 0.24, 0.09)]

    /* ---------------- insides: flight controller, compute, power board ---------------- */
    const guts = part(0, 0.1)
    const board = add(new RoundedBoxGeometry(0.16, 0.006, 0.12, 1, 0.002), M.pcb, guts, true)
    board.position.set(0.02, 0.0, 0)
    for (const [x, z, w, d] of [[0.04, 0.02, 0.03, 0.03], [-0.02, -0.03, 0.02, 0.02], [0.07, -0.03, 0.015, 0.015], [-0.04, 0.035, 0.025, 0.012]] as const)
      add(new THREE.BoxGeometry(w, 0.005, d), M.chip, guts, true).position.set(x, 0.005, z)
    // the IMU in its damped cage
    const imu = add(new RoundedBoxGeometry(0.03, 0.018, 0.03, 2, 0.004), M.orange, guts, true)
    imu.position.set(0.0, 0.016, 0.0)
    // compute module with a finned heat sink and a fan
    add(new RoundedBoxGeometry(0.1, 0.012, 0.09, 1, 0.003), M.pcb, guts, true).position.set(0.1, 0.03, 0)
    for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.09, 0.022, 0.002), M.alu, guts, true).position.set(0.1, 0.048, -0.04 + k * 0.01)
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 24), M.dark, guts, true).position.set(-0.07, 0.035, 0)
    // power distribution under the battery bay
    add(new RoundedBoxGeometry(0.12, 0.006, 0.1, 1, 0.002), M.pcb, guts, true).position.set(-0.15, 0.03, 0)
    this.anchors.fc = [guts, V(0.0, 0.03, 0.0)]
    this.anchors.compute = [guts, V(0.1, 0.06, 0.04)]

    /* ---------------- arms, motors, props ---------------- */
    const blurG = new THREE.RingGeometry(0.03, DR.R, 64, 1).rotateX(-Math.PI / 2)
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        uniform float uK;
        void main() {
          float r = length(vP.xz) / ${DR.R.toFixed(3)};
          float a = 0.07 + 0.1 * smoothstep(0.55, 0.95, r) + 0.12 * smoothstep(0.93, 0.99, r) * (1.0 - smoothstep(0.99, 1.0, r));
          gl_FragColor = vec4(vec3(0.08, 0.085, 0.095), a * uK);
        }`,
      uniforms: { uK: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    // a 21 inch blade: twist from about 24 degrees at the root to 8 at the tip
    const bladeG = wing(0.035, DR.R, 28, (z) => {
      const u = (z - 0.035) / (DR.R - 0.035)
      const c = 0.034 + 0.028 * Math.sin(Math.PI * Math.min(1, u * 1.25)) * (1 - 0.35 * u) - 0.012 * u
      const a = -(0.42 - 0.28 * u)
      return { x: c * 0.45, y: 0.0, c, a }
    }, foil(0.09, 0.05), false)
    MOTORS.forEach((mo, k) => {
      const out = new THREE.Vector3(mo.x, 0, mo.z).normalize()
      const g = part(out.x * 0.28, 0.05, out.z * 0.28)
      const root = V(Math.sign(mo.x) * 0.11, 0.005, Math.sign(mo.z) * 0.1)
      const end = V(mo.x, 0.01, mo.z)
      // carbon tube arm with a folding hinge and its lock sleeve
      add(pipe(new THREE.LineCurve3(root.clone().lerp(end, 0.15), end.clone().lerp(root, 0.05)), { r: 0.017, tubular: 4, radial: 20 }), M.carbon, g)
      const hinge = add(new RoundedBoxGeometry(0.06, 0.045, 0.06, 2, 0.01), M.dark, g)
      hinge.position.copy(root.clone().lerp(end, 0.12))
      hinge.rotation.y = -Math.atan2(end.z - root.z, end.x - root.x)
      const sleeve = add(new THREE.CylinderGeometry(0.021, 0.021, 0.03, 20).rotateZ(Math.PI / 2), M.orange, g)
      sleeve.position.copy(root.clone().lerp(end, 0.26))
      sleeve.rotation.y = -Math.atan2(end.z - root.z, end.x - root.x)
      // motor: mount, stator with copper windings, magnet ring, rotating bell
      const mount = add(new THREE.CylinderGeometry(0.045, 0.04, 0.02, 32), M.dark, g)
      mount.position.set(mo.x, 0.0, mo.z)
      const stator = new THREE.Group()
      stator.position.set(mo.x, 0.035, mo.z)
      g.add(stator)
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.028, 24), M.alu, stator, true)
      for (let t = 0; t < 18; t++) {
        const tooth = add(new THREE.BoxGeometry(0.012, 0.024, 0.008), M.copper, stator, true)
        const a = (t / 18) * Math.PI * 2
        tooth.position.set(Math.cos(a) * 0.036, 0, Math.sin(a) * 0.036)
        tooth.rotation.y = -a
      }
      const spin = new THREE.Group()
      spin.position.set(mo.x, 0.01, mo.z)
      g.add(spin)
      add(revolve([[0.044, 0.008], [0.05, 0.008], [0.05, 0.058], [0.046, 0.064], [0.012, 0.066], [0.012, 0.074], [0, 0.074], [0, 0.058], [0.044, 0.058]], 48), M.bell, spin)
      for (let t = 0; t < 12; t++) {
        const hole = add(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), M.dark, spin)
        const a = (t / 12) * Math.PI * 2
        hole.position.set(Math.cos(a) * 0.03, 0.065, Math.sin(a) * 0.03)
      }
      for (let t = 0; t < 20; t++) {
        const mag = add(new THREE.BoxGeometry(0.005, 0.04, 0.012), M.magnet, spin, true)
        const a = (t / 20) * Math.PI * 2
        mag.position.set(Math.cos(a) * 0.043, 0.032, Math.sin(a) * 0.043)
        mag.rotation.y = -a
      }
      // prop: two blades on a clamp, a blur disc for when it is spinning fast
      const blades = new THREE.Group()
      blades.position.y = 0.082
      spin.add(blades)
      add(new THREE.CylinderGeometry(0.02, 0.024, 0.016, 24), M.alu, blades)
      for (const s of [1, -1]) {
        const b = add(bladeG, M.prop, blades)
        b.rotation.y = s > 0 ? 0 : Math.PI
        if (mo.dir < 0) b.scale.x = -1
      }
      const blur = new THREE.Mesh(blurG, this.blurMat)
      blur.position.set(mo.x, 0.092, mo.z)
      blur.renderOrder = 5
      g.add(blur)
      this.props.push({ spin, blur, blades, dir: mo.dir })
      // navigation light under each motor: red at the front, green at the back
      const led = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.004, 8, 32).rotateX(Math.PI / 2), glow(mo.x > 0 ? 0xff2a1a : 0x2aff6a, 2.6))
      led.position.set(mo.x, -0.012, mo.z)
      led.layers.set(LAYER_GLOW)
      g.add(led)
      // ESC and power wires along the arm
      add(pipe(new THREE.LineCurve3(V(root.x * 0.4, -0.01, root.z * 0.4), V(mo.x * 0.9, -0.01, mo.z * 0.9)), { r: 0.004, tubular: 4, radial: 8 }), M.orange, g, true)
      this.anchors['m' + k] = [g, V(mo.x, 0.14, mo.z)]
    })

    /* ---------------- landing gear ---------------- */
    const gear = part(0, -0.3)
    for (const s of [-1, 1]) {
      for (const x of [0.12, -0.14]) add(strut(V(x * 0.8, -0.04, s * 0.08), V(x, -0.32, s * 0.2), 0.03, 0.014), M.carbon, gear)
      add(pipe(new THREE.CatmullRomCurve3([V(0.22, -0.31, s * 0.2), V(0.18, -0.33, s * 0.2), V(-0.22, -0.33, s * 0.2), V(-0.26, -0.31, s * 0.2)]), { r: 0.011, tubular: 40, radial: 12 }), M.carbon, gear)
      for (const x of [0.15, -0.18]) add(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 16).rotateZ(Math.PI / 2), M.rubber, gear).position.set(x, -0.335, s * 0.2)
    }

    /* ---------------- gimbal camera under the nose ---------------- */
    const gim = part(0.25, -0.2)
    this.gimbal.position.set(0.19, -0.05, 0)
    gim.add(this.gimbal)
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 24), M.dark, this.gimbal)
    add(new RoundedBoxGeometry(0.02, 0.09, 0.02, 2, 0.006), M.dark, this.gimbal).position.set(-0.02, -0.055, 0.06)
    add(new RoundedBoxGeometry(0.02, 0.02, 0.14, 2, 0.006), M.dark, this.gimbal).position.set(-0.02, -0.02, 0)
    this.camHead.position.set(0, -0.1, 0)
    this.gimbal.add(this.camHead)
    add(new RoundedBoxGeometry(0.1, 0.075, 0.09, 3, 0.014), M.light, this.camHead)
    add(new THREE.CylinderGeometry(0.03, 0.033, 0.03, 32).rotateZ(Math.PI / 2), M.dark, this.camHead).position.set(0.06, 0, 0)
    add(new THREE.CircleGeometry(0.024, 32).rotateY(Math.PI / 2), M.glass, this.camHead).position.set(0.0755, 0, 0)
    add(new THREE.CircleGeometry(0.01, 24).rotateY(Math.PI / 2), M.glass, this.camHead).position.set(0.046, 0.025, 0.03)
    this.anchors.gimbal = [gim, V(0.25, -0.18, 0.06)]

    /* ---------------- vision sensors on every side, and a lidar ---------------- */
    const sense = part(0, 0)
    const eye = (p: THREE.Vector3, n: THREE.Vector3, sep: number, along: THREE.Vector3) => {
      for (const s of [-1, 1]) {
        const e = add(new THREE.CircleGeometry(0.009, 20), M.glass, sense)
        e.position.copy(p).addScaledVector(along, s * sep)
        e.lookAt(e.position.clone().add(n))
        const ring = add(new THREE.RingGeometry(0.009, 0.013, 20), M.dark, sense)
        ring.position.copy(e.position).addScaledVector(n, -0.001)
        ring.lookAt(ring.position.clone().add(n))
      }
    }
    eye(V(0.266, 0.03, 0), V(1, 0, 0), 0.03, V(0, 0, 1))
    eye(V(-0.295, 0.02, 0), V(-1, 0, 0), 0.025, V(0, 0, 1))
    eye(V(0.0, 0.03, 0.141), V(0, 0, 1), 0.04, V(1, 0, 0))
    eye(V(0.0, 0.03, -0.141), V(0, 0, -1), 0.04, V(1, 0, 0))
    eye(V(0.05, 0.091, 0), V(0, 1, 0), 0.04, V(1, 0, 0))
    eye(V(0.0, -0.036, 0), V(0, -1, 0), 0.035, V(1, 0, 0))
    // lidar puck up front
    this.lidar.position.set(0.2, 0.06, 0)
    sense.add(this.lidar)
    add(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 32), M.dark, this.lidar)
    add(new THREE.CylinderGeometry(0.0205, 0.0205, 0.008, 32), M.glass, this.lidar).position.y = 0.006
    this.anchors.eyes = [sense, V(0.27, 0.04, 0.05)]
    // what the sensors see: six cones and a sweeping lidar fan
    const senseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.75, 1), transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    const cone = (dir: THREE.Vector3, at: THREE.Vector3, len: number, ang: number) => {
      const g = new THREE.ConeGeometry(Math.tan(ang) * len, len, 32, 1, true)
      g.translate(0, -len / 2, 0)
      const m = new THREE.Mesh(g, senseMat)
      m.position.copy(at)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize())
      m.layers.set(LAYER_GLOW)
      m.userData.fluid = 'glow'
      this.body.add(m)
      this.senseMeshes.push(m)
    }
    cone(V(1, 0, 0), V(0.27, 0.03, 0), 2.6, 0.6)
    cone(V(-1, 0, 0), V(-0.3, 0.02, 0), 2.0, 0.55)
    cone(V(0, 0, 1), V(0, 0.03, 0.14), 2.0, 0.6)
    cone(V(0, 0, -1), V(0, 0.03, -0.14), 2.0, 0.6)
    cone(V(0, 1, 0), V(0.05, 0.09, 0), 1.6, 0.6)
    cone(V(0, -1, 0), V(0, -0.04, 0), 1.7, 0.55)
    const rayM = glowLineMaterial(cut, { color: 0x7de0ff, emph: DRONE_FLOW.sense, speed: 3, scale: 0.08, base: 0.5 })
    for (let k = 0; k < 13; k++) {
      const a = -0.6 + (k / 12) * 1.2
      const r = new THREE.Mesh(pipe(new THREE.LineCurve3(V(0, 0.006, 0), V(Math.cos(a) * 2.4, -0.2 + 0.03 * k, Math.sin(a) * 2.4)), { r: 0.0025, tubular: 2, radial: 4 }), rayM)
      r.layers.set(LAYER_GLOW)
      r.userData.fluid = 'glow'
      this.lidar.add(r)
      this.senseMeshes.push(r)
    }

    /* ---------------- power and control signals ---------------- */
    const line = (pts: THREE.Vector3[], color: number, emph: { value: number }, r = 0.004) => {
      const m = glowLineMaterial(cut, { color, emph, rate: DRONE_FLOW.rate, speed: 1.6, scale: 0.06, base: 0.3 })
      const mesh = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts), { r, tubular: 60, radial: 6 }), m)
      mesh.layers.set(LAYER_GLOW)
      mesh.userData.fluid = 'glow'
      this.body.add(mesh)
      this.flows.push(mesh)
      mesh.userData.kind = 'inner'
    }
    for (const mo of MOTORS) {
      // battery to the power board to each motor
      line([V(-0.14, 0.085, 0), V(-0.15, 0.035, 0), V(-0.05, 0.0, 0), V(mo.x * 0.5, -0.005, mo.z * 0.5), V(mo.x, 0.02, mo.z)], 0xffa13a, DRONE_FLOW.power)
      // flight controller to each motor controller
      line([V(0.0, 0.018, 0), V(0.02, 0.01, mo.z * 0.2), V(mo.x * 0.6, 0.005, mo.z * 0.6), V(mo.x, 0.03, mo.z)], 0x5aff9a, DRONE_FLOW.signal, 0.003)
    }
    // sensors into the compute module, compute into the flight controller
    for (const p of [V(0.266, 0.03, 0.03), V(0.0, 0.03, 0.14), V(0.0, 0.03, -0.14), V(-0.29, 0.02, 0.02), V(0.2, 0.06, 0)])
      line([p, p.clone().multiplyScalar(0.5).add(V(0.05, 0.04, 0)), V(0.1, 0.045, 0)], 0x7de0ff, DRONE_FLOW.sense, 0.003)
    line([V(0.1, 0.045, 0), V(0.05, 0.03, 0), V(0.0, 0.02, 0)], 0x5aff9a, DRONE_FLOW.signal, 0.003)

    /* ---------------- the air: downwash through each rotor, tip vortices ---------------- */
    const airM = glowLineMaterial(cut, { color: 0x9fd8ff, emph: DRONE_FLOW.air, rate: DRONE_FLOW.rate, speed: 3.0, scale: 0.18, base: 0.15 })
    const tipM = glowLineMaterial(cut, { color: 0xd4f0ff, emph: DRONE_FLOW.tip, rate: DRONE_FLOW.rate, speed: 3.0, scale: 0.1, base: 0.12 })
    const H = DR.hoverY
    for (const mo of MOTORS) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3
        const ca = Math.cos(a), sa = Math.sin(a)
        const at = (r: number, y: number) => V(mo.x + ca * r, y, mo.z + sa * r)
        // air is drawn in from above and around, squeezed through the disc, contracts below it,
        // then hits the floor and spreads out
        const R = DR.R
        const pts = [at(R * 1.9, 0.75), at(R * 1.35, 0.35), at(R * 0.9, 0.1), at(R * 0.8, 0.0), at(R * 0.72, -0.25), at(R * 0.7, -0.7), at(R * 0.75, -H + 0.45), at(R * 1.3, -H + 0.12), at(R * 3.2, -H + 0.05)]
        const m = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.0035, tubular: 120, radial: 5 }), airM)
        m.layers.set(LAYER_GLOW)
        m.userData.fluid = 'glow'
        this.air.add(m)
        this.flows.push(m)
      }
      // a tip vortex: a helix shed by the blade tips, sinking and pulling inward
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 140; i++) {
        const u = i / 140
        const a = u * 7 * Math.PI * 2 * mo.dir
        const r = DR.R * (0.98 - 0.25 * Math.min(1, u * 2))
        pts.push(V(mo.x + Math.cos(a) * r, 0.08 - u * 0.9, mo.z + Math.sin(a) * r))
      }
      const tm = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.0025, tubular: 420, radial: 4 }), tipM)
      tm.layers.set(LAYER_GLOW)
      tm.userData.fluid = 'glow'
      this.air.add(tm)
      this.flows.push(tm)
    }
  }

  /** After the cut has collected its meshes: the outer shell is a thin skin with no caps. */
  hollowSkins() {
    this.root.traverse((o) => {
      if (!o.userData.hollow) return
      const m = o as THREE.Mesh
      this.cut.meshes.delete(m)
      m.geometry.clearGroups()
      m.material = (m.userData.front ?? m.material) as THREE.Material
    })
  }

  /**
   * sim state into the model: explode 0..1, prop angles, visible spin speed per
   * prop (rad/s, for the blur), t seconds.
   */
  update(sim: DroneSim, base: THREE.Vector3, explode: number, angles: number[], omegas: number[], t: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    this.root.position.copy(base).add(sim.p)
    this.root.rotation.set(sim.tilt.y, 0, -sim.tilt.x)
    // the gimbal cancels the body's tilt so the camera stays level
    this.gimbal.rotation.set(-sim.tilt.y, 0, sim.tilt.x)
    this.air.position.copy(this.root.position)
    this.props.forEach((p, k) => {
      p.spin.rotation.y = angles[k] * p.dir
      const w = omegas[k]
      const blur = THREE.MathUtils.clamp((w - 40) / 120, 0, 1)
      ;(this.blurMat.uniforms.uK as { value: number }).value = blur
      p.blur.visible = blur > 0.02
    })
    this.lidar.rotation.y = t * 2.2
  }
}

/* ---------------- the flight cage with a fan wall ---------------- */

export class DroneCage {
  readonly group = new THREE.Group()
  readonly fans: THREE.Group[] = []
  readonly windLines: THREE.Mesh[] = []
  readonly lights: THREE.Light[] = []

  constructor(at: THREE.Vector3, cut: CutState) {
    const G = this.group
    G.position.copy(at)
    const frame = surf({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35, detail: 4, name: 'cage-frame' })
    const mat = surf({ color: 0x1d2024, metalness: 0.2, roughness: 0.8, detail: 3, name: 'cage-mat' })
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, cast = true) => {
      const o = new THREE.Mesh(g, m)
      o.position.set(x, y, z)
      o.castShadow = cast
      o.receiveShadow = true
      G.add(o)
      return o
    }
    const X = 3.6, Z0 = -3.0, Z1 = 3.2, HT = 4.6
    add(new THREE.BoxGeometry(2 * X + 0.4, 0.04, Z1 - Z0 + 0.4), mat, 0, 0.02, (Z0 + Z1) / 2, false)
    // landing pad: a ring and an H
    const padM = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.78, 96).rotateX(-Math.PI / 2), padM)
    ring.position.set(0, 0.042, 0)
    G.add(ring)
    for (const z of [-0.22, 0.22]) add(new THREE.BoxGeometry(0.6, 0.004, 0.07), padM, 0, 0.042, z, false)
    add(new THREE.BoxGeometry(0.07, 0.004, 0.44), padM, 0, 0.042, 0, false)
    // posts and top frame; netting on the back, the sides and the top, open to the front
    for (const x of [-X, 0, X]) add(new THREE.BoxGeometry(0.08, HT, 0.08), frame, x, HT / 2, Z0)
    for (const x of [-X, X]) add(new THREE.BoxGeometry(0.08, HT, 0.08), frame, x, HT / 2, Z1)
    for (const z of [Z0, Z1]) add(new THREE.BoxGeometry(2 * X, 0.08, 0.08), frame, 0, HT, z)
    for (const x of [-X, X]) add(new THREE.BoxGeometry(0.08, 0.08, Z1 - Z0), frame, x, HT, (Z0 + Z1) / 2)
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    g.strokeStyle = 'rgba(200,210,225,0.55)'
    g.lineWidth = 2
    g.strokeRect(1, 1, 62, 62)
    const netTex = new THREE.CanvasTexture(c)
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
    const net = (w: number, h: number) => {
      const t = netTex.clone()
      t.needsUpdate = true
      t.repeat.set(w / 0.1, h / 0.1)
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, HT), net(2 * X, HT))
    back.position.set(0, HT / 2, Z0)
    G.add(back)
    const topN = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, Z1 - Z0).rotateX(Math.PI / 2), net(2 * X, Z1 - Z0))
    topN.position.set(0, HT, (Z0 + Z1) / 2)
    G.add(topN)
    const side = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - Z0, HT).rotateY(Math.PI / 2), net(Z1 - Z0, HT))
    side.position.set(X, HT / 2, (Z0 + Z1) / 2)
    G.add(side)
    // fan wall on the -x side: nine ducted fans that make the wind
    const duct = surf({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4, detail: 4, name: 'fan-duct' })
    const bladeM = surf({ color: 0x8e949b, metalness: 0.9, roughness: 0.35, name: 'fan-blade' })
    add(new THREE.BoxGeometry(0.3, 3.3, 3.3), frame, -X - 0.1, 1.9, 0.1)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const y = 0.85 + i * 1.05, z = -0.95 + j * 1.05
        const d = new THREE.Mesh(revolve([[0.44, -0.12], [0.5, -0.12], [0.5, 0.12], [0.44, 0.12]], 64).rotateZ(Math.PI / 2), duct)
        d.position.set(-X + 0.1, y, z)
        G.add(d)
        const fan = new THREE.Group()
        fan.position.set(-X + 0.1, y, z)
        G.add(fan)
        fan.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), duct))
        for (let b = 0; b < 7; b++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.12), bladeM)
          const a = (b / 7) * Math.PI * 2
          bl.position.set(0, Math.cos(a) * 0.25, Math.sin(a) * 0.25)
          bl.rotation.x = -a
          bl.rotation.y = 0.5
          fan.add(bl)
        }
        this.fans.push(fan)
      }
    // wind streaks from the fan wall across the cage
    const windM = glowLineMaterial(cut, { color: 0xbfe6ff, emph: DRONE_FLOW.wind, rate: DRONE_FLOW.rate, speed: 3.2, scale: 0.4, base: 0.05 })
    for (let k = 0; k < 18; k++) {
      const y = 0.9 + (k % 6) * 0.35, z = -1.1 + Math.floor(k / 6) * 1.1 + ((k * 37) % 7) * 0.05
      const pts = [new THREE.Vector3(-X + 0.3, y, z), new THREE.Vector3(-1.2, y + 0.02, z), new THREE.Vector3(-0.3, y + (Math.abs(y - DR.hoverY) < 0.4 ? 0.35 * Math.sign(y - DR.hoverY + 0.01) : 0.04), z), new THREE.Vector3(0.9, y - 0.08, z), new THREE.Vector3(X - 0.2, y - 0.1, z)]
      const m = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.004, tubular: 80, radial: 5 }), windM)
      m.layers.set(LAYER_GLOW)
      m.userData.fluid = 'glow'
      G.add(m)
      this.windLines.push(m)
    }
    // lights
    const key = new THREE.SpotLight(0xfff4e8, 110, 12, 0.7, 0.6, 2)
    key.position.set(0.6, 4.4, 1.2)
    key.target.position.set(0, 1.4, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.camera.near = 1
    key.shadow.camera.far = 7
    G.add(key, key.target)
    const rim = new THREE.SpotLight(0x9cc4ff, 70, 12, 0.7, 0.7, 2)
    rim.position.set(-2.6, 3.2, -2.6)
    rim.target.position.set(0, 1.6, 0)
    G.add(rim, rim.target)
    const fill = new THREE.SpotLight(0xffe2c4, 35, 12, 0.8, 0.8, 2)
    fill.position.set(2.8, 1.4, 3.6)
    fill.target.position.set(0, 1.5, 0)
    G.add(fill, fill.target)
    this.lights.push(key, rim, fill)
    // partition from the F1 bay
    const wallM = surf({ color: 0x15171b, metalness: 0.2, roughness: 0.7, detail: 2, name: 'dr-wall' })
    add(new THREE.BoxGeometry(0.2, 5.2, 6.4), wallM, -X - 0.9, 2.6, -1.4, false)
  }
}
