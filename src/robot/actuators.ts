import * as THREE from 'three'
import { surf } from '../core/materials'
import { revolve, P2 } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'

/**
 * The two kinds of actuator a humanoid is built from, after the designs Tesla
 * showed for Optimus (AI Day 2022): a rotary joint (frameless motor, strain
 * wave gear, crossed roller bearing, encoder, torque sensor) and a linear one
 * (motor turning a planetary roller screw, with a force sensor). Each part is
 * its own group along the actuator's +y axis so it can be pulled apart.
 */

export const ACT_MATS = (() => {
  let m: Record<string, THREE.MeshStandardMaterial> | null = null
  return () => {
    if (m) return m
    m = {
      housing: surf({ color: 0x3a3e45, metalness: 0.85, roughness: 0.32, detail: 10, anisotropy: 0.5, roughVar: 0.2, clearcoat: 0.3, name: 'act-housing' }),
      fin: surf({ color: 0xc3c7cc, metalness: 1, roughness: 0.22, detail: 12, anisotropy: 0.7, name: 'act-fin' }),
      dark: surf({ color: 0x25282d, metalness: 0.7, roughness: 0.4, detail: 6, name: 'act-dark' }),
      steel: surf({ color: 0xd2d5d9, metalness: 1, roughness: 0.18, detail: 12, anisotropy: 0.7, name: 'act-steel' }),
      copper: surf({ color: 0xc8793f, metalness: 1, roughness: 0.32, detail: 16, name: 'act-copper' }),
      magnet: surf({ color: 0x70757c, metalness: 0.9, roughness: 0.25, detail: 8, name: 'act-magnet' }),
      magnetN: surf({ color: 0x8a3b3b, metalness: 0.6, roughness: 0.35, detail: 8, name: 'act-magnet-n' }),
      pcb: surf({ color: 0x1d4a36, metalness: 0.3, roughness: 0.5, detail: 20, name: 'act-pcb' }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.28, detail: 8, name: 'act-gold' }),
      enc: surf({ color: 0x0f1012, metalness: 0.4, roughness: 0.2, clearcoat: 1, name: 'act-encoder' }),
    }
    return m
  }
})()

export interface ActPart { name: string; group: THREE.Group; explode: number }

const ring = (r0: number, r1: number, y0: number, y1: number, bevel = 0.08): P2[] => {
  const b = Math.min((r1 - r0) * bevel, (y1 - y0) * 0.25)
  return [[r0, y0 + b], [r0 + b, y0], [r1 - b, y0], [r1, y0 + b], [r1, y1 - b], [r1 - b, y1], [r0 + b, y1], [r0, y1 - b]]
}

function around(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, r: number, y: number, tilt = 0, alt = false) {
  const im = new THREE.InstancedMesh(geo, mat, n)
  const d = new THREE.Object3D()
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    d.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    d.rotation.set(0, -a, alt && i % 2 ? tilt + Math.PI / 2 : tilt)
    d.updateMatrix()
    im.setMatrixAt(i, d.matrix)
  }
  im.castShadow = true
  im.receiveShadow = true
  parent.add(im)
  return im
}

/**
 * A rotary actuator of radius R and length L (axis +y, output face at +y).
 * `full` builds every internal part; otherwise only what shows from outside.
 */
export function rotaryActuator(R: number, L: number, full = false) {
  const M = ACT_MATS()
  const root = new THREE.Group()
  const parts: ActPart[] = []
  const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = true
    mesh.receiveShadow = true
    p.add(mesh)
    return mesh
  }
  const part = (name: string, explode: number) => {
    const group = new THREE.Group()
    root.add(group)
    parts.push({ name, group, explode })
    return group
  }
  const y0 = -L / 2, y1 = L / 2
  const seg = full ? 64 : 36

  // housing with cooling fins, open at the output end
  const housing = part('Housing', -2.4)
  add(revolve(ring(R * 0.86, R, y0 + L * 0.12, y1 - L * 0.16), seg), M.housing, housing)
  const finG = revolve(ring(R * 0.98, R * 1.07, -L * 0.02, L * 0.02, 0.2), seg)
  for (let i = 0; i < (full ? 5 : 3); i++) add(finG, M.fin, housing).position.y = y0 + L * 0.25 + i * L * (full ? 0.11 : 0.17)
  // output flange with its bolt circle
  const flange = part('Output flange', 2.4)
  add(revolve(ring(R * 0.18, R * 0.92, y1 - L * 0.16, y1, 0.15), seg), M.steel, flange)
  around(flange, new THREE.CylinderGeometry(R * 0.05, R * 0.05, L * 0.03, 10), M.dark, 8, R * 0.62, y1 + L * 0.004)
  // back cap and connector
  const cap = part('Back cap', -3.2)
  add(revolve(ring(0, R * 0.92, y0, y0 + L * 0.12, 0.15), seg), M.dark, cap)
  add(new THREE.BoxGeometry(R * 0.35, L * 0.1, R * 0.22), M.dark, cap).position.set(R * 0.62, y0 + L * 0.02, 0)
  if (!full) return { root, parts }

  // torque sensor: a thin flexure ring with strain gauges
  const torque = part('Torque sensor', 1.7)
  add(revolve(ring(R * 0.3, R * 0.8, y1 - L * 0.24, y1 - L * 0.19), seg), M.steel, torque)
  around(torque, new THREE.BoxGeometry(R * 0.1, L * 0.012, R * 0.06), M.gold, 4, R * 0.55, y1 - L * 0.185)
  // crossed roller bearing: rollers alternate at right angles
  const bearing = part('Crossed roller bearing', 1.05)
  add(revolve(ring(R * 0.74, R * 0.84, y1 - L * 0.34, y1 - L * 0.25), seg), M.steel, bearing)
  add(revolve(ring(R * 0.9, R * 0.97, y1 - L * 0.34, y1 - L * 0.25), seg), M.steel, bearing)
  around(bearing, new THREE.CylinderGeometry(R * 0.028, R * 0.028, R * 0.05, 8).rotateZ(Math.PI / 4), M.steel, 28, R * 0.87, y1 - L * 0.295, 0, true)
  // strain wave gear: rigid circular spline with internal teeth, the flexspline cup inside it, the elliptical wave generator inside that
  const cs = part('Circular spline', 0.35)
  add(revolve(ring(R * 0.6, R * 0.78, y1 - L * 0.46, y1 - L * 0.36), seg), M.steel, cs)
  around(cs, new THREE.BoxGeometry(R * 0.035, L * 0.1, R * 0.02), M.steel, 72, R * 0.595, y1 - L * 0.41)
  const fs = part('Flexspline', -0.25)
  add(revolve([[R * 0.2, y1 - L * 0.62], [R * 0.56, y1 - L * 0.62], [R * 0.56, y1 - L * 0.36], [R * 0.53, y1 - L * 0.36], [R * 0.53, y1 - L * 0.58], [R * 0.2, y1 - L * 0.58]], seg), M.steel, fs)
  around(fs, new THREE.BoxGeometry(R * 0.03, L * 0.1, R * 0.02), M.steel, 70, R * 0.575, y1 - L * 0.41)
  const wg = part('Wave generator', -0.8)
  const ell = add(revolve(ring(R * 0.18, R * 0.5, y1 - L * 0.46, y1 - L * 0.37), seg), M.dark, wg)
  ell.scale.set(1.08, 1, 0.92)
  around(wg, new THREE.SphereGeometry(R * 0.03, 8, 6), M.steel, 20, R * 0.47, y1 - L * 0.415)
  // frameless motor: copper wound stator teeth and a rotor with magnets
  const stator = part('Stator', -1.3)
  add(revolve(ring(R * 0.62, R * 0.84, y0 + L * 0.2, y0 + L * 0.46), seg), M.dark, stator)
  around(stator, new THREE.BoxGeometry(R * 0.11, L * 0.24, R * 0.07), M.copper, 24, R * 0.57, y0 + L * 0.33)
  const rotor = part('Rotor', -1.8)
  add(revolve(ring(R * 0.18, R * 0.44, y0 + L * 0.2, y0 + L * 0.46), seg), M.steel, rotor)
  const mg = new THREE.BoxGeometry(R * 0.07, L * 0.24, R * 0.12)
  const nMag = 16
  const im1 = new THREE.InstancedMesh(mg, M.magnet, nMag / 2), im2 = new THREE.InstancedMesh(mg, M.magnetN, nMag / 2)
  const d = new THREE.Object3D()
  for (let i = 0; i < nMag; i++) {
    const a = (i / nMag) * Math.PI * 2
    d.position.set(Math.cos(a) * R * 0.47, y0 + L * 0.33, Math.sin(a) * R * 0.47)
    d.rotation.set(0, -a, 0)
    d.updateMatrix()
    ;(i % 2 ? im2 : im1).setMatrixAt(Math.floor(i / 2), d.matrix)
  }
  rotor.add(im1, im2)
  // encoder: a patterned glass disc read by a small board
  const enc = part('Encoder', -2.6)
  const ec = document.createElement('canvas')
  ec.width = ec.height = 256
  const g = ec.getContext('2d')!
  g.fillStyle = '#0c0d10'
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#c9a045'
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2
    g.lineWidth = i % 2 ? 1 : 2
    g.beginPath(); g.moveTo(128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80); g.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); g.stroke()
  }
  const et = new THREE.CanvasTexture(ec)
  et.colorSpace = THREE.SRGBColorSpace
  const disc = add(new THREE.CircleGeometry(R * 0.55, 48), new THREE.MeshStandardMaterial({ map: et, metalness: 0.5, roughness: 0.2 }), enc)
  disc.rotation.x = -Math.PI / 2
  disc.position.y = y0 + L * 0.15
  add(new THREE.BoxGeometry(R * 0.45, L * 0.03, R * 0.3), M.pcb, enc).position.set(R * 0.35, y0 + L * 0.13, 0)
  return { root, parts }
}

/**
 * A linear actuator along +y: motor body from 0 to `body`, a push rod that can
 * be set to any length with setLength (distance between the two eyes).
 */
export class LinearActuator {
  readonly root = new THREE.Group()
  readonly parts: ActPart[] = []
  private rod: THREE.Group
  private eyeEnd: THREE.Group
  private screw: THREE.Group
  constructor(readonly r: number, readonly body: number, full = false) {
    const M = ACT_MATS()
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const part = (name: string, explode: number) => {
      const group = new THREE.Group()
      this.root.add(group)
      this.parts.push({ name, group, explode })
      return group
    }
    const seg = full ? 48 : 20
    // rear eye and motor body with fins
    const motor = part('Motor', -1.2)
    add(new THREE.TorusGeometry(r * 0.7, r * 0.28, 8, 20).rotateY(Math.PI / 2), M.steel, motor).position.y = -r * 0.6
    add(revolve(ring(0, r, 0, body * 0.55, 0.1), seg), M.housing, motor)
    for (let i = 0; i < (full ? 6 : 3); i++) add(revolve(ring(r * 0.96, r * 1.1, -r * 0.08, r * 0.08, 0.2), seg), M.fin, motor).position.y = body * 0.08 + i * body * (full ? 0.075 : 0.14)
    // bearing and nut housing
    const nut = part('Roller screw nut', 0.2)
    add(revolve(ring(r * 0.35, r * 0.9, body * 0.55, body, 0.1), seg), M.dark, nut)
    if (full) {
      // the planetary rollers around the screw
      around(nut, new THREE.CylinderGeometry(r * 0.1, r * 0.1, body * 0.36, 10), M.steel, 8, r * 0.48, body * 0.78)
    }
    // the screw itself: a threaded shaft that runs inside the rod
    this.screw = part('Planetary roller screw', 1.2)
    const threads = full ? 40 : 12
    add(new THREE.CylinderGeometry(r * 0.32, r * 0.32, body * 1.3, 16), M.steel, this.screw).position.y = body * 0.65 + body * 0.55
    for (let i = 0; i < threads; i++) add(new THREE.TorusGeometry(r * 0.32, r * 0.04, 4, 20).rotateX(Math.PI / 2), M.steel, this.screw).position.y = body * 0.6 + (i / threads) * body * 1.2
    // rod and front eye with a force sensor ring
    this.rod = part('Push rod', 2.2)
    add(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 1, 16).translate(0, 0.5, 0), M.steel, this.rod)
    this.eyeEnd = new THREE.Group()
    this.rod.add(this.eyeEnd)
    add(revolve(ring(r * 0.2, r * 0.62, -r * 0.35, 0), 20), M.gold, this.eyeEnd)
    add(new THREE.TorusGeometry(r * 0.55, r * 0.22, 8, 20).rotateY(Math.PI / 2), M.steel, this.eyeEnd).position.y = r * 0.55
    this.setLength(body * 1.6)
  }

  /** eye to eye distance */
  setLength(len: number) {
    const ext = Math.max(0.02, len - this.body)
    const rodLen = ext
    this.rod.position.y = this.body
    const cyl = this.rod.children[0] as THREE.Mesh
    cyl.scale.y = rodLen - this.r * 0.55
    this.eyeEnd.position.y = rodLen - this.r * 0.55
  }

  /** Place the actuator between two points in its parent's frame. */
  span(a: THREE.Vector3, b: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a)
    const len = d.length()
    this.root.position.copy(a)
    this.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    this.setLength(len)
  }
}

/** A glowing load ring for any actuator. */
export function loadRing(r: number) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.6) })
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.002, r * 0.06), 6, 48), m)
  mesh.rotation.x = Math.PI / 2
  mesh.layers.set(LAYER_GLOW)
  return { mesh, mat: m }
}

/**
 * Two actuators at display size beside the robot, pulled apart along their
 * axes so every part can be named: one rotary joint and one linear screw.
 */
export class Specimens {
  readonly group = new THREE.Group()
  readonly rotary: ActPart[]
  readonly linearParts: ActPart[]
  readonly rotRoot: THREE.Group
  readonly lin: LinearActuator
  private base = new Map<THREE.Object3D, THREE.Vector3>()
  private step: number
  private linStep: number
  constructor() {
    const R = 0.15, L = 0.2
    const rot = rotaryActuator(R, L, true)
    this.rotRoot = rot.root
    this.rotary = rot.parts
    rot.root.rotation.z = -Math.PI / 2
    rot.root.position.set(0, 0.55, 0)
    this.group.add(rot.root)
    this.step = L * 0.52
    this.lin = new LinearActuator(0.055, 0.34, true)
    this.lin.setLength(0.34 * 1.55)
    this.lin.root.rotation.z = -Math.PI / 2
    this.lin.root.position.set(-0.45, 0.02, 0)
    this.linearParts = this.lin.parts
    this.linStep = 0.11
    this.group.add(this.lin.root)
    for (const p of [...this.rotary, ...this.linearParts]) this.base.set(p.group, p.group.position.clone())
  }

  /** k 0..1 how far apart */
  update(k: number, spin: number) {
    const e = k * k * (3 - 2 * k)
    for (const p of this.rotary) p.group.position.copy(this.base.get(p.group)!).setY(this.base.get(p.group)!.y + p.explode * this.step * e)
    for (const p of this.linearParts) p.group.position.copy(this.base.get(p.group)!).setY(this.base.get(p.group)!.y + p.explode * this.linStep * e)
    const rotor = this.rotary.find((p) => p.name === 'Rotor')
    const wg = this.rotary.find((p) => p.name === 'Wave generator')
    if (rotor) rotor.group.rotation.y = spin
    if (wg) wg.group.rotation.y = spin
    const fl = this.rotary.find((p) => p.name === 'Output flange')
    if (fl) fl.group.rotation.y = -spin / 100
  }

  anchor(name: string) {
    const p = [...this.rotary, ...this.linearParts].find((q) => q.name === name)
    return p ? p.group : null
  }
}
