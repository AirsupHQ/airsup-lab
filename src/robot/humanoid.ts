import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { revolve, pipe, P2 } from '../core/geometry'
import { CutState } from '../core/cut'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from '../fusion/plasma'
import { rotaryActuator, LinearActuator, loadRing } from './actuators'

/**
 * A general purpose humanoid at human scale (1.73 m), built as a real
 * kinematic chain: every joint is a group that rotates, every limb carries its
 * actuator, and the white shells sit on top so they can be scanned away or
 * lifted off. The robot's own frame: +z forward, +y up, +x to its left.
 */

export const HUMAN = {
  height: 1.73,
  mass: 63, // kg
  battery: 2.3, // kWh
  actuators: 28,
  thigh: 0.42,
  shin: 0.42,
  ankleH: 0.085,
  hipW: 0.105,
  upperArm: 0.29,
  forearm: 0.26,
  shoulderW: 0.215,
}

/** Live emphasis, animated by main. */
export const BOT = {
  power: { value: 0.3 },
  tendon: { value: 0.2 },
  rate: { value: 1 },
}

export type Joint =
  | 'waist' | 'neck'
  | 'lHip' | 'rHip' | 'lKnee' | 'rKnee' | 'lAnkle' | 'rAnkle'
  | 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lWrist' | 'rWrist'

export interface Pose {
  hip: [number, number]
  hipRoll: [number, number]
  knee: [number, number]
  ankle: [number, number]
  shoulder: [number, number]
  shoulderOut: [number, number]
  elbow: [number, number]
  waist: number
  twist: number
  head: number
  grip: number
  /** pelvis yaw and roll, and sideways sway toward the standing leg (m) */
  pelvisYaw: number
  pelvisRoll: number
  sway: number
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

/**
 * A sculpted cover: a closed solid lofted down -y through superellipse
 * sections. rx and rz give the half widths at t (0 top, 1 bottom), dz shifts
 * the section forward. Ends are rounded off.
 */
/** Give a geometry a flat vertex colour: white (1) or graphite (0). */
export function paintAll(g: THREE.BufferGeometry, white: number) {
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  const v = white ? [1, 1, 1] : [0.075, 0.078, 0.085]
  for (let i = 0; i < n; i++) c.set(v, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

export function loftShell(len: number, rx: (t: number) => number, rz: (t: number) => number, dz: (t: number) => number = () => 0, n = 2.4, seg = 48, rings = 36, paint: (t: number, a: number) => number = () => 0) {
  const pos: number[] = []
  const col: number[] = []
  const WHITE = [1, 1, 1], DARK = [0.075, 0.078, 0.085]
  const idx: number[] = []
  const cap = 0.1
  const ts: number[] = []
  for (let i = 0; i <= rings; i++) ts.push(i / rings)
  const rows: number[] = []
  for (const t of ts) {
    // round the ends: shrink toward the poles
    const e0 = t < cap ? Math.sqrt(1 - Math.pow(1 - t / cap, 2)) : 1
    const e1 = t > 1 - cap ? Math.sqrt(1 - Math.pow(1 - (1 - t) / cap, 2)) : 1
    const k = Math.max(0.02, Math.min(e0, e1))
    rows.push(pos.length / 3)
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const c = Math.cos(a), sn = Math.sin(a)
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * rx(t) * k
      const z = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * rz(t) * k + dz(t)
      pos.push(x, -t * len, z)
      const k2 = Math.min(1, Math.max(0, paint(t, a)))
      for (let q = 0; q < 3; q++) col.push(WHITE[q] + (DARK[q] - WHITE[q]) * k2)
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = rows[i] + j, b = rows[i] + ((j + 1) % seg), c = rows[i + 1] + j, d = rows[i + 1] + ((j + 1) % seg)
    idx.push(a, b, c, b, d, c)
  }
  // close both ends with a fan
  const top = pos.length / 3
  pos.push(0, 0, dz(0))
  col.push(...(paint(0, 0) > 0.5 ? DARK : WHITE))
  const bot = pos.length / 3
  pos.push(0, -len, dz(1))
  col.push(...(paint(1, 0) > 0.5 ? DARK : WHITE))
  for (let j = 0; j < seg; j++) {
    idx.push(top, rows[0] + ((j + 1) % seg), rows[0] + j)
    idx.push(bot, rows[rings] + j, rows[rings] + ((j + 1) % seg))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const uv = new Float32Array((pos.length / 3) * 2)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** Keyframed periodic curve over the gait cycle (p in 0..1), values in degrees. */
function curve(keys: [number, number][]) {
  return (p: number) => {
    p = ((p % 1) + 1) % 1
    const n = keys.length
    let i = 0
    while (i < n - 1 && keys[i + 1][0] <= p) i++
    const k0 = keys[(i - 1 + n) % n], k1 = keys[i], k2 = keys[(i + 1) % n], k3 = keys[(i + 2) % n]
    const span = ((k2[0] - k1[0]) + 1) % 1 || 1
    const u = (((p - k1[0]) + 1) % 1) / span
    // Catmull-Rom through the neighbours
    const a = k0[1], b = k1[1], c = k2[1], d = k3[1]
    const v = 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u)
    return (v * Math.PI) / 180
  }
}
/**
 * Sagittal joint angles over one stride, heel strike at 0, from the shape of
 * normal human walking (hip flexion, knee flexion, ankle dorsiflexion).
 */
const HIP = curve([[0, 24], [0.12, 20], [0.3, 6], [0.5, -10], [0.6, -4], [0.72, 16], [0.86, 27], [0.94, 25]])
const KNEE = curve([[0, 4], [0.14, 17], [0.3, 7], [0.42, 5], [0.52, 14], [0.62, 38], [0.72, 58], [0.82, 42], [0.92, 10]])
const ANKLE = curve([[0, 0], [0.07, -6], [0.2, 4], [0.45, 9], [0.56, -2], [0.63, -16], [0.72, -6], [0.86, 1], [0.95, 0]])

const GHOST_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
}
`
const GHOST_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
varying vec3 vN;
varying vec3 vV;
uniform vec3 uColor;
uniform float uK;
void main() {
  #include <clipping_planes_fragment>
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  gl_FragColor = vec4(uColor * (0.03 + pow(f, 2.5) * 0.6) * uK, 1.0);
}
`

interface Shell { mesh: THREE.Mesh; base: THREE.Vector3; out: THREE.Vector3 }

export class Humanoid {
  readonly root = new THREE.Group()
  readonly body = new THREE.Group()
  readonly J = {} as Record<Joint, THREE.Group>
  readonly actuators: { joint: Joint; ring: THREE.MeshBasicMaterial; kind: string }[] = []
  readonly linears: { act: LinearActuator; a: [THREE.Object3D, THREE.Vector3]; b: [THREE.Object3D, THREE.Vector3]; joint: Joint }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly M: Record<string, THREE.MeshStandardMaterial>
  readonly shells: Shell[] = []
  readonly shellMats: THREE.Material[] = []
  readonly solidPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 10)
  readonly ghostPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), -10)
  readonly box: THREE.Group
  readonly cells: THREE.MeshStandardMaterial
  private ghostMat: THREE.ShaderMaterial
  private ghost = new THREE.Group()
  private scan: THREE.Mesh
  private fingers: { g: THREE.Group; k: number }[] = []
  private feet: THREE.Object3D[] = []
  private noCut: CutState
  beltStep = 0
  private lastStance = -1
  private lastStanceZ = 0

  constructor() {
    this.root.name = 'humanoid'
    this.root.add(this.body)
    this.noCut = new CutState(new THREE.Object3D(), 1e4)
    this.noCut.update()
    const M = (this.M = {
      shell: surf({ vertexColors: true, color: 0xf3f2ee, metalness: 0.02, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, sheen: 0.25, sheenColor: 0xffffff, detail: 3, colorVar: 0.008, roughVar: 0.12, name: 'bot-shell' }),
      seam: surf({ color: 0x1a1b1e, metalness: 0.2, roughness: 0.5, name: 'bot-seam' }),
      black: surf({ color: 0x151619, metalness: 0.3, roughness: 0.4, clearcoat: 0.5, detail: 3, name: 'bot-black' }),
      visor: surf({ color: 0x07080a, metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1.4, name: 'bot-visor' }),
      frame: surf({ color: 0x5d6168, metalness: 1, roughness: 0.38, detail: 6, anisotropy: 0.4, name: 'bot-frame' }),
      act: surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.28, detail: 8, anisotropy: 0.5, emissive: 0x000000, name: 'bot-actuator' }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.3, detail: 6, name: 'bot-gold' }),
      rubber: surf({ color: 0x1b1c1f, metalness: 0, roughness: 0.75, detail: 10, name: 'bot-rubber' }),
      pcb: surf({ color: 0x1d4a36, metalness: 0.3, roughness: 0.5, detail: 20, name: 'bot-pcb' }),
    })
    this.cells = surf({ color: 0x2f3640, metalness: 0.8, roughness: 0.3, detail: 10, emissive: 0x47c8ff, emissiveIntensity: 0, name: 'bot-cells' })
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const joint = (name: Joint, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group()
      g.position.set(x, y, z)
      parent.add(g)
      this.J[name] = g
      return g
    }
    /** a white cover piece; `out` is where it goes in the exploded view (joint local) */
    const shell = (g: THREE.BufferGeometry, p: THREE.Object3D, pos: [number, number, number], out: [number, number, number], m: THREE.Material = M.shell) => {
      if (m === M.shell && !g.getAttribute('color')) paintAll(g, 1)
      const mesh = add(g, m, p)
      mesh.position.set(...pos)
      this.shells.push({ mesh, base: mesh.position.clone(), out: new THREE.Vector3(...out) })
      return mesh
    }
    /** Rotary actuator classes, after Tesla's published Optimus set: 20, 110 and 180 Nm. */
    const SIZE = { 20: [0.024, 0.042], 110: [0.038, 0.058], 180: [0.048, 0.07] } as const
    const actuator = (name: Joint, p: THREE.Object3D, nm: 20 | 110 | 180, axis: 'x' | 'y' | 'z', at: [number, number, number], flip = 1) => {
      const [r, len] = SIZE[nm]
      const { root } = rotaryActuator(r, len)
      if (axis === 'x') root.rotation.z = -flip * Math.PI / 2
      if (axis === 'z') root.rotation.x = flip * Math.PI / 2
      if (axis === 'y' && flip < 0) root.rotation.x = Math.PI
      root.position.set(...at)
      p.add(root)
      const lr = loadRing(r * 1.1)
      lr.mesh.position.y = len * 0.18
      root.add(lr.mesh)
      this.actuators.push({ joint: name, ring: lr.mat, kind: `rotary ${nm} Nm` })
      return root
    }
    /** Linear actuator classes: 500, 3,900 and 8,000 N. It spans two mounting points on two bodies. */
    const linear = (name: Joint, force: 500 | 3900 | 8000, a: [THREE.Object3D, [number, number, number]], b: [THREE.Object3D, [number, number, number]]) => {
      const dims = { 500: [0.008, 0.06], 3900: [0.015, 0.12], 8000: [0.021, 0.16] } as const
      const [r, body] = dims[force]
      const act = new LinearActuator(r, body)
      this.body.add(act.root)
      const lr = loadRing(r * 1.35)
      lr.mesh.position.y = body * 0.75
      act.root.add(lr.mesh)
      this.actuators.push({ joint: name, ring: lr.mat, kind: `linear ${force} N` })
      this.linears.push({ act, a: [a[0], new THREE.Vector3(...a[1])], b: [b[0], new THREE.Vector3(...b[1])], joint: name })
      return act
    }
    const bone = (p: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) => add(pipe(new THREE.LineCurve3(a, b), { r, tubular: 2, radial: 12 }), M.frame, p)
    /** soft edged paint masks for the two tone skin */
    const band = (x: number, a: number, b: number, w = 0.03) => smooth((x - a) / w) * (1 - smooth((x - b) / w))
    const angBand = (a: number, c: number, half: number) => { const d = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))); return 1 - smooth((d - half) / 0.12) }
    const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe0ff).multiplyScalar(2.4) })
    const glowLine = (g: THREE.BufferGeometry, p: THREE.Object3D) => { const m = new THREE.Mesh(g, accent); m.layers.set(LAYER_GLOW); m.userData.fluid = 'glow'; p.add(m); return m }
    /** a soft black cover over a joint, a short rounded drum across its axis */
    const jointCover = (p: THREE.Object3D, r: number, w: number, at: [number, number, number] = [0, 0, 0]) => {
      const m = add(revolve([[0, -w / 2], [r * 0.9, -w / 2], [r, -w / 2 + r * 0.15], [r, w / 2 - r * 0.15], [r * 0.9, w / 2], [0, w / 2]], 40, 50), M.black, p)
      m.rotation.z = Math.PI / 2
      m.position.set(...at)
      return m
    }
    const capsuleShell = (len: number, r0: number, r1: number) => revolve([[0, 0], [r1 * 0.7, 0], [r1, 0.02], [r0, len - 0.03], [r0 * 0.7, len], [0, len]], 32, 60)

    const B = this.body
    /* ---------------- pelvis and torso ---------------- */
    const pelvis = new THREE.Group()
    pelvis.position.y = HUMAN.thigh + HUMAN.shin + HUMAN.ankleH + 0.035
    B.add(pelvis)
    this.anchors.pelvis = [pelvis, new THREE.Vector3(0, 0, 0.1)]
    shell(loftShell(0.2, (t) => 0.13 + 0.03 * Math.sin(Math.PI * Math.min(1, t * 1.3)) - 0.02 * t * t, (t) => 0.092 - 0.02 * t * t, () => 0.004, 2.6, 64, 36, (t) => band(t, 0.62, 1.2)), pelvis, [0, 0.11, 0], [0, 0, 0.18])
    add(new RoundedBoxGeometry(0.24, 0.08, 0.14, 2, 0.02), M.black, pelvis).position.y = -0.04
    const waist = joint('waist', pelvis, 0, 0.09, 0)
    actuator('waist', waist, 180, 'y', [0, 0.02, 0])
    actuator('waist', waist, 180, 'x', [0, 0.12, -0.02])
    // a ribbed rubber boot closes the waist between pelvis and chest
    add(loftShell(0.16, (t) => 0.118 + 0.006 * Math.cos(t * Math.PI * 12), (t) => 0.082 + 0.005 * Math.cos(t * Math.PI * 12), () => 0, 2.6, 56, 60), M.black, waist).position.y = 0.155
    const chest = new THREE.Group()
    chest.position.y = 0.17
    waist.add(chest)
    // battery pack and computer inside the chest
    const pack = add(new RoundedBoxGeometry(0.22, 0.2, 0.1, 2, 0.01), M.frame, chest)
    pack.position.set(0, 0.12, -0.005)
    {
      const cellG = new THREE.CylinderGeometry(0.0105, 0.0105, 0.065, 10)
      const n = 6 * 7
      const im = new THREE.InstancedMesh(cellG, this.cells, n)
      const m = new THREE.Matrix4()
      for (let i = 0; i < n; i++) {
        im.setMatrixAt(i, m.makeTranslation(-0.075 + (i % 7) * 0.025, 0.04 + Math.floor(i / 7) * 0.028, 0.05))
      }
      im.castShadow = true
      chest.add(im)
    }
    add(new RoundedBoxGeometry(0.16, 0.1, 0.012, 1, 0.003), M.pcb, chest).position.set(0, 0.26, 0.055)
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.025, 0.025, 0.006), M.black, chest).position.set(-0.05 + i * 0.033, 0.26, 0.064)
    this.anchors.battery = [chest, new THREE.Vector3(0.1, 0.12, 0.09)]
    this.anchors.computer = [chest, new THREE.Vector3(-0.06, 0.27, 0.08)]
    // spine frame
    bone(chest, new THREE.Vector3(0, -0.15, -0.06), new THREE.Vector3(0, 0.3, -0.06), 0.018)
    bone(chest, new THREE.Vector3(-HUMAN.shoulderW + 0.03, 0.26, -0.03), new THREE.Vector3(HUMAN.shoulderW - 0.03, 0.26, -0.03), 0.016)
    // chest shells: front plate, back plate, shoulders
    // chest plates narrow toward the waist
    const torsoShape = (w: number, h: number, d: number) => {
      const g = new RoundedBoxGeometry(w, h, d, 4, 0.06)
      const p = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (0.78 + 0.22 * ((p.getY(i) + h / 2) / h)))
      g.computeVertexNormals()
      return g
    }
    void torsoShape
    // chest: one sculpted piece, broad at the shoulders, narrowing to the waist, with a seam across it
    const chestG = loftShell(0.37, (t) => 0.178 - 0.058 * Math.pow(t, 1.2) + 0.018 * Math.sin(Math.PI * Math.min(1, t * 1.8)), (t) => 0.1 - 0.02 * t + 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.6)), (t) => 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.5)) - 0.004, 2.7, 72, 44, (t, a) => Math.max(band(t, 0.74, 1.2), angBand(a, -Math.PI / 2, 0.55) * band(t, 0.1, 1.2) * 0.9))
    shell(chestG, chest, [0, 0.33, 0], [0, 0.08, 0.28])
    const seamG = loftShell(0.006, () => 0.172, () => 0.114, () => 0.012, 2.7, 72, 2)
    add(seamG, M.seam, chest).position.set(0, 0.24, 0)
    // two slim light lines under the collar bones
    for (const sd of [-1, 1]) {
      const pts = Array.from({ length: 12 }, (_, i) => { const u = i / 11; return new THREE.Vector3(sd * (0.035 + u * 0.1), 0.275 - u * 0.03, 0.114 + 0.012 - u * 0.012) })
      glowLine(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.0022, tubular: 24, radial: 6 }), chest)
    }
    this.anchors.chest = [chest, new THREE.Vector3(0, 0.2, 0.13)]
    const neck = joint('neck', chest, 0, 0.33, 0)
    add(new THREE.CylinderGeometry(0.046, 0.05, 0.08, 32), M.black, neck).position.y = 0.035
    add(revolve([[0.05, -0.02], [0.105, -0.02], [0.1, 0.0], [0.06, 0.03], [0.05, 0.03]], 48), M.black, chest).position.y = 0.33
    { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.0025, 6, 64), accent); ring.rotation.x = Math.PI / 2; ring.position.y = 0.335; ring.layers.set(LAYER_GLOW); chest.add(ring) }
    const head = new THREE.Group()
    head.position.y = 0.075
    neck.add(head)
    // the head: a white shell with one smooth sheet of black glass wrapped over the whole face
    const skull = shell(new THREE.SphereGeometry(1, 64, 40), head, [0, 0.105, -0.004], [0, 0.3, -0.05])
    skull.scale.set(0.097, 0.122, 0.11)
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40, Math.PI / 2 - 0.95, 1.9, 0.72, 1.18), M.visor)
    glass.scale.set(0.0985, 0.1238, 0.1118)
    glass.castShadow = true
    skull.add(glass)
    glass.scale.divide(skull.scale)
    glass.position.set(0, 0, 0.002 / 0.11)
    this.shellMats.push(M.visor)
    // cameras sit behind the glass
    for (const x of [-0.032, 0.032]) add(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16).rotateX(Math.PI / 2), M.black, head).position.set(x, 0.12, 0.09)
    add(new THREE.CylinderGeometry(0.03, 0.036, 0.02, 24), M.frame, head).position.y = -0.005
    this.anchors.head = [head, new THREE.Vector3(0, 0.15, 0.12)]

    /* ---------------- arms ---------------- */
    for (const side of [1, -1] as const) {
      const L = side > 0 ? 'l' : 'r'
      const sh = joint(`${L}Shoulder` as Joint, chest, side * HUMAN.shoulderW, 0.27, 0)
      actuator(`${L}Shoulder` as Joint, chest, 110, 'x', [side * (HUMAN.shoulderW - 0.035), 0.27, 0], side)
      actuator(`${L}Shoulder` as Joint, sh, 110, 'z', [side * 0.025, -0.055, 0])
      actuator(`${L}Shoulder` as Joint, sh, 110, 'y', [side * 0.02, -0.15, 0], -1)
      { const cp = shell(paintAll(new THREE.SphereGeometry(0.068, 40, 20, 0, Math.PI * 2, 0, 1.75), 0), sh, [side * 0.02, 0.008, 0], [side * 0.18, 0.08, 0]); cp.scale.set(1.0, 0.9, 1.08) }
      bone(sh, new THREE.Vector3(side * 0.02, 0, 0), new THREE.Vector3(side * 0.02, -HUMAN.upperArm, 0), 0.014)
      shell(loftShell(HUMAN.upperArm - 0.06, (t) => 0.05 - 0.01 * t + 0.006 * Math.sin(Math.PI * t), (t) => 0.052 - 0.01 * t + 0.009 * Math.sin(Math.PI * t), () => 0, 2.3, 48, 36, (t, a) => angBand(a, side > 0 ? 0 : Math.PI, 0.3) * band(t, 0.2, 0.85)), sh, [side * 0.02, -0.04, 0], [side * 0.16, 0, 0.06])
      const el = joint(`${L}Elbow` as Joint, sh, side * 0.02, -HUMAN.upperArm, 0)
      actuator(`${L}Elbow` as Joint, el, 110, 'x', [0, 0, 0], side)
      jointCover(el, 0.041, 0.07)
      actuator(`${L}Wrist` as Joint, el, 20, 'y', [0, -0.07, 0], -1)
      bone(el, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -HUMAN.forearm, 0), 0.012)
      shell(loftShell(HUMAN.forearm - 0.05, (t) => 0.045 - 0.013 * t + 0.004 * Math.sin(Math.PI * Math.min(1, t * 2)), (t) => 0.049 - 0.015 * t + 0.007 * Math.sin(Math.PI * Math.min(1, t * 1.6)), () => 0.004, 2.5, 48, 36, (t) => band(t, 0.8, 1.2)), el, [0, -0.03, 0], [side * 0.14, -0.04, 0.08])
      // tendon actuators live in the forearm; tendons run to the fingertips
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 10), M.gold, el).position.set(side * (-0.012 + i * 0.012), -0.1, 0.01)
      const wr = joint(`${L}Wrist` as Joint, el, 0, -HUMAN.forearm, 0)
      // two small screws in the forearm tilt the wrist
      for (const dx of [-0.013, 0.013]) linear(`${L}Wrist` as Joint, 500, [el, [dx, -0.1, 0.02]], [wr, [dx, -0.012, 0.022]])
      const palm = add(new RoundedBoxGeometry(0.035, 0.09, 0.075, 2, 0.012), M.black, wr)
      palm.position.set(0, -0.055, 0.005)
      const tendonMat = glowLineMaterial(this.noCut, { color: 0x7fd8ff, emph: BOT.tendon, rate: BOT.rate, speed: 1.5, scale: 0.05, base: 0.4 })
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4
        const base = new THREE.Group()
        base.position.set(thumb ? -side * 0.0 : 0, thumb ? -0.04 : -0.1, thumb ? 0.045 : -0.028 + f * 0.019)
        if (thumb) base.rotation.set(0.9, 0, 0)
        wr.add(base)
        let g = base
        const segs = thumb ? 2 : 3
        for (let k = 0; k < segs; k++) {
          const len = thumb ? 0.03 : 0.028 - k * 0.004
          add(new RoundedBoxGeometry(0.015, len, 0.015, 1, 0.005), M.black, g).position.y = -len / 2
          const nx = new THREE.Group()
          nx.position.y = -len
          g.add(nx)
          this.fingers.push({ g, k: thumb ? 0.6 : 1 })
          g = nx
        }
        // tactile pad on the fingertip
        add(new RoundedBoxGeometry(0.012, 0.012, 0.004, 1, 0.002), M.gold, g).position.set(0, 0.006, 0.008)
        // tendon from the forearm to this fingertip
        const a = new THREE.Vector3(side * 0.0, HUMAN.forearm * 0.45, 0.012)
        const b = new THREE.Vector3(0, thumb ? -0.05 : -0.1, base.position.z)
        const t = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3([a, new THREE.Vector3(0, 0.02, base.position.z * 0.6), b]), { r: 0.0022, tubular: 20, radial: 5 }), tendonMat)
        t.layers.set(LAYER_GLOW)
        t.userData.fluid = 'glow'
        wr.add(t)
      }
      if (side > 0) this.anchors.hand = [wr, new THREE.Vector3(0, -0.09, 0.04)]
      if (side > 0) this.anchors.elbow = [el, new THREE.Vector3(side * 0.05, 0, 0.03)]
    }

    /* ---------------- legs ---------------- */
    for (const side of [1, -1] as const) {
      const L = side > 0 ? 'l' : 'r'
      const hip = joint(`${L}Hip` as Joint, pelvis, side * HUMAN.hipW, -0.03, 0)
      // hip: yaw and roll on the pelvis, pitch at the joint
      actuator(`${L}Hip` as Joint, pelvis, 110, 'y', [side * HUMAN.hipW, 0.035, -0.01])
      actuator(`${L}Hip` as Joint, pelvis, 180, 'z', [side * HUMAN.hipW, -0.015, -0.06])
      actuator(`${L}Hip` as Joint, hip, 180, 'x', [side * 0.03, 0, 0], side)
      bone(hip, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -HUMAN.thigh, 0), 0.02)
      // linear actuator along the thigh drives the knee
      shell(loftShell(HUMAN.thigh - 0.06, (t) => 0.084 - 0.03 * t, (t) => 0.088 - 0.028 * t + 0.014 * Math.sin(Math.PI * t), (t) => 0.014 * Math.sin(Math.PI * t), 2.3, 56, 40, (t, a) => angBand(a, side > 0 ? 0 : Math.PI, 0.42) * band(t, 0.12, 0.9)), hip, [0, -0.02, 0], [side * 0.18, 0, 0.08])
      const knee = joint(`${L}Knee` as Joint, hip, 0, -HUMAN.thigh, 0)
      // the knee is pushed by the biggest screw, 8,000 N, on a lever behind the joint
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.09, 20).rotateZ(Math.PI / 2), M.frame, knee)
      add(new RoundedBoxGeometry(0.03, 0.09, 0.03, 1, 0.008), M.frame, knee).position.set(0, 0.03, -0.045)
      linear(`${L}Knee` as Joint, 8000, [hip, [0, -0.075, -0.06]], [knee, [0, 0.07, -0.075]])
      bone(knee, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -HUMAN.shin, 0), 0.018)
      shell(loftShell(HUMAN.shin - 0.09, (t) => 0.054 - 0.02 * t, (t) => 0.062 - 0.02 * t + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.6)), (t) => -0.01 * Math.sin(Math.PI * Math.min(1, t * 1.6)) + 0.006, 2.5, 48, 36, (t, a) => angBand(a, Math.PI / 2, 0.45) * band(t, 0.08, 0.72)), knee, [0, -0.05, 0], [side * 0.16, 0, 0.1])
      // a black knee cap over the joint
      jointCover(knee, 0.054, 0.1)
      const cap = add(paintAll(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, 1.2), 1), M.shell, knee)
      cap.scale.set(0.046, 0.05, 0.03)
      cap.rotation.x = Math.PI / 2
      cap.position.set(0, 0.005, 0.042)
      glowLine(new THREE.TorusGeometry(0.056, 0.002, 6, 48, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2), knee).position.set(side * 0.052, 0, 0)
      const ankle = joint(`${L}Ankle` as Joint, knee, 0, -HUMAN.shin, 0)
      jointCover(ankle, 0.036, 0.085)
      const foot = new THREE.Group()
      foot.position.y = -HUMAN.ankleH
      ankle.add(foot)
      add(new RoundedBoxGeometry(0.105, 0.022, 0.26, 3, 0.01), M.rubber, foot).position.set(0, 0.011, 0.045)
      { const fg = loftShell(0.25, (t) => 0.05 - 0.006 * t + 0.004 * Math.sin(Math.PI * t), (t) => 0.036 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) + 0.008, () => 0, 2.6, 48, 36, (t) => band(t, 0.7, 1.2)); fg.rotateX(-Math.PI / 2); fg.translate(0, 0.0, 0); shell(fg, foot, [0, 0.03, -0.08], [side * 0.1, 0, 0.12]) }
      // two screws side by side on the back of the shin tilt the foot: together for pitch, against each other for roll
      for (const dx of [-0.03, 0.03]) linear(`${L}Ankle` as Joint, 3900, [knee, [dx, -0.1, -0.05]], [foot, [dx, 0.075, -0.05]])
      for (const z of [-0.075, 0.165]) {
        const sole = new THREE.Object3D()
        sole.position.set(0, 0, z)
        foot.add(sole)
        this.feet.push(sole)
      }
      if (side > 0) this.anchors.knee = [knee, new THREE.Vector3(side * 0.07, 0, 0.04)]
      if (side > 0) this.anchors.hip = [hip, new THREE.Vector3(side * 0.08, 0, 0.05)]
      if (side > 0) this.anchors.ankle = [ankle, new THREE.Vector3(side * 0.05, 0, 0.04)]
    }

    /* ---------------- the payload box, carried in both hands ---------------- */
    this.box = new THREE.Group()
    B.add(this.box)
    add(new RoundedBoxGeometry(0.3, 0.22, 0.26, 2, 0.01), matte(0xb58a57, 0.75, { detail: 30, colorVar: 0.12 }), this.box)
    add(new THREE.BoxGeometry(0.302, 0.02, 0.05), matte(0xd9d0bf, 0.6), this.box).position.y = 0.1
    this.box.visible = false

    /* ---------------- x-ray: a scan plane sweeps down, shells beyond it turn to glass ---------------- */
    this.ghostMat = new THREE.ShaderMaterial({
      vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0.45, 0.82, 1.0) }, uK: { value: 1 } },
      clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.ghostMat.clippingPlanes = [this.ghostPlane]
    for (const s of this.shells) {
      const gm = new THREE.Mesh(s.mesh.geometry, this.ghostMat)
      gm.layers.set(LAYER_GLOW)
      gm.userData.fluid = 'glow'
      s.mesh.add(gm)
      gm.visible = false
      s.mesh.userData.ghost = gm
    }
    this.shellMats.push(M.shell)
    for (const m of this.shellMats) { m.clippingPlanes = [this.solidPlane]; m.clipShadows = true }
    this.scan = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.42, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.85, 1).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    this.scan.rotation.x = -Math.PI / 2
    this.scan.layers.set(LAYER_GLOW)
    this.root.add(this.scan)
    void this.ghost

    /* ---------------- power lines from the pack to every joint ---------------- */
    const powerMat = glowLineMaterial(this.noCut, { color: 0x47c8ff, emph: BOT.power, rate: BOT.rate, speed: 1.4, scale: 0.08, base: 0.25 })
    const route = (parent: THREE.Object3D, pts: [number, number, number][]) => {
      const m = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), { r: 0.004, tubular: 40, radial: 6 }), powerMat)
      m.layers.set(LAYER_GLOW)
      m.userData.fluid = 'glow'
      parent.add(m)
    }
    route(chest, [[0, 0.12, 0.03], [0, 0.0, 0.0], [0, -0.14, 0.0]])
    for (const side of [1, -1]) {
      route(chest, [[side * 0.08, 0.2, 0.03], [side * 0.15, 0.25, 0.0], [side * HUMAN.shoulderW, 0.27, 0.0]])
      const L = side > 0 ? 'l' : 'r'
      route(this.J[`${L}Shoulder` as Joint], [[side * 0.02, 0, 0.02], [side * 0.03, -HUMAN.upperArm / 2, 0.025], [side * 0.02, -HUMAN.upperArm, 0.02]])
      route(this.J[`${L}Elbow` as Joint], [[0, 0, 0.02], [0, -HUMAN.forearm / 2, 0.025], [0, -HUMAN.forearm, 0.015]])
      route(pelvis, [[0, 0.02, 0.03], [side * 0.06, -0.01, 0.03], [side * HUMAN.hipW, -0.03, 0.02]])
      route(this.J[`${L}Hip` as Joint], [[0, 0, -0.03], [0, -HUMAN.thigh / 2, -0.035], [0, -HUMAN.thigh, -0.03]])
      route(this.J[`${L}Knee` as Joint], [[0, 0, 0.03], [0, -HUMAN.shin / 2, 0.035], [0, -HUMAN.shin, 0.02]])
    }
  }

  /** Apply a pose, then drop the body so the lower foot stands on y = 0. */
  apply(p: Pose) {
    const J = this.J
    J.lHip.rotation.set(-p.hip[0], 0, p.hipRoll[0])
    J.rHip.rotation.set(-p.hip[1], 0, -p.hipRoll[1])
    J.lKnee.rotation.x = p.knee[0]
    J.rKnee.rotation.x = p.knee[1]
    J.lAnkle.rotation.x = p.ankle[0]
    J.rAnkle.rotation.x = p.ankle[1]
    J.lShoulder.rotation.set(-p.shoulder[0], 0, p.shoulderOut[0])
    J.rShoulder.rotation.set(-p.shoulder[1], 0, -p.shoulderOut[1])
    J.lElbow.rotation.x = -p.elbow[0]
    J.rElbow.rotation.x = -p.elbow[1]
    J.lWrist.rotation.set(0, 0, 0)
    J.rWrist.rotation.set(0, 0, 0)
    J.waist.rotation.set(p.waist, p.twist, 0)
    J.neck.rotation.set(p.head, -p.twist * 0.5, 0)
    for (const f of this.fingers) f.g.rotation.x = p.grip * 0.55 * f.k
    this.body.position.set(p.sway, 0, 0)
    this.body.rotation.set(0, p.pelvisYaw, p.pelvisRoll)
    this.root.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert()
    let low = Infinity
    const v = new THREE.Vector3()
    for (const s of this.feet) {
      v.setFromMatrixPosition(s.matrixWorld).applyMatrix4(inv)
      low = Math.min(low, v.y)
    }
    this.body.position.y = -low
    this.root.updateMatrixWorld(true)
    this.spanLinears()
    // the standing foot: its travel is how far the belt has to move under it
    const inv2 = new THREE.Matrix4().copy(this.root.matrixWorld).invert()
    const fz = [0, 1].map((k) => {
      const a = new THREE.Vector3().setFromMatrixPosition(this.feet[k * 2].matrixWorld).applyMatrix4(inv2)
      const b = new THREE.Vector3().setFromMatrixPosition(this.feet[k * 2 + 1].matrixWorld).applyMatrix4(inv2)
      return { y: Math.min(a.y, b.y), z: (a.z + b.z) / 2 }
    })
    const stance = fz[0].y <= fz[1].y ? 0 : 1
    this.beltStep = stance === this.lastStance ? this.lastStanceZ - fz[stance].z : 0
    this.lastStance = stance
    this.lastStanceZ = fz[stance].z
  }

  /** Stretch every linear actuator between its two mounts. */
  spanLinears() {
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert()
    for (const l of this.linears) {
      const A = l.a[1].clone().applyMatrix4(l.a[0].matrixWorld).applyMatrix4(inv)
      const B = l.b[1].clone().applyMatrix4(l.b[0].matrixWorld).applyMatrix4(inv)
      l.act.span(A, B)
    }
  }

  /** Where the hands are (robot frame), for placing the box between them. */
  handsCenter() {
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert()
    const a = new THREE.Vector3().setFromMatrixPosition(this.J.lWrist.matrixWorld).applyMatrix4(inv)
    const b = new THREE.Vector3().setFromMatrixPosition(this.J.rWrist.matrixWorld).applyMatrix4(inv)
    return a.add(b).multiplyScalar(0.5)
  }

  /** explode 0..1; xray 0..1 scan from the head down; dt for nothing yet */
  update(explode: number, xray: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const s of this.shells) s.mesh.position.copy(s.base).addScaledVector(s.out, e)
    // the scan plane moves from above the head to the floor
    const top = HUMAN.height + 0.1
    const y = top - (top + 0.05) * xray
    this.root.updateMatrixWorld(true)
    const mw = this.root.matrixWorld
    this.solidPlane.set(new THREE.Vector3(0, -1, 0), y).applyMatrix4(mw)
    this.ghostPlane.set(new THREE.Vector3(0, 1, 0), -y).applyMatrix4(mw)
    const on = xray > 0.001
    for (const s of this.shells) (s.mesh.userData.ghost as THREE.Mesh).visible = on
    this.scan.visible = xray > 0.002 && xray < 0.998
    this.scan.position.y = y
  }

  /** load 0..1.5 per joint, colours the rings green to amber to red */
  setLoads(load: Partial<Record<Joint, number>>, emph: number) {
    for (const a of this.actuators) {
      const l = Math.min(1.5, load[a.joint] ?? 0)
      const c = new THREE.Color().setHSL(0.36 - 0.36 * Math.min(1, l), 1, 0.55)
      a.ring.color.copy(c).multiplyScalar(0.3 + 4 * emph * (0.4 + l))
    }
  }

  setGhost(k: number) {
    this.ghostMat.uniforms.uK.value = k
  }
}

/** The stage: a round platform with a treadmill the robot walks on. */
export class RobotStage {
  readonly group = new THREE.Group()
  readonly mount = new THREE.Group()
  readonly beltTex: THREE.CanvasTexture
  static readonly TOP = 0.36

  constructor() {
    const G = this.group
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const plat = surf({ color: 0x20242b, metalness: 0.35, roughness: 0.4, detail: 1.5, clearcoat: 0.55, clearcoatRoughness: 0.2 })
    add(revolve([[0, 0], [2.1, 0], [2.1, 0.12], [2.06, 0.16], [0, 0.16]] as P2[], 128), plat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.006, 8, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x62b4ff).multiplyScalar(2.4) }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.13
    ring.layers.set(LAYER_GLOW)
    G.add(ring)
    // treadmill
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#1e2126'
    g.fillRect(0, 0, 64, 256)
    g.fillStyle = '#262a30'
    for (let i = 0; i < 16; i++) g.fillRect(0, i * 16, 64, 7)
    this.beltTex = new THREE.CanvasTexture(c)
    this.beltTex.wrapS = this.beltTex.wrapT = THREE.RepeatWrapping
    this.beltTex.repeat.set(1, 4)
    this.beltTex.colorSpace = THREE.SRGBColorSpace
    const TOP = RobotStage.TOP
    add(new RoundedBoxGeometry(1.0, TOP - 0.16, 2.1, 2, 0.03), surf({ color: 0x2a2e35, metalness: 0.6, roughness: 0.4, detail: 3 })).position.set(0, 0.16 + (TOP - 0.16) / 2 - 0.02, 0)
    const belt = add(new THREE.PlaneGeometry(0.8, 1.9), surf({ color: 0xffffff, map: this.beltTex, metalness: 0, roughness: 0.75 }), G, false)
    belt.rotation.x = -Math.PI / 2
    belt.position.y = TOP + 0.001
    for (const x of [-0.45, 0.45]) {
      add(new RoundedBoxGeometry(0.08, 0.04, 2.1, 2, 0.01), surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.3, anisotropy: 0.5 })).position.set(x, TOP + 0.005, 0)
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 2.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x62b4ff).multiplyScalar(2) }))
      led.position.set(x * 1.1, TOP - 0.04, 0)
      led.layers.set(LAYER_GLOW)
      G.add(led)
    }
    this.mount.position.y = TOP
    G.add(this.mount)
  }

  /** move the belt by the distance the standing foot travelled (m) */
  update(step: number) {
    this.beltTex.offset.y -= step * (4 / 1.9)
  }
}

/** A walking and squatting gait generator: phase in radians, returns joint angles. */
export function gait(mode: 'walk' | 'squat' | 'stand', phase: number, amp: number, carry: number, t: number): Pose {
  const s = Math.sin, c = Math.cos
  const d2r = Math.PI / 180
  if (mode === 'walk') {
    const p = phase / (Math.PI * 2)
    const pl = p, pr = p + 0.5
    const hL = HIP(pl) * amp, hR = HIP(pr) * amp
    const armK = (1 - carry) * 0.55
    const mean = 7 * d2r
    return {
      hip: [hL, hR], hipRoll: [0.02, 0.02], knee: [KNEE(pl) * amp + 0.04, KNEE(pr) * amp + 0.04], ankle: [ANKLE(pl) * amp, ANKLE(pr) * amp],
      // arms swing against the legs; elbows bend a little more on the forward swing
      shoulder: [-(hR - mean) * armK + carry * 0.55, -(hL - mean) * armK + carry * 0.55], shoulderOut: [0.05 + carry * 0.02, 0.05 + carry * 0.02],
      elbow: [0.32 + Math.max(0, -(hR - mean)) * 0.6 * (1 - carry) + carry * 1.0, 0.32 + Math.max(0, -(hL - mean)) * 0.6 * (1 - carry) + carry * 1.0],
      waist: 0.04 - carry * 0.06, twist: -0.06 * amp * s(p * Math.PI * 2) * (1 - carry), head: -0.04, grip: carry > 0.5 ? 1 : 0.35,
      pelvisYaw: 0.07 * amp * s(p * Math.PI * 2), pelvisRoll: 0.03 * amp * c(p * Math.PI * 2 * 2) * 0 + 0.025 * amp * s(p * Math.PI * 2 * 2 + 0.6), sway: 0.022 * amp * c(p * Math.PI * 2),
    }
  }
  if (mode === 'squat') {
    const d = smooth(0.5 - 0.5 * c(phase))
    const knee = 0.08 + 1.85 * d
    const hip = 0.06 + 1.6 * d
    const ankle = hip - knee + 0.05 - 0.02 * d
    return {
      hip: [hip, hip], hipRoll: [0.06, 0.06], knee: [knee, knee], ankle: [ankle, ankle],
      shoulder: [0.2 + 1.0 * d * (1 - carry) + carry * 0.55, 0.2 + 1.0 * d * (1 - carry) + carry * 0.55], shoulderOut: [0.07, 0.07],
      elbow: [0.25 + carry * 1.0, 0.25 + carry * 1.0], waist: 0.45 * d + 0.03, twist: 0, head: -0.35 * d, grip: carry > 0.5 ? 1 : 0.35,
      pelvisYaw: 0, pelvisRoll: 0, sway: 0,
    }
  }
  const breath = 0.01 * s(t * 1.3)
  return {
    hip: [0.02, 0.02], hipRoll: [0.04, 0.04], knee: [0.06, 0.06], ankle: [-0.04, -0.04],
    shoulder: [0.05 + carry * 0.5, 0.05 + carry * 0.5], shoulderOut: [0.06, 0.06], elbow: [0.22 + carry * 1.0, 0.22 + carry * 1.0],
    waist: breath, twist: 0.05 * s(t * 0.4), head: -0.05 + 0.03 * s(t * 0.5), grip: carry > 0.5 ? 1 : 0.3 + 0.2 * s(t * 0.8),
    pelvisYaw: 0, pelvisRoll: 0, sway: 0.004 * s(t * 0.7),
  }
}

/** Rough statics for the readouts, loosely after published Optimus figures (about 100 W at rest, 500 W walking). */
export function robotLoad(mode: 'walk' | 'squat' | 'stand', speed: number, payload: number, depth: number) {
  const m = HUMAN.mass + payload
  const g = 9.81
  let power = 100 + payload * 1.5
  let knee = 0
  if (mode === 'walk') {
    const v = speed / 3.6
    power += 420 * Math.min(1.6, v / 0.6) + payload * 6 * v
    knee = m * g * (0.05 + 0.06 * Math.min(1.5, v / 0.6))
  } else if (mode === 'squat') {
    power += 60 + 250 * depth + payload * 4 * depth
    knee = (m * g * (0.02 + 0.22 * depth)) / 2
  } else knee = (m * g * 0.03) / 2
  return { power, knee, runtime: (HUMAN.battery * 1000) / power }
}
