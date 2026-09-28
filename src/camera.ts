import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PUMP_POS, FUSION_POS, TOKAMAK_MID, LINE_POS } from './scene/room'
import { CAR_POS, DRIVE_POS } from './car/bay'
import { ROBOT_POS, HOLE_POS, JET_POS, F1_POS, DRONE_POS } from './scene/room'

export interface Shot {
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
  /** already framed for the screen: do not pull back further */
  noScale?: boolean
}

const P = PUMP_POS
const F = FUSION_POS
const FY = TOKAMAK_MID
const L = LINE_POS
const f = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 30): Shot => ({ pos: [F.x + dx, FY + dy, F.z + dz], target: [F.x + tx, FY + ty, F.z + tz], fov })
const C = CAR_POS
const D = DRIVE_POS
const c = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 34): Shot => ({ pos: [C.x + dx, dy, C.z + dz], target: [C.x + tx, ty, C.z + tz], fov })
const RB = ROBOT_POS
const rb = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 32): Shot => ({ pos: [RB.x + dx, dy, RB.z + dz], target: [RB.x + tx, ty, RB.z + tz], fov })
const HP = HOLE_POS
const hs = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 34): Shot => ({ pos: [HP.x + dx, dy, HP.z + dz], target: [HP.x + tx, ty, HP.z + tz], fov })
const JP = JET_POS
const FP = F1_POS
const DP = DRONE_POS
const ds = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 36): Shot => ({ pos: [DP.x + dx, DP.y + dy, DP.z + dz], target: [DP.x + tx, DP.y + ty, DP.z + tz], fov })
const fs = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 36): Shot => ({ pos: [FP.x + dx, FP.y + dy, FP.z + dz], target: [FP.x + tx, FP.y + ty, FP.z + tz], fov })
const jt = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 36): Shot => ({ pos: [JP.x + 2.8 + dx, JP.y + dy, JP.z + dz], target: [JP.x + 2.8 + tx, JP.y + ty, JP.z + tz], fov })
const d = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 30): Shot => ({ pos: [D.x + dx, D.y + dy, D.z + dz], target: [D.x + tx, D.y + ty, D.z + tz], fov })
const l = (dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, fov = 30): Shot => ({ pos: [L.x + dx, dy, L.z + dz], target: [L.x + tx, ty, L.z + tz], fov })
export const SHOTS: Record<string, Shot> = {
  hall: { pos: [7.2, 16.5, 20.5], target: [7.2, 0.7, -2.4], fov: 47 },
  hallTall: { pos: [-19.5, 12.5, 6.5], target: [6.5, 0.4, -1.2], fov: 62 },
  car: c(3.7, 1.75, 7.05, 0.45, 0.95, 0, 39),
  drone: ds(1.45, 2.05, 2.0, 0, 1.7, 0, 38),
  droneLow: ds(1.5, 0.55, 2.5, 0, 1.75, 0, 38),
  droneTop: ds(0.9, 3.5, 1.5, 0, 1.72, 0, 40),
  droneRotor: ds(1.0, 2.05, 1.15, 0.32, 1.78, 0.32, 34),
  droneAir: ds(0.2, 1.25, 4.3, 0, 1.15, 0, 44),
  droneWind: ds(1.8, 2.1, 3.9, -1.0, 1.55, 0, 46),
  droneGimbal: ds(1.15, 1.55, 0.75, 0.2, 1.6, 0, 32),
  droneCut: ds(0.35, 2.0, 1.35, 0, 1.73, 0, 36),
  droneExploded: ds(1.7, 2.5, 2.9, 0, 1.85, 0, 40),
  f1: fs(4.7, 1.1, 4.3, 0.1, 0.42, 0, 34),
  f1Low: fs(3.5, 0.34, 2.7, 0.4, 0.36, 0, 36),
  f1Side: fs(0.0, 0.95, 6.4, 0, 0.45, 0, 40),
  f1Air: fs(-0.4, 1.9, 6.6, -0.5, 0.55, 0, 44),
  f1Under: fs(0.6, 0.16, 4.4, -0.3, 0.12, 0, 40),
  f1Rear: fs(-5.3, 1.35, 3.7, -1.2, 0.55, 0, 36),
  f1Wing: fs(-4.6, 1.55, 2.9, -2.2, 0.8, 0, 34),
  f1FrontWing: fs(4.0, 0.6, 1.8, 2.5, 0.2, 0, 36),
  f1Brake: fs(2.7, 0.55, 2.3, 1.7, 0.36, 0.8, 34),
  f1Cut: fs(-0.6, 1.2, 3.7, -0.7, 0.4, 0, 38),
  f1Engine: fs(-0.95, 0.95, 1.3, -0.95, 0.32, -0.1, 36),
  f1Exploded: fs(0.6, 2.5, 7.4, 0, 0.6, 0, 46),
  jet: jt(-2.6, 0.9, 7.8, 1.0, -0.2, 0, 40),
  jetOpen: jt(3.2, 1.1, 8.2, 1.4, -0.1, 0, 44),
  jetHero: jt(1.8, 0.75, 3.4, -0.4, -0.05, 0, 38),
  jetNozzle: jt(4.9, 0.55, 2.5, 2.4, -0.05, 0, 40),
  jetEstab: jt(-5.5, 1.5, 8.6, 0.5, -0.2, 0, 42),
  jetCut: jt(-0.9, 0.35, 3.5, -0.3, 0, 0, 38),
  jetFan: jt(-5.2, 0.35, 1.9, -2.6, 0, 0, 36),
  jetHot: jt(0.3, 0.3, 2.4, -0.4, 0, 0, 36),
  jetBlaze: jt(1.6, 0.7, 4.6, 1.6, -0.1, 0, 40),
  jetPlume: jt(2.6, 0.5, 6.0, 4.2, -0.1, 0, 38),
  jetExploded: jt(0.2, 1.3, 8.6, 0.6, -0.1, 0, 44),
  hole: hs(1.0, 2.25, 7.4, 0, 2.2, 0, 36),
  holeEstab: hs(5.5, 3.6, 9.6, 0, 2.0, 0, 42),
  holeClose: hs(0.35, 2.3, 3.6, 0, 2.25, -1.0, 34),
  holeDoor: hs(0, 2.25, 0.1, 0, 2.25, -4, 58),
  holeSide: hs(4.6, 1.6, 4.6, 0, 2.1, 0, 36),
  robot: rb(1.55, 2.0, 3.5, 0.08, 1.42, 0, 34),
  robotEstab: rb(3.2, 2.7, 6.2, 0, 1.4, 0, 38),
  robotLegs: rb(1.35, 1.35, 2.75, 0.05, 1.1, 0.1, 32),
  robotXray: rb(-1.25, 2.0, 3.0, 0, 1.5, 0, 34),
  robotPower: rb(-1.95, 1.95, 0.55, 0.0, 1.6, 0.0, 32),
  robotHands: rb(-0.95, 1.8, 1.25, 0.02, 1.7, 0.5, 30),
  robotActuator: rb(1.95, 1.7, 2.0, 1.5, 1.42, 0.0, 36),
  robotExploded: rb(2.2, 2.3, 4.5, 0, 1.45, 0, 36),
  carTall: c(5.4, 2.4, 5.6, 0.35, 0.95, 0, 34),
  carXrayTall: c(4.6, 2.9, 4.8, 0.2, 0.85, 0, 34),
  carExplodedTall: c(5.2, 4.2, 5.6, 0.1, 1.5, 0, 38),
  carEstab: c(7.2, 3.0, 7.1, 0.3, 1.0, 0, 42),
  carSteer: c(5.0, 1.35, 3.6, 1.7, 0.55, 0.3, 34),
  carRear: c(-5.8, 1.7, 5.6, 0.2, 1.0, 0, 34),
  carExploded: c(4.8, 3.9, 7.0, 0, 1.55, 0, 42),
  carXray: c(3.8, 2.6, 5.4, -0.2, 0.95, 0, 34),
  carEnergy: c(2.6, 1.55, 3.9, -0.2, 0.62, 0, 34),
  carMotors: c(-3.9, 1.35, 3.3, -1.9, 0.75, 0, 34),
  carStructure: c(4.6, 2.9, 4.4, 0.4, 0.8, 0, 36),
  motor: d(1.25, 0.9, 1.8, 0.03, 0.33, 0, 30),
  motorFace: d(0.62, 0.66, 1.0, 0.03, 0.4, 0.03, 30),
  motorGears: d(-0.95, 0.55, -1.5, 0.08, 0.22, -0.12, 30),
  motorExploded: d(1.6, 1.15, 2.3, 0.05, 0.5, 0, 34),
  fusion: f(3.3, 1.75, 5.9, 0.15, -0.3, 0.0, 34),
  fusionEstab: f(3.4, 2.4, 9.5, 0.3, -0.2, 0, 34),
  fusionPlasma: f(2.2, 0.55, 2.7, 0.75, -0.1, -0.1, 32),
  fusionField: f(-1.9, 1.35, 3.3, -0.35, 0.05, -0.2, 32),
  fusionNeutron: f(2.3, 0.75, 3.1, 0.55, -0.15, -0.3, 32),
  fusionInside: f(0.55, 0.05, 1.2, -0.2, -0.05, -0.9, 38),
  fusionExploded: f(2.6, 2.6, 7.6, 0.0, 0.35, 0.0, 32),
  fusionPower: { pos: [F.x - 1.05, 2.65, 5.1], target: [F.x - 3.7, 1.0, 1.1], fov: 36 },
  fusionPowerWide: { pos: [F.x + 0.6, 3.1, 5.6], target: [F.x - 2.4, 1.15, 0.3], fov: 38 },
  fusionBeam: f(3.6, 1.4, 1.4, 0.3, -0.1, -1.0, 32),
  line: l(0.2, 2.65, 5.0, 0.1, 1.32, -0.35, 34),
  lineClose: l(-1.1, 2.25, 2.35, -1.25, 1.0, -0.05, 32),
  lineBottleneck: l(-1.0, 1.95, 1.75, -1.2, 1.05, -0.05, 32),
  lineScreen: l(1.6, 2.0, 3.0, 0.3, 1.75, -0.8, 32),
  lineWide: l(2.6, 4.2, 7.0, 0.1, 1.0, -0.4, 34),
  estab: { pos: [0.62, 1.8, 3.05], target: [-0.5, 1.3, 0], fov: 32 },
  hero: { pos: [0.02, 1.64, 2.5], target: [-0.66, 1.33, 0], fov: 30 },
  cut: { pos: [-0.8, 1.5, 1.5], target: [-1.08, 1.37, 0], fov: 30 },
  ox: { pos: [-1.0, 1.56, 1.14], target: [-1.2, 1.4, 0], fov: 30 },
  ch4: { pos: [-0.66, 1.58, 1.62], target: [-0.98, 1.41, 0], fov: 30 },
  fire: { pos: [-0.74, 1.45, 1.12], target: [-0.9, 1.35, 0], fov: 30 },
  powerhead: { pos: [-0.9, 1.52, 0.92], target: [-1.1, 1.4, 0], fov: 30 },
  nozzle: { pos: [-0.35, 1.44, 1.05], target: [-0.62, 1.33, 0], fov: 30 },
  exploded: { pos: [-0.42, 1.74, 1.72], target: [-0.96, 1.42, 0], fov: 32 },
  plume: { pos: [0.3, 1.58, 2.75], target: [-0.08, 1.3, 0], fov: 32 },
  vacuum: { pos: [0.78, 1.82, 3.15], target: [0.1, 1.28, 0], fov: 34 },
  wide: { pos: [1.6, 2.35, 5.4], target: [1.0, 1.15, -0.6], fov: 34 },
  pump: { pos: [P.x + 0.66, P.y + 0.5, P.z + 1.72], target: [P.x + 0.02, P.y + 0.28, P.z], fov: 30 },
  pumpClose: { pos: [P.x + 0.22, P.y + 0.3, P.z + 0.78], target: [P.x - 0.02, P.y + 0.22, P.z], fov: 30 },
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Camera moves between shots along a gentle arc; the user can take over at any time. */
export class CameraRig {
  private from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 }
  private to = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 }
  private lift = 0
  private t = 1
  private dur = 1
  flying = false
  lastUser = -1e9
  /** Distance multiplier for tall screens: a portrait phone sees far less width, so shots pull back. */
  scale = 1
  private scaled(s: Shot, out: THREE.Vector3) {
    out.set(...s.pos)
    if (this.scale === 1 || s.noScale) return out
    const t = new THREE.Vector3(...s.target)
    return out.sub(t).multiplyScalar(this.scale).add(t)
  }

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls) {
    controls.addEventListener('start', () => {
      this.flying = false
      this.t = 1
      this.lastUser = performance.now()
    })
  }

  /** a shot name, swapped for its Tall variant on portrait screens when there is one */
  resolve(shot: Shot | string): Shot {
    if (typeof shot !== 'string') return shot
    const tall = this.scale > 1.3 ? SHOTS[shot + 'Tall'] : undefined
    return tall ? { ...tall, noScale: shot === 'hall' } : SHOTS[shot]
  }

  set(shotIn: Shot | string) {
    const shot = this.resolve(shotIn)
    this.scaled(shot, this.camera.position)
    this.controls.target.set(...shot.target)
    this.camera.fov = shot.fov
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.flying = false
    this.t = 1
  }

  fly(shot: Shot | string, dur = 1.8, lift = 0) {
    const s = this.resolve(shot)
    this.from.pos.copy(this.camera.position)
    this.from.target.copy(this.controls.target)
    this.from.fov = this.camera.fov
    this.scaled(s, this.to.pos)
    this.to.target.set(...s.target)
    this.to.fov = s.fov
    this.lift = lift
    this.t = 0
    this.dur = dur
    this.flying = true
  }

  update(dt: number) {
    if (!this.flying) return
    this.t = Math.min(1, this.t + dt / this.dur)
    const e = easeInOut(this.t)
    // the eye leads slightly: the camera looks toward where it is going
    const et = easeInOut(Math.min(1, this.t * 1.3))
    const p = new THREE.Vector3().lerpVectors(this.from.pos, this.to.pos, e)
    p.y += Math.sin(Math.PI * e) * this.lift
    this.camera.position.copy(p)
    this.controls.target.lerpVectors(this.from.target, this.to.target, et)
    this.camera.fov = this.from.fov + (this.to.fov - this.from.fov) * e
    this.camera.updateProjectionMatrix()
    if (this.t >= 1) this.flying = false
  }
}
