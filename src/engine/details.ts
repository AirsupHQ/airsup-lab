import * as THREE from 'three'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import { revolve, ringProfile, spline2, rAt, boltGeo, ringMatrices } from '../core/geometry'

/**
 * The small stuff that makes hardware read as real: bolted joints at every
 * housing interface, instrumentation and purge lines with fittings and
 * clamps, braided harnesses with connectors, valve actuators, gimbal caps.
 * Everything here is static, so it merges into a handful of draw calls.
 */

export interface DetailCtx {
  cut: CutState
  M: Record<string, THREE.Material>
  plumb: THREE.Group
  part: (name: string) => THREE.Group
  yT: number
  X: number
  loxOutlet: { p: THREE.Vector3; t: THREE.Vector3 }
}

const domeOut = spline2([[0.362, 0.112], [0.352, 0.16], [0.318, 0.23], [0.282, 0.292], [0.268, 0.33]], 10)
const turbOut = spline2([[0.268, 0.33], [0.287, 0.36], [0.302, 0.405], [0.29, 0.448], [0.262, 0.47]], 8)
const pbOut = spline2([[0.262, 0.47], [0.258, 0.52], [0.252, 0.6], [0.246, 0.66]], 6)

/** Outer radius of the central stack at height y (engine frame). */
function stackR(y: number, yT: number) {
  if (y < -0.046) return rAt(spline2([[0.34, -0.07], [0.322, -0.15], [0.282, -0.28], [0.236, yT + 0.03]], 10), y)
  if (y < 0.112) return 0.375
  if (y < 0.33) return rAt(domeOut, y)
  if (y < 0.47) return rAt(turbOut, y)
  if (y < 0.66) return rAt(pbOut, y)
  if (y < 0.69) return 0.25
  return 0.155
}

export function addDetails(c: DetailCtx) {
  const { cut, M, plumb, yT, X } = c
  const tube = surf({ name: 'tube', color: 0xb9bdc2, metalness: 1, roughness: 0.3, detail: 6, roughVar: 0.2, cut, capColor: 0xc5c9ce })
  const anod = surf({ name: 'anod', color: 0x27477d, metalness: 0.9, roughness: 0.32, detail: 10, cut, capColor: 0x5a78ad })
  const braid = surf({ name: 'braid', color: 0x1d1f23, metalness: 0.2, roughness: 0.62, detail: 160, bump: 0.0012, colorVar: 0.25, cut, capColor: 0x44474d })
  const conn = surf({ name: 'conn', color: 0x5d6168, metalness: 1, roughness: 0.36, detail: 30, bump: 0.0004, cut, capColor: 0x9ea3aa })
  const gold = M.gold
  const dark = M.dark
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = plumb) => {
    const x = new THREE.Mesh(g, m)
    x.castShadow = true
    x.receiveShadow = true
    parent.add(x)
    return x
  }
  const inst = (g: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], parent: THREE.Object3D = plumb) => {
    if (!mats.length) return
    const im = new THREE.InstancedMesh(g, m, mats.length)
    mats.forEach((mm, i) => im.setMatrixAt(i, mm))
    im.castShadow = true
    im.receiveShadow = true
    parent.add(im)
  }

  /* ------------ bolted joints at the remaining housing interfaces ------------ */
  const joint = (parent: THREE.Object3D, r0: number, r1: number, y: number, n: number, bolt: number, phase = 0) => {
    mesh(revolve(ringProfile(r0, r1, y - 0.011, y + 0.011, 0.003), 160), M.machined, parent)
    inst(boltGeo(bolt, bolt * 1.1), dark, ringMatrices(n, (r0 + r1) / 2 + 0.004, y + 0.011, phase), parent)
  }
  joint(c.part('loxTurbine'), 0.262, 0.296, 0.334, 34, 0.0085, 0.05)
  joint(c.part('loxPreburner'), 0.24, 0.272, 0.47, 32, 0.008, 0.1)
  inst(boltGeo(0.0075, 0.0082), dark, ringMatrices(18, 0.178, 0.922, 0.1), c.part('loxPump'))
  const ch4 = c.part('ch4Pump')
  const ch4g = new THREE.Group()
  ch4g.position.set(X, 0, 0)
  ch4.add(ch4g)
  joint(ch4g, 0.105, 0.132, 0.44, 12, 0.0065)
  joint(ch4g, 0.086, 0.118, 0.64, 12, 0.006, 0.2)
  joint(ch4g, 0.138, 0.162, -0.33, 22, 0.0065, 0.1)

  /* ------------ instrumentation and purge lines ------------ */
  const nuts: THREE.Matrix4[] = []
  const sleeves: THREE.Matrix4[] = []
  const clamps: THREE.Matrix4[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const orient = (p: THREE.Vector3, dir: THREE.Vector3, s: number) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()), new THREE.Vector3(s, s, s))
  const line = (pts: THREE.Vector3[], r: number, mat: THREE.Material = tube, fittings = true) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const len = curve.getLength()
    mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 140)), r, 10, false), mat)
    if (fittings) {
      for (const u of [0, 1]) {
        const p = curve.getPointAt(u)
        const t = curve.getTangentAt(u)
        nuts.push(orient(p.clone().addScaledVector(t, u === 0 ? 0.012 : -0.012), t, r / 0.006))
        sleeves.push(orient(p.clone().addScaledVector(t, u === 0 ? 0.001 : -0.001), t, r / 0.006))
      }
      const nc = Math.floor(len / 0.16)
      for (let k = 1; k <= nc; k++) {
        const u = k / (nc + 1)
        clamps.push(orient(curve.getPointAt(u), curve.getTangentAt(u), r / 0.006))
      }
    }
    return curve
  }
  // a line that follows the central stack at a small stand-off
  const hug = (spec: [number, number][], r: number, off = 0.012, mat: THREE.Material = tube) => {
    const pts = spec.map(([th, y]) => {
      const R = stackR(y, yT) + r + off
      return new THREE.Vector3(Math.sin(th) * R, y, Math.cos(th) * R)
    })
    return line(pts, r, mat)
  }
  // front half (toward the viewer), then the far side
  hug([[0.95, 0.63], [0.9, 0.5], [0.78, 0.38], [0.72, 0.25], [0.66, 0.14], [0.64, 0.116]], 0.0065)
  hug([[0.38, 0.64], [0.32, 0.52], [0.26, 0.4], [0.2, 0.28], [0.16, 0.16], [0.15, 0.116]], 0.0055)
  hug([[-0.52, 0.62], [-0.6, 0.48], [-0.72, 0.34], [-0.78, 0.2], [-0.8, 0.117]], 0.0075)
  hug([[-0.2, 0.05], [-0.18, -0.03], [-0.16, -0.12], [-0.14, -0.2], [-0.13, -0.27]], 0.006)
  hug([[0.42, 0.04], [0.46, -0.06], [0.52, -0.16], [0.56, -0.25]], 0.0055)
  hug([[-0.95, 0.06], [-1.05, -0.04], [-1.12, -0.16], [-1.2, -0.3]], 0.0065)
  hug([[2.5, 0.62], [2.45, 0.45], [2.4, 0.3], [2.38, 0.14], [2.36, 0.116]], 0.007)
  hug([[2.9, 0.64], [3.0, 0.48], [3.1, 0.32], [3.15, 0.2], [3.2, 0.117]], 0.006)
  hug([[3.5, 0.6], [3.55, 0.44], [3.62, 0.3], [3.66, 0.16], [3.7, 0.116]], 0.0075)
  hug([[3.9, 0.05], [3.95, -0.08], [4.0, -0.2], [4.05, -0.3]], 0.006)
  // along the methane turbopump
  const ch4Line = (a: number, y0: number, y1: number, r: number, R: number) => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 5; i++) {
      const y = y0 + ((y1 - y0) * i) / 5
      pts.push(new THREE.Vector3(X + Math.sin(a) * R, y, Math.cos(a) * R))
    }
    line(pts, r)
  }
  ch4Line(0.35, 0.42, -0.3, 0.0065, 0.172)
  ch4Line(-0.45, 0.42, -0.26, 0.0055, 0.17)
  ch4Line(2.6, 0.42, -0.3, 0.007, 0.172)

  const nutG = new THREE.CylinderGeometry(0.0115, 0.0115, 0.016, 6)
  const sleeveG = new THREE.CylinderGeometry(0.0085, 0.0085, 0.01, 12)
  const clampG = new THREE.TorusGeometry(0.0085, 0.0028, 6, 14)
  clampG.rotateX(Math.PI / 2)
  inst(nutG, anod, nuts)
  inst(sleeveG, tube, sleeves)
  inst(clampG, dark, clamps.splice(0))

  /* ------------ braided harnesses with connectors ------------ */
  const plugs: THREE.Matrix4[] = []
  const harness = (pts: [number, number, number][], r = 0.011) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal')
    mesh(new THREE.TubeGeometry(curve, Math.round(curve.getLength() * 120), r, 10, false), braid)
    for (const u of [0, 1]) plugs.push(orient(curve.getPointAt(u), curve.getTangentAt(u), r / 0.011))
    const n = Math.floor(curve.getLength() / 0.2)
    for (let k = 1; k <= n; k++) {
      const u = k / (n + 1)
      clamps.push(orient(curve.getPointAt(u), curve.getTangentAt(u), (r / 0.006) * 0.9))
    }
  }
  harness([[-0.36, 0.42, -0.26], [-0.34, 0.56, -0.2], [-0.22, 0.66, -0.2], [0.0, 0.7, -0.27], [0.2, 0.66, -0.26], [0.3, 0.62, -0.16], [0.37, 0.63, -0.04]])
  harness([[-0.36, 0.2, -0.27], [-0.3, 0.05, -0.33], [-0.1, -0.02, -0.39], [0.14, -0.04, -0.37], [0.3, -0.1, -0.28], [X - 0.1, -0.22, -0.14], [X + 0.06, -0.25, -0.13]], 0.012)
  harness([[-0.26, 0.5, 0.2], [-0.22, 0.34, 0.27], [-0.14, 0.2, 0.32], [-0.06, 0.05, 0.395], [0.0, -0.08, 0.37], [0.02, -0.16, 0.34]], 0.01)
  const plugG = new THREE.CylinderGeometry(0.018, 0.018, 0.045, 16)
  inst(plugG, conn, plugs)
  const plugRing = new THREE.CylinderGeometry(0.0195, 0.0195, 0.01, 16)
  inst(plugRing, gold, plugs.map((m) => m.clone()))

  /* ------------ valve actuators ------------ */
  const actuator = (at: THREE.Vector3, axis: THREE.Vector3, face: THREE.Vector3) => {
    const g = new THREE.Group()
    g.position.copy(at)
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.clone().normalize())
    plumb.add(g)
    const body = new THREE.BoxGeometry(0.11, 0.1, 0.09)
    body.translate(0, 0, 0.06)
    mesh(body, M.cast, g)
    const fins: THREE.Matrix4[] = []
    for (let i = 0; i < 7; i++) fins.push(new THREE.Matrix4().makeTranslation(-0.045 + i * 0.015, 0, 0.113))
    inst(new THREE.BoxGeometry(0.004, 0.09, 0.02), M.cast, fins, g)
    const motor = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 20)
    motor.rotateZ(Math.PI / 2)
    motor.translate(0.105, 0, 0.06)
    mesh(motor, dark, g)
    const cap = new THREE.CylinderGeometry(0.033, 0.033, 0.012, 20)
    cap.rotateZ(Math.PI / 2)
    cap.translate(0.165, 0, 0.06)
    mesh(cap, M.machined, g)
    const plug = new THREE.CylinderGeometry(0.014, 0.014, 0.03, 12)
    plug.rotateX(Math.PI / 2)
    plug.translate(0.03, 0.03, 0.12)
    mesh(plug, gold, g)
    void axis
  }
  // main oxidizer valve on the oxygen outlet, main fuel valve on the regen supply
  {
    const { p, t } = c.loxOutlet
    const at = p.clone().addScaledVector(t, 0.11)
    const vb = new THREE.SphereGeometry(0.105, 32, 20)
    vb.translate(at.x, at.y, at.z)
    mesh(vb, M.cast)
    const outward = new THREE.Vector3(at.x, 0, at.z).normalize()
    actuator(at.clone().addScaledVector(outward, 0.07), t, outward)
  }
  actuator(new THREE.Vector3(0.95, 0.3, 0.06), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1))

  /* ------------ gimbal bearing caps ------------ */
  const g = c.part('gimbal')
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    const p = n.clone().multiplyScalar(0.33).add(new THREE.Vector3(0, 1.01, 0))
    const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.016, 28)
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, n))
    cap.translate(p.x, p.y, p.z)
    mesh(cap, M.machined, g)
    const bm: THREE.Matrix4[] = []
    for (let i = 0; i < 6; i++) {
      const b = (i / 6) * Math.PI * 2
      const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))
      const q = p.clone().addScaledVector(n, 0.008).addScaledVector(tangent, Math.cos(b) * 0.034).add(new THREE.Vector3(0, Math.sin(b) * 0.034, 0))
      bm.push(orient(q, n, 1))
    }
    inst(boltGeo(0.0065, 0.008), dark, bm, g)
  }

  inst(clampG, dark, clamps.splice(0))
}
