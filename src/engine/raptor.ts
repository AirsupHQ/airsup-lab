import * as THREE from 'three'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import {
  revolve, wall, ringProfile, circleProfile, pipe, bentPath, boltGeo, ringMatrices, P2, spline2, rAt,
  helixBlade, impellerBlade, hollowTorus, SpiralCurve, volute, flangeAt, boltCircle,
} from '../core/geometry'
import { fluidMat, FluidKind } from './fluid'
import { addDetails } from './details'

const D = Math.PI / 180
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------------ */
/* Thrust chamber contour. Engine frame: +Y from nozzle to powerhead, the    */
/* injector face at y = 0. Units are metres at full size.                    */
/* ------------------------------------------------------------------------ */

export const GEO = (() => {
  const Rt = 0.115, Rc = 0.205, beta = 32 * D, r1 = 0.08, r2 = 1.5 * Rt, r3 = 0.382 * Rt
  const thN = 32 * D, thE = 8 * D, Re = 0.67, Lcyl = 0.24, Ln = 1.6
  const ra = Rt + r2 * (1 - Math.cos(beta)), ya = r2 * Math.sin(beta)
  const re1 = Rc - r1 * (1 - Math.cos(beta))
  const ye1 = ya + (re1 - ra) / Math.tan(beta)
  const yc1 = ye1 + r1 * Math.sin(beta)
  const yT = -Lcyl - yc1
  const yE = yT - Ln
  const pts: P2[] = []
  for (let i = 0; i <= 12; i++) pts.push([Rc, -(Lcyl * i) / 12])
  for (let i = 1; i <= 16; i++) {
    const ph = -(beta * i) / 16
    pts.push([Rc - r1 + r1 * Math.cos(ph), yT + yc1 + r1 * Math.sin(ph)])
  }
  for (let i = 0; i <= 20; i++) {
    const ph = Math.PI - beta + (beta * i) / 20
    pts.push([Rt + r2 + r2 * Math.cos(ph), yT + r2 * Math.sin(ph)])
  }
  for (let i = 1; i <= 12; i++) {
    const ph = Math.PI + (thN * i) / 12
    pts.push([Rt + r3 + r3 * Math.cos(ph), yT + r3 * Math.sin(ph)])
  }
  const N = pts[pts.length - 1]
  const dN: P2 = [Math.sin(thN), -Math.cos(thN)]
  const dE: P2 = [Math.sin(thE), -Math.cos(thE)]
  const E: P2 = [Re, yE]
  const det = dN[0] * -dE[1] - dN[1] * -dE[0]
  const bx = E[0] - N[0], by = E[1] - N[1]
  const a = (bx * -dE[1] - by * -dE[0]) / det
  const Q: P2 = [N[0] + a * dN[0], N[1] + a * dN[1]]
  for (let i = 1; i <= 96; i++) {
    const t = i / 96
    pts.push([
      (1 - t) * (1 - t) * N[0] + 2 * (1 - t) * t * Q[0] + t * t * E[0],
      (1 - t) * (1 - t) * N[1] + 2 * (1 - t) * t * Q[1] + t * t * E[1],
    ])
  }
  const ys = pts.map((p) => p[1]), rs = pts.map((p) => p[0])
  const Rin = (y: number) => {
    if (y >= 0) return Rc
    if (y <= yE) return Re
    let lo = 0, hi = ys.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ys[mid] > y) lo = mid
      else hi = mid
    }
    const t = (y - ys[lo]) / (ys[hi] - ys[lo] || 1)
    return rs[lo] + (rs[hi] - rs[lo]) * t
  }
  return { Rt, Rc, Re, yT, yE, yCyl: -Lcyl, Rin, contour: pts, top: 1.1 }
})()

const tL = 0.011, tC = 0.014
const tJ = (y: number) => 0.012 + 0.03 * smooth(GEO.yT - 0.3, GEO.yT + 0.06, y)
export const RL = (y: number) => GEO.Rin(y) + tL
export const RC = (y: number) => RL(y) + tC
export const RJ = (y: number) => RC(y) + tJ(y)
const yCh0 = GEO.yE + 0.21, yCh1 = -0.038

/** Mach number, temperature and time of flight through the chamber, for the flow shader. */
function combustionField(n = 256) {
  const g = 1.2
  const areaRatio = (M: number) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1)))
  const solveM = (ar: number, sup: boolean) => {
    let lo = sup ? 1 : 1e-4, hi = sup ? 12 : 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      const f = areaRatio(mid) - ar
      if (sup ? f > 0 : f < 0) hi = mid
      else lo = mid
    }
    return (lo + hi) / 2
  }
  const y0 = GEO.yE, y1 = 0
  const rows: { y: number; M: number; T: number; R: number }[] = []
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / (n - 1)
    const R = GEO.Rin(y)
    const ar = Math.max((R / GEO.Rt) ** 2, 1.0001)
    const M = y > GEO.yT ? solveM(ar, false) : solveM(ar, true)
    rows.push({ y, M, T: 1 / (1 + ((g - 1) / 2) * M * M), R })
  }
  const tof = new Array(n).fill(0)
  let acc = 0
  for (let i = n - 2; i >= 0; i--) {
    const r = rows[i], rn = rows[i + 1]
    const v = Math.max(0.12, ((r.M + rn.M) / 2) * Math.sqrt((r.T + rn.T) / 2))
    acc += (rn.y - r.y) / v
    tof[i] = acc
  }
  const data = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    const burn = 0.5 + 0.5 * smooth(0, -0.12, r.y)
    const temp = Math.min(1, Math.max(0, ((r.T - 0.33) / 0.67) * burn))
    data[i * 4] = tof[i] * 0.6
    data[i * 4 + 1] = r.M
    data[i * 4 + 2] = temp
    data[i * 4 + 3] = r.R
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return { tex, range: [y0, y1] as [number, number] }
}

export interface Part {
  name: string
  group: THREE.Group
  explode: THREE.Vector3
  home: THREE.Vector3
}

/** The methane pump sits beside the main axis. */
export const CH4X = 0.63

export class Raptor {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly parts: Part[] = []
  readonly anchors: Record<string, THREE.Vector3> = {}
  readonly rotors: { obj: THREE.Object3D; dir: number; rate: number }[] = []
  readonly plumbing: THREE.Object3D[] = []
  readonly fluids: THREE.Mesh[] = []
  readonly injectorFace: THREE.Mesh
  readonly mats: Record<string, THREE.MeshStandardMaterial>
  field = combustionField()

  constructor() {
    this.root.name = 'raptor'
    this.cut = new CutState(this.root, 0.95, 0)
    const cut = this.cut
    const capSteel = 0xb4b9bf
    const M = (this.mats = {
      nozzle: surf({
        name: 'nozzle', color: 0x5f6267, metalness: 1, roughness: 0.44, detail: 1.3, roughVar: 0.28, colorVar: 0.05, bump: 0.0002, streaks: 0.28,
        tint: { y0: GEO.yE, y1: GEO.yT, a: 0x44484e, b: 0x5b5a63, c: 0x8c6a47, strength: 0.6 },
        ribs: [220, 0.00035],
        cut, capColor: capSteel, capRoughness: 0.42,
      }),
      liner: surf({ name: 'liner', color: 0xb06a42, metalness: 1, roughness: 0.34, detail: 3, roughVar: 0.25, colorVar: 0.06, cut, capColor: 0xc97c50, capRoughness: 0.42 }),
      printed: surf({ name: 'printed', color: 0xa9adb3, metalness: 1, roughness: 0.5, detail: 1.2, roughVar: 0.22, colorVar: 0.035, layers: [2300, 0.00004], bump: 0.00015, cut, capColor: capSteel, capRoughness: 0.42 }),
      cast: surf({ name: 'cast', color: 0xa3a8ae, metalness: 1, roughness: 0.44, detail: 1.1, roughVar: 0.22, colorVar: 0.035, bump: 0.00012, cut, capColor: capSteel, capRoughness: 0.42 }),
      machined: surf({ name: 'machined', color: 0xc4c8cd, metalness: 1, roughness: 0.3, detail: 3, roughVar: 0.15, colorVar: 0.02, anisotropy: 0.5, cut, capColor: 0xb9bdc3, capRoughness: 0.42 }),
      dark: surf({ name: 'dark', color: 0x34373c, metalness: 0.9, roughness: 0.4, detail: 9, roughVar: 0.3, cut, capColor: 0x8a8f96 }),
      rotor: surf({ name: 'rotor', color: 0xa3a7ad, metalness: 1, roughness: 0.3, detail: 12, roughVar: 0.3, side: THREE.DoubleSide }),
      gold: surf({ name: 'gold', color: 0xc9a045, metalness: 1, roughness: 0.32, detail: 10, cut, capColor: 0xd9b25e }),
      face: surf({ name: 'face', color: 0x8f7766, metalness: 1, roughness: 0.42, detail: 14, cut, capColor: 0xc9ab8c, emissive: 0xff7a30, emissiveIntensity: 0 }),
    })

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
    const part = (name: string, explode: [number, number, number]) => {
      const group = new THREE.Group()
      group.name = name
      this.root.add(group)
      this.parts.push({ name, group, explode: new THREE.Vector3(...explode), home: new THREE.Vector3() })
      return group
    }
    const fluid = (g: THREE.BufferGeometry, kind: FluidKind, parent: THREE.Object3D, mode: 0 | 1 | 2 | 3 | 4, extra: Record<string, unknown> = {}) => {
      const m = fluidMat(cut, { kind, mode, ...extra })
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.layers.set(m.userData.gas ? 1 : 2)
      mesh.userData.fluid = kind
      parent.add(mesh)
      this.fluids.push(mesh)
      return mesh
    }
    const bolts = (count: number, r: number, y: number, size: number, parent: THREE.Object3D, down = false, phase = 0) =>
      inst(boltGeo(size, size * 1.1), M.dark, ringMatrices(count, r, y, phase, down ? new THREE.Euler(Math.PI, 0, 0) : undefined), parent)

    /* ================= Thrust chamber assembly ================= */
    const tca = part('tca', [0, -1.9, 0])
    add(revolve(wall(GEO.Rin, RL, GEO.yE, 0, 240), 180), M.liner, tca)
    fluid(revolve(wall((y) => RL(y) + 0.0012, (y) => RC(y) - 0.0012, yCh0, yCh1, 220), 180), 'ch4', tca, 1, { scale: 0.09, speed: 1.1, intensity: 1.6, gas: false })
    {
      // chamber body is bulky and tapers to the throat; the nozzle below it follows the contour
      const yJ = GEO.yT - 0.3
      const bulk = spline2([[0.34, -0.07], [0.322, -0.15], [0.282, -0.28], [0.236, GEO.yT + 0.03], [0.215, GEO.yT - 0.1], [RJ(yJ) + 0.014, yJ]], 10)
      const outerC = (y: number) => Math.max(RJ(y), rAt(bulk, y))
      const inner = (y: number) => (y < yCh1 && y > yCh0 ? RC(y) : RL(y))
      const innerChain = (ya: number, yb: number, n: number): P2[] => {
        const out: P2[] = []
        for (let i = 0; i <= n; i++) {
          const y = ya + ((yb - ya) * i) / n
          out.push([inner(y), y])
          if (i < n) {
            const yn = ya + ((yb - ya) * (i + 1)) / n
            const inA = y < yCh1 && y > yCh0, inB = yn < yCh1 && yn > yCh0
            if (inA !== inB) {
              const ys = inA ? (Math.abs(yn - yCh0) < Math.abs(yn - yCh1) ? yCh0 : yCh1) : (Math.abs(y - yCh0) < Math.abs(y - yCh1) ? yCh0 : yCh1)
              out.push([inA ? RC(ys) : RL(ys), ys], [inB ? RC(ys) : RL(ys), ys])
            }
          }
        }
        return out
      }
      // nozzle part: exit up to the joint
      const nz: P2[] = []
      for (let i = 0; i <= 200; i++) { const y = GEO.yE + ((yJ - GEO.yE) * i) / 200; nz.push([RJ(y), y]) }
      nz.push(...innerChain(yJ, GEO.yE, 200))
      add(revolve(nz, 180, 30), M.nozzle, tca)
      // chamber part: joint up to the top flange
      const ch: P2[] = []
      for (let i = 0; i <= 90; i++) { const y = yJ + ((-0.075 - yJ) * i) / 90; ch.push([outerC(y), y]) }
      const rF = 0.375
      ch.push([rF - 0.012, -0.056], [rF, -0.046], [rF, -0.006], [rF - 0.006, 0], [RL(0), 0])
      ch.push(...innerChain(0, yJ, 90))
      add(revolve(ch, 180, 30), M.cast, tca)
      // bolted joint between chamber and nozzle
      const rj = RJ(yJ)
      add(revolve(ringProfile(rj - 0.004, rj + 0.034, yJ - 0.016, yJ + 0.016, 0.004), 160), M.machined, tca)
      bolts(40, rj + 0.022, yJ - 0.016, 0.0075, tca, true, 0.03)
    }
    add(revolve(circleProfile(GEO.Re + tL + tC * 0.5 + 0.008, GEO.yE + 0.004, 0.011, 18), 180), M.nozzle, tca)
    const yM = GEO.yE + 0.19
    const rM = RJ(yM) + 0.024
    for (const h of hollowTorus(rM, yM, 0.04, 0.028)) add(revolve(h, 180), M.cast, tca)
    fluid(revolve(circleProfile(rM, yM, 0.026, 24), 180), 'ch4', tca, 4, { scale: 0.08, speed: 1.4, gas: false })
    const yO = -0.11, rO = RJ(yO) + 0.022
    for (const h of hollowTorus(rO, yO, 0.036, 0.024)) add(revolve(h, 160), M.cast, tca)
    fluid(revolve(circleProfile(rO, yO, 0.022, 24), 160), 'ch4', tca, 4, { scale: 0.08, speed: 1.4, gas: false })
    for (const yb of [GEO.yT - 0.58, GEO.yT - 1.02]) {
      const r = RJ(yb)
      add(revolve(ringProfile(r - 0.004, r + 0.012, yb - 0.02, yb + 0.02, 0.005), 180), M.nozzle, tca)
    }
    const fire = fluid(
      revolve([[0, -0.003], ...GEO.contour.filter((p) => p[1] < -0.003).map((p) => [p[0] - 0.0015, p[1]] as P2), [GEO.Re - 0.0015, GEO.yE], [0, GEO.yE]], 180),
      'fire', tca, 3, { field: this.field.tex, fieldRange: this.field.range, intensity: 1.0 },
    )
    fire.renderOrder = 2
    bolts(40, 0.352, -0.044, 0.011, tca, true, 0.04)

    /* ================= Main injector ================= */
    const inj = part('injector', [0, -1.3, 0])
    this.injectorFace = add(revolve(ringProfile(0, RL(0), 0, 0.022, 0.002), 128), M.face, inj)
    fluid(revolve(ringProfile(0, 0.212, 0.024, 0.06), 128), 'fuelgas', inj, 4, { scale: 0.05, speed: 1.6, intensity: 1.2 })
    add(revolve(ringProfile(0, 0.214, 0.062, 0.084, 0.002), 128), M.machined, inj)
    {
      const cx = 0.305, cy = 0.055, cr = 0.036
      const ro = 0.375
      const lower: P2[] = [[RL(0), 0], [ro - 0.01, 0], [ro, 0.01], [ro, cy], [cx + cr, cy]]
      for (let i = 1; i < 18; i++) { const a = -(Math.PI * i) / 18; lower.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a)]) }
      lower.push([cx - cr, cy], [RL(0), cy])
      const upper: P2[] = [[RL(0), cy], [cx - cr, cy]]
      for (let i = 1; i < 18; i++) { const a = Math.PI - (Math.PI * i) / 18; upper.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a)]) }
      upper.push([cx + cr, cy], [ro, cy], [ro, 0.1], [ro - 0.012, 0.112], [RL(0), 0.112])
      add(revolve(lower, 180), M.cast, inj)
      add(revolve(upper, 180), M.cast, inj)
      fluid(revolve(circleProfile(cx, cy, cr - 0.002, 20), 180), 'fuelgas', inj, 4, { scale: 0.06, speed: 1.4, intensity: 1.3 })
      bolts(40, 0.352, 0.112, 0.011, inj, false, 0.04)
    }
    {
      const g = revolve(ringProfile(0.0048, 0.0082, -0.001, 0.14, 0.001), 14)
      const radii = [0, 0.036, 0.072, 0.108, 0.144, 0.18]
      const counts = [1, 6, 12, 18, 24, 30]
      const mats: THREE.Matrix4[] = []
      radii.forEach((r, k) => mats.push(...ringMatrices(counts[k], r, 0, k * 0.2)))
      inst(g, M.machined, mats, inj)
    }

    /* ================= Oxygen rich dome ================= */
    const dome = part('dome', [0, -1.14, 0])
    const domeOut = spline2([[0.362, 0.112], [0.352, 0.16], [0.318, 0.23], [0.282, 0.292], [0.268, 0.33]], 10)
    const domeIn = spline2([[0.326, 0.112], [0.316, 0.16], [0.28, 0.225], [0.222, 0.29], [0.2, 0.33]], 10)
    add(revolve([...domeOut, ...domeIn.slice().reverse()], 180), M.cast, dome)
    fluid(revolve([[0, 0.086], [0.212, 0.086], [0.212, 0.112], ...domeIn.slice(1).map((p) => [p[0] - 0.003, p[1]] as P2), [0, 0.33]], 128), 'oxgas', dome, 2, { scale: 0.07, speed: 1.2, intensity: 1.1 })

    /* ================= Oxygen turbopump, on the axis ================= */
    const loxTurb = part('loxTurbine', [0, -0.94, 0])
    const turbOut = spline2([[0.268, 0.33], [0.287, 0.36], [0.302, 0.405], [0.29, 0.448], [0.262, 0.47]], 8)
    add(revolve([...turbOut, [0.196, 0.47], [0.196, 0.33]], 180), M.cast, loxTurb)
    fluid(revolve(wall(() => 0.04, () => 0.193, 0.334, 0.468, 10), 128), 'oxgas', loxTurb, 4, { scale: 0.05, speed: 2.2, intensity: 1.2 })
    {
      const g = new THREE.BoxGeometry(0.036, 0.03, 0.005)
      const mats = ringMatrices(48, 0.172, 0.435, 0.03)
      mats.forEach((m) => m.multiply(new THREE.Matrix4().makeRotationX(-38 * D)))
      inst(g, M.machined, mats, loxTurb)
    }
    bolts(36, 0.278, 0.47, 0.009, loxTurb, false, 0.1)

    const loxPB = part('loxPreburner', [0, -0.72, 0])
    const pbOut = spline2([[0.262, 0.47], [0.258, 0.52], [0.252, 0.6], [0.246, 0.66]], 6)
    add(revolve([...pbOut, [0.216, 0.66], [0.216, 0.47]], 160), M.printed, loxPB)
    add(revolve(wall(() => 0.062, () => 0.086, 0.47, 0.7), 64), M.machined, loxPB)
    add(revolve(ringProfile(0.086, 0.25, 0.66, 0.69, 0.004), 160), M.machined, loxPB)
    fluid(revolve(wall(() => 0.088, () => 0.213, 0.473, 0.657), 128), 'oxgas', loxPB, 2, { scale: 0.05, speed: 1.3, intensity: 2.4 })
    {
      const ig = pipe(bentPath([[0.36, 0.63, -0.03], [0.3, 0.6, -0.03], [0.235, 0.59, -0.02]], 0.02), { r: 0.013, ri: 0.007, tubular: 24, radial: 12 })
      add(ig, M.machined, loxPB)
      const body = new THREE.CylinderGeometry(0.026, 0.026, 0.08, 20)
      body.rotateZ(Math.PI / 2)
      body.translate(0.39, 0.635, -0.03)
      add(body, M.gold, loxPB)
    }
    bolts(32, 0.232, 0.69, 0.008, loxPB, false, 0.05)

    const loxPump = part('loxPump', [0, -0.48, 0])
    // housing split around the impeller discharge slot
    add(revolve(wall(() => 0.13, () => 0.152, 0.69, 0.76), 128), M.printed, loxPump)
    add(revolve(wall(() => 0.13, () => 0.152, 0.8, 0.9), 128), M.printed, loxPump)
    {
      const vc = new SpiralCurve(0.776, 0.15, 0.02, 0.1, -Math.PI / 2 + 0.25, 0.93, 0.26, new THREE.Vector3(0, -1, 0.15), 1)
      const v = volute(vc, 0.016, 220, 36)
      add(v.shell, M.cast, loxPump)
      fluid(v.fluid, 'lox', loxPump, 0, { scale: 0.08, speed: 1.6, gas: false })
      const ep = vc.exitPoint(), et = vc.exitTangent()
      add(flangeAt(ep, et, 0.092, 0.132, 0.022), M.machined, loxPump)
      inst(boltGeo(1, 1.1), M.dark, boltCircle(ep.clone().addScaledVector(et, 0.011), et, 0.116, 10, 0.0075), loxPump)
      this.anchors.loxDischarge = ep
      this.anchors.loxDischargeDir = et
    }
    fluid(revolve([[0.036, 0.742], [0.128, 0.742], [0.128, 0.762], [0.15, 0.764], [0.162, 0.776], [0.15, 0.788], [0.128, 0.79], [0.128, 0.82], [0.036, 0.84]], 128), 'lox', loxPump, 4, { scale: 0.05, speed: 2.5, gas: false })
    add(revolve(ringProfile(0.13, 0.2, 0.9, 0.922, 0.004), 128), M.machined, loxPump)

    const loxInlet = part('loxInlet', [0, -0.26, 0])
    add(revolve([[0.1, 0.9], [0.13, 0.905], [0.122, 0.93], [0.122, 1.045], [0.172, 1.045], [0.172, 1.075], [0.1, 1.075]], 96), M.machined, loxInlet)
    fluid(revolve([[0, 0.86], [0.098, 0.86], [0.098, 1.1], [0, 1.1]], 96), 'lox', loxInlet, 2, { scale: 0.07, speed: 1.2, gas: false })
    bolts(12, 0.152, 1.075, 0.008, loxInlet, false, 0.1)

    const loxRotor = new THREE.Group()
    loxRotor.name = 'loxRotor'
    {
      add(revolve(ringProfile(0.0, 0.032, 0.36, 0.99, 0.004), 48), M.rotor, loxRotor)
      add(revolve([[0.03, 0.37], [0.15, 0.376], [0.156, 0.385], [0.15, 0.395], [0.03, 0.4]], 128), M.rotor, loxRotor)
      const bg = new THREE.BoxGeometry(0.036, 0.028, 0.005)
      const mats = ringMatrices(60, 0.172, 0.386, 0)
      mats.forEach((m) => m.multiply(new THREE.Matrix4().makeRotationX(35 * D)))
      inst(bg, M.rotor, mats, loxRotor)
      add(revolve([[0.03, 0.744], [0.124, 0.748], [0.126, 0.756], [0.07, 0.8], [0.036, 0.83]], 128), M.rotor, loxRotor)
      for (let i = 0; i < 10; i++) add(impellerBlade(0.045, 0.124, 0.826, 0.8, 0.757, 0.79, -1.1, 0.006, (i / 10) * Math.PI * 2), M.rotor, loxRotor)
      for (let k = 0; k < 3; k++) add(helixBlade(0.032, 0.094, 0.9, 1.0, 0.5, 0.005, (k / 3) * Math.PI * 2), M.rotor, loxRotor)
    }
    loxPump.add(loxRotor)
    this.rotors.push({ obj: loxRotor, dir: 1, rate: 1 })

    /* ================= Gimbal and thrust mount ================= */
    const gimbal = part('gimbal', [0, 0, 0])
    add(revolve(ringProfile(0.175, 0.255, 0.975, 1.045, 0.008), 128), M.machined, gimbal)
    add(revolve(ringProfile(0.13, 0.285, 1.058, 1.1, 0.006), 96), M.dark, gimbal)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26
      const s = pipe(bentPath([[Math.sin(a) * 0.3, 0.86, Math.cos(a) * 0.3], [Math.sin(a) * 0.235, 1.0, Math.cos(a) * 0.235]], 0.01), { r: 0.018, tubular: 10, radial: 14 })
      add(s, M.machined, gimbal)
    }
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const pin = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 20)
      pin.rotateZ(Math.PI / 2)
      pin.translate(0.285, 1.01, 0)
      pin.rotateY(a)
      add(pin, M.machined, gimbal)
    }

    /* ================= Methane turbopump, beside the axis ================= */
    const X = CH4X
    const ch4 = part('ch4Pump', [0.62, -0.9, 0])
    const ch4g = new THREE.Group()
    ch4g.position.set(X, 0, 0)
    ch4.add(ch4g)
    // preburner, gas flows up into the turbine
    add(revolve(wall(() => 0.108, () => 0.138, -0.33, 0.1), 128), M.printed, ch4g)
    add(revolve([[0, -0.405], [0.07, -0.4], [0.12, -0.378], [0.14, -0.332], [0.108, -0.332], [0.09, -0.345], [0, -0.35]], 96), M.cast, ch4g)
    fluid(revolve(wall(() => 0, () => 0.105, -0.345, 0.1, 16), 96), 'fuelgas', ch4g, 1, { scale: 0.06, speed: 1.3, intensity: 2.2 })
    for (const yb of [-0.24, -0.1, 0.03]) add(revolve(ringProfile(0.136, 0.148, yb - 0.012, yb + 0.012, 0.003), 96), M.machined, ch4g)
    bolts(24, 0.125, 0.1, 0.008, ch4g, false, 0.1)
    // turbine and exhaust collector
    const ctOut = spline2([[0.14, 0.1], [0.152, 0.14], [0.152, 0.26], [0.13, 0.285]], 6)
    add(revolve([...ctOut, [0.118, 0.285], [0.118, 0.1]], 128), M.cast, ch4g)
    for (const h of hollowTorus(0.2, 0.2, 0.062, 0.046)) add(revolve(h, 128), M.cast, ch4g)
    fluid(revolve(circleProfile(0.2, 0.2, 0.044, 20), 128), 'fuelgas', ch4g, 4, { scale: 0.05, speed: 1.8, intensity: 1.3 })
    fluid(revolve(wall(() => 0.028, () => 0.115, 0.104, 0.282, 10), 96), 'fuelgas', ch4g, 4, { scale: 0.05, speed: 2.2, intensity: 1.2 })
    // turbine cover and bearing housing
    add(revolve(ringProfile(0.036, 0.132, 0.282, 0.302, 0.004), 96), M.cast, ch4g)
    add(revolve(wall(() => 0.036, () => 0.07, 0.3, 0.44), 64), M.machined, ch4g)
    // pump and volute
    add(revolve(wall(() => 0.09, () => 0.108, 0.44, 0.528), 96), M.printed, ch4g)
    add(revolve(wall(() => 0.09, () => 0.108, 0.562, 0.64), 96), M.printed, ch4g)
    const ch4vc = new SpiralCurve(0.545, 0.106, 0.014, 0.07, Math.PI / 2 - 0.1 - 0.93 * Math.PI * 2, 0.93, 0.2, new THREE.Vector3(0.25, -1, 0), 1)
    {
      const v = volute(ch4vc, 0.013, 200, 30)
      add(v.shell, M.cast, ch4g)
      fluid(v.fluid, 'ch4', ch4g, 0, { scale: 0.07, speed: 1.6, gas: false })
    }
    fluid(revolve([[0.028, 0.51], [0.088, 0.51], [0.088, 0.53], [0.1, 0.532], [0.11, 0.545], [0.1, 0.558], [0.088, 0.56], [0.088, 0.585], [0.028, 0.6]], 96), 'ch4', ch4g, 4, { scale: 0.04, speed: 2.4, gas: false })
    // inlet
    add(revolve([[0.07, 0.64], [0.095, 0.645], [0.086, 0.67], [0.086, 0.83], [0.13, 0.83], [0.13, 0.86], [0.07, 0.86]], 96), M.machined, ch4g)
    fluid(revolve([[0, 0.6], [0.068, 0.6], [0.068, 0.87], [0, 0.87]], 96), 'ch4', ch4g, 2, { scale: 0.06, speed: 1.2, gas: false })
    bolts(10, 0.112, 0.86, 0.0075, ch4g, false, 0.2)
    {
      const ig = new THREE.CylinderGeometry(0.022, 0.022, 0.07, 18)
      ig.rotateZ(Math.PI / 2)
      ig.translate(0.175, -0.25, -0.03)
      add(ig, M.gold, ch4g)
    }
    const ch4Rotor = new THREE.Group()
    {
      add(revolve(ringProfile(0, 0.024, 0.17, 0.74, 0.003), 32), M.rotor, ch4Rotor)
      add(revolve([[0.022, 0.19], [0.09, 0.195], [0.094, 0.203], [0.09, 0.212], [0.022, 0.218]], 96), M.rotor, ch4Rotor)
      const bg = new THREE.BoxGeometry(0.022, 0.022, 0.004)
      const mats = ringMatrices(40, 0.104, 0.204, 0)
      mats.forEach((m) => m.multiply(new THREE.Matrix4().makeRotationX(-35 * D)))
      inst(bg, M.rotor, mats, ch4Rotor)
      add(revolve([[0.024, 0.512], [0.086, 0.515], [0.088, 0.522], [0.05, 0.56], [0.026, 0.585]], 96), M.rotor, ch4Rotor)
      for (let i = 0; i < 8; i++) add(impellerBlade(0.034, 0.086, 0.58, 0.56, 0.523, 0.55, -1.0, 0.005, (i / 8) * Math.PI * 2), M.rotor, ch4Rotor)
      for (let k = 0; k < 3; k++) add(helixBlade(0.024, 0.066, 0.66, 0.75, 0.55, 0.004, (k / 3) * Math.PI * 2), M.rotor, ch4Rotor)
    }
    ch4g.add(ch4Rotor)
    this.rotors.push({ obj: ch4Rotor, dir: -1, rate: 1.3 })

    // methane rich hot gas duct into the injector ring
    const duct = bentPath([[X - 0.16, 0.2, 0], [0.42, 0.19, 0], [0.405, 0.1, 0], [0.37, 0.058, 0]], 0.05)
    add(pipe(duct, { r: 0.056, ri: 0.043, tubular: 56, radial: 32 }), M.cast, ch4)
    fluid(pipe(duct, { r: 0.041, tubular: 56, radial: 24 }), 'fuelgas', ch4, 0, { scale: 0.05, speed: 1.6, intensity: 1.4 })
    add(revolve(circleProfile(0.058, 0, 0.012, 12), 48).rotateZ(Math.PI / 2).translate(0.382, 0.058, 0), M.cast, ch4)

    /* ================= Plumbing ================= */
    const plumb = new THREE.Group()
    plumb.name = 'plumbing'
    this.root.add(plumb)
    this.plumbing.push(plumb)
    const pipeRun = (pts: [number, number, number][], r: number, ri: number, kind: FluidKind | null, bend = 0.06, mat = M.machined, extra: Record<string, unknown> = {}) => {
      const c = bentPath(pts, bend)
      const tub = Math.max(24, Math.round(c.getLength() * 110))
      const mesh = add(pipe(c, { r, ri, tubular: tub, radial: 22 }), mat, plumb)
      if (kind) fluid(pipe(c, { r: ri - 0.001, tubular: tub, radial: 14 }), kind, plumb, 0, { scale: 0.08, speed: 1.4, gas: false, ...extra })
      return mesh
    }
    // regen supply: pump discharge down the outside of the nozzle to the inlet manifold
    {
      const e = ch4vc.exitPoint().add(new THREE.Vector3(X, 0, 0))
      const along: [number, number, number][] = []
      for (const y of [-0.95, -1.25, -1.55]) along.push([RJ(y) + 0.075, y, 0])
      pipeRun([[e.x, e.y, e.z], [e.x + 0.02, e.y - 0.16, e.z * 0.5], [0.93, 0.1, 0], [0.93, -0.3, 0], [0.56, -0.74, 0], ...along, [rM + 0.035, yM + 0.02, 0]], 0.044, 0.032, 'ch4', 0.12, M.cast)
      add(flangeAt(e, new THREE.Vector3(0.25, -1, 0), 0.044, 0.07, 0.018), M.machined, plumb)
      // clamps holding the line to the nozzle
      for (const y of [-1.1, -1.45]) {
        const r = RJ(y)
        add(revolve(ringProfile(r - 0.002, r + 0.012, y - 0.012, y + 0.012, 0.003), 160), M.dark, plumb)
        const strut = new THREE.BoxGeometry(0.07, 0.018, 0.03)
        strut.translate(r + 0.04, y, 0)
        add(strut, M.dark, plumb)
      }
    }
    // coolant return: top manifold to the methane preburner
    pipeRun([[rO + 0.03, yO - 0.01, 0], [0.47, -0.45, 0], [X, -0.46, 0], [X, -0.405, 0]], 0.034, 0.025, 'ch4', 0.06, M.machined)
    // cross feeds behind the section plane
    pipeRun([[0.3, 0.72, -0.14], [0.36, 0.72, -0.26], [0.5, 0.2, -0.26], [0.56, -0.36, -0.14], [X - 0.02, -0.38, -0.05]], 0.016, 0.01, 'lox', 0.06)
    pipeRun([[X + 0.14, 0.44, -0.1], [0.48, 0.5, -0.26], [0.3, 0.56, -0.26], [0.24, 0.58, -0.1]], 0.016, 0.01, 'ch4', 0.06)
    // main fuel valve on the regen supply
    {
      const vb = new THREE.SphereGeometry(0.062, 32, 20)
      vb.translate(0.95, 0.3, 0)
      add(vb, M.cast, plumb)
      const act = new THREE.BoxGeometry(0.09, 0.11, 0.08)
      act.translate(0.95, 0.3, -0.1)
      add(act, M.dark, plumb)
      const cyl = new THREE.CylinderGeometry(0.036, 0.036, 0.14, 20)
      cyl.rotateX(Math.PI / 2)
      cyl.translate(0.95, 0.3, -0.2)
      add(cyl, M.dark, plumb)
    }
    // sensors (pressure transducers) with gold connectors
    const sensor = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      const g = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12)
      g.translate(0, 0.025, 0)
      const c = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12)
      c.translate(0, 0.06, 0)
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz).normalize())
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1))
      add(g.applyMatrix4(m), M.machined, plumb)
      add(c.applyMatrix4(m), M.gold, plumb)
    }
    sensor(0.0, 0.2, -0.33, 0, 0.2, -1)
    sensor(-0.25, 0.42, -0.2, -1, 0.1, -0.6)
    sensor(-0.2, -0.2, -0.28, -0.6, 0, -1)
    sensor(X + 0.1, 0.0, -0.1, 1, 0, -0.6)
    sensor(-0.3, 0.78, -0.1, -1, 0.2, -0.3)
    // engine controller and harness (on the far side)
    {
      const box = new THREE.BoxGeometry(0.2, 0.24, 0.07)
      box.translate(-0.36, 0.3, -0.26)
      add(box, M.dark, plumb)
      const h1 = bentPath([[-0.36, 0.18, -0.26], [-0.3, 0.02, -0.3], [-0.22, -0.12, -0.3]], 0.05)
      add(pipe(h1, { r: 0.01, tubular: 40, radial: 10 }), M.dark, plumb)
      const h2 = bentPath([[-0.3, 0.42, -0.24], [-0.22, 0.6, -0.22], [-0.1, 0.66, -0.2]], 0.04)
      add(pipe(h2, { r: 0.009, tubular: 30, radial: 10 }), M.dark, plumb)
    }

    // oxygen volute outlet into the preburner
    {
      const ep = this.anchors.loxDischarge, et = this.anchors.loxDischargeDir
      const a = Math.atan2(ep.x, ep.z)
      const tgt = new THREE.Vector3(Math.sin(a) * 0.255, 0.625, Math.cos(a) * 0.255)
      const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
      const c = new THREE.CatmullRomCurve3([
        ep.clone(), ep.clone().addScaledVector(et, 0.05), tgt.clone().addScaledVector(out, 0.07).add(new THREE.Vector3(0, 0.03, 0)), tgt.clone().addScaledVector(out, -0.005),
      ])
      add(pipe(c, { r: 0.09, ri: 0.074, tubular: 40, radial: 28, up: new THREE.Vector3(0, 1, 0) }), M.cast, plumb)
      fluid(pipe(c, { r: 0.072, tubular: 40, radial: 18, up: new THREE.Vector3(0, 1, 0) }), 'lox', plumb, 0, { scale: 0.08, speed: 1.4, gas: false })
    }
    // front side detail: sensor bosses on the chamber, harness, purge line, actuator lug
    const cable = (pts: [number, number, number][], r = 0.008, mat = M.dark) => add(pipe(bentPath(pts, 0.05), { r, tubular: Math.max(20, Math.round(bentPath(pts, 0.05).getLength() * 120)), radial: 10 }), mat, plumb)
    for (const [yy, aa] of [[-0.18, 0.25], [-0.26, 0.05], [-0.12, -0.12]] as [number, number][]) {
      const r = rAt(spline2([[0.34, -0.07], [0.322, -0.15], [0.282, -0.28], [0.236, GEO.yT + 0.03]], 10), yy)
      const n = new THREE.Vector3(Math.sin(aa), 0.15, Math.cos(aa)).normalize()
      sensor(Math.sin(aa) * r, yy, Math.cos(aa) * r, n.x, n.y, n.z)
    }
    cable([[-0.2, 0.62, 0.2], [-0.05, 0.5, 0.28], [0.02, 0.2, 0.37], [0.05, -0.02, 0.39], [0.06, -0.12, 0.36], [0.07, -0.16, 0.33]], 0.009)
    cable([[-0.22, 0.6, 0.18], [-0.08, 0.46, 0.27], [-0.02, 0.18, 0.37], [-0.03, -0.05, 0.385], [-0.04, -0.2, 0.33], [-0.02, -0.25, 0.31]], 0.0075)
    cable([[0.25, 0.1, 0.27], [0.29, 0.05, 0.25], [0.33, 0.0, 0.2]], 0.006, M.machined)
    cable([[-0.26, 0.52, 0.12], [-0.27, 0.32, 0.18], [-0.24, 0.16, 0.26], [-0.17, 0.12, 0.32]], 0.006, M.machined)
    for (const [cx, cy, cz] of [[0.02, 0.2, 0.372], [0.05, -0.02, 0.386]] as [number, number, number][]) {
      const cl = new THREE.TorusGeometry(0.014, 0.004, 8, 16)
      cl.rotateX(Math.PI / 2)
      cl.translate(cx, cy, cz)
      add(cl, M.machined, plumb)
    }
    {
      // thrust vector actuator lug on the dome
      const lug = new THREE.BoxGeometry(0.07, 0.09, 0.05)
      lug.translate(0, 0.2, 0.355)
      add(lug, M.machined, plumb)
      const pin = new THREE.CylinderGeometry(0.018, 0.018, 0.1, 18)
      pin.rotateZ(Math.PI / 2)
      pin.translate(0, 0.21, 0.37)
      add(pin, M.dark, plumb)
    }
    // methane preburner igniter cable
    cable([[X + 0.175, -0.25, -0.03], [X + 0.24, -0.2, 0.02], [X + 0.2, 0.0, 0.12], [X + 0.12, 0.18, 0.18], [0.36, 0.34, 0.2], [0.15, 0.5, 0.26]], 0.007)

    addDetails({
      cut, M, plumb, yT: GEO.yT, X,
      part: (n) => this.parts.find((p) => p.name === n)!.group,
      loxOutlet: { p: this.anchors.loxDischarge, t: this.anchors.loxDischargeDir },
    })

    Object.assign(this.anchors, {
      loxInlet: new THREE.Vector3(0, 1.05, 0.14),
      loxPump: new THREE.Vector3(0, 0.78, 0.33),
      oxPreburner: new THREE.Vector3(0, 0.56, 0.25),
      loxTurbine: new THREE.Vector3(0, 0.39, 0.29),
      injector: new THREE.Vector3(0, 0.04, 0.3),
      chamber: new THREE.Vector3(0, -0.13, 0.22),
      throat: new THREE.Vector3(0, GEO.yT, GEO.Rt + 0.06),
      nozzle: new THREE.Vector3(0, -1.45, 0.55),
      cooling: new THREE.Vector3(0, -1.15, 0.5),
      ch4Pump: new THREE.Vector3(X, 0.545, 0.2),
      fuelPreburner: new THREE.Vector3(X, -0.1, 0.13),
      ch4Turbine: new THREE.Vector3(X, 0.2, 0.2),
      duct: new THREE.Vector3(0.41, 0.12, 0.06),
      gimbal: new THREE.Vector3(0, 1.02, 0.28),
      exit: new THREE.Vector3(0, GEO.yE, GEO.Re),
    })
    void rAt
  }

  /** Explode amount 0..1, rotor speed factor, time step. */
  update(dt: number, explode: number, spin: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.home).addScaledVector(p.explode, e)
    for (const pl of this.plumbing) pl.visible = e < 0.02
    for (const r of this.rotors) r.obj.rotation.y += dt * spin * r.dir * r.rate * 9
  }
}
