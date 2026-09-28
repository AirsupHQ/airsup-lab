import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf } from '../core/materials'
import { revolve, pipe } from '../core/geometry'
import { CutState } from '../core/cut'

/**
 * What is under the bodywork of the 2026 car, laid out after public cutaways:
 * a 1.6 litre 90 degree V6 (80 mm bore, 53 mm stroke) with its crank, rods and
 * pistons, twin overhead cams, direct injectors and coils, intake trumpets in
 * a plenum, 3 into 1 exhausts into a single turbo with its wastegate, the
 * 350 kW electric motor geared to the crank nose, the battery under the fuel
 * cell with its control electronics, an oil tank, an 8 speed gearbox with the
 * differential, hydraulics, brake lines, coolant hoses, and the low and high
 * voltage looms. Casings turn to glass in the cutaway so the moving parts show.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** the V6: crank axis along x */
export const V6 = {
  yc: 0.2,
  x0: -0.83, // first crank throw
  pitch: 0.118, // between throws
  offset: 0.02, // right bank rods sit beside the left on each pin
  r: 0.0265, // half the 53 mm stroke
  L: 0.105, // connecting rod
  bore: 0.08,
  bank: Math.PI / 4, // each bank 45 degrees off vertical
}

interface Ctx {
  add: (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D) => THREE.Mesh
  pu: THREE.Group
  cut: CutState
  M: Record<string, THREE.MeshStandardMaterial>
  anchors: Record<string, [THREE.Object3D, THREE.Vector3]>
}

function ghostMaterial(cut: CutState) {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
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
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      varying vec3 vN;
      varying vec3 vV;
      uniform vec3 uColor;
      void main() {
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uColor * (0.05 + 0.9 * pow(f, 2.5)), 1.0);
      }`,
    uniforms: { uColor: { value: new THREE.Color(0.5, 0.75, 1.0) } },
    clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
  m.clippingPlanes = cut.planes
  return m
}

export class F1Internals {
  readonly crank = new THREE.Group()
  readonly pistons: { mesh: THREE.Object3D; rod: THREE.Mesh; bank: number; i: number }[] = []
  readonly cams: THREE.Mesh[] = []
  readonly turbo = new THREE.Group()
  readonly gears: THREE.Mesh[] = []
  readonly casings: THREE.Mesh[] = []
  readonly ghost: THREE.ShaderMaterial
  private ghosted = false
  private M: Record<string, THREE.MeshStandardMaterial>

  constructor(ctx: Ctx) {
    const { add, pu, cut, anchors } = ctx
    this.ghost = ghostMaterial(cut)
    const M: Record<string, THREE.MeshStandardMaterial> = (this.M = {
      ...ctx.M,
      steel: surf({ color: 0xb8bcc2, metalness: 1, roughness: 0.25, detail: 10, anisotropy: 0.5, cut, capColor: 0x8a8e94, name: 'pu-steel' }),
      forged: surf({ color: 0x9aa0a8, metalness: 1, roughness: 0.3, detail: 12, cut, capColor: 0x7a7f86, name: 'pu-forged' }),
      block: surf({ color: 0x8a8f95, metalness: 0.9, roughness: 0.45, detail: 10, colorVar: 0.06, cut, capColor: 0x55595f, name: 'pu-block' }),
      cover: surf({ color: 0x1d1f23, metalness: 0.4, roughness: 0.35, clearcoat: 0.6, detail: 4, cut, capColor: 0x2a2c30, name: 'pu-cover' }),
      red: surf({ color: 0xc8261e, metalness: 0.2, roughness: 0.3, clearcoat: 0.8, cut, capColor: 0xc8261e, name: 'pu-red' }),
      hose: surf({ color: 0x1a1b1e, metalness: 0.1, roughness: 0.6, detail: 30, cut, capColor: 0x1a1b1e, name: 'pu-hose' }),
      braid: surf({ color: 0x9ea3aa, metalness: 1, roughness: 0.45, detail: 120, bump: 0.0006, cut, capColor: 0x9ea3aa, name: 'pu-braid' }),
      loom: surf({ color: 0x121315, metalness: 0.1, roughness: 0.7, detail: 60, bump: 0.0004, cut, capColor: 0x121315, name: 'pu-loom' }),
      yellow: surf({ color: 0xe0b020, metalness: 0.2, roughness: 0.4, cut, capColor: 0xe0b020, name: 'pu-fuel' }),
      cellTop: surf({ color: 0x3a8fd8, metalness: 0.3, roughness: 0.4, cut, capColor: 0x3a8fd8, name: 'pu-cell' }),
      bladder: surf({ color: 0x3a3f46, metalness: 0.1, roughness: 0.75, detail: 8, cut, capColor: 0x2a2d31, name: 'pu-bladder' }),
    })
    const casing = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = pu) => {
      const mesh = add(g, m, p)
      mesh.userData.skin = m
      this.casings.push(mesh)
      return mesh
    }
    const tube = (pts: THREE.Vector3[], r: number, m: THREE.Material, closed = false, tub = 60) =>
      add(pipe(new THREE.CatmullRomCurve3(pts, closed), { r, tubular: tub, radial: 10 }), m, pu)
    const clips = (pts: THREE.Vector3[], r: number, m: THREE.Material, every = 6) => {
      const c = new THREE.CatmullRomCurve3(pts)
      const n = Math.max(2, Math.round(c.getLength() / 0.08))
      for (let i = 1; i < n; i += every > 0 ? Math.max(1, Math.round(n / every)) : 1) {
        const u = i / n
        const p = c.getPointAt(u), t = c.getTangentAt(u)
        const cl = add(new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.012, 12), m, pu)
        cl.position.copy(p)
        cl.quaternion.setFromUnitVectors(V(0, 1, 0), t)
      }
    }
    const P = V6
    const xs = [0, 1, 2].map((i) => P.x0 - i * P.pitch)
    const axis = (b: number) => V(0, Math.cos(P.bank), b * Math.sin(P.bank))

    /* ---------------- V6: crankcase, banks, heads, cam covers ---------------- */
    casing(new RoundedBoxGeometry(0.44, 0.15, 0.24, 3, 0.03), M.block).position.set(-0.96, P.yc - 0.02, 0)
    // sump and scavenge pumps under the crank
    casing(new RoundedBoxGeometry(0.4, 0.05, 0.18, 2, 0.015), M.block).position.set(-0.96, P.yc - 0.1, 0)
    for (const b of [-1, 1]) {
      const u = axis(b)
      const bankG = new RoundedBoxGeometry(0.4, 0.12, 0.1, 3, 0.02)
      const bank = casing(bankG, M.block)
      bank.position.copy(V(-0.96, P.yc, 0).addScaledVector(u, 0.125))
      bank.rotation.x = -b * P.bank
      const head = casing(new RoundedBoxGeometry(0.42, 0.06, 0.12, 3, 0.02), M.block)
      head.position.copy(V(-0.96, P.yc, 0).addScaledVector(u, 0.215))
      head.rotation.x = -b * P.bank
      const cover = add(new RoundedBoxGeometry(0.4, 0.035, 0.11, 3, 0.015), M.cover, pu)
      cover.position.copy(V(-0.96, P.yc, 0).addScaledVector(u, 0.262))
      cover.rotation.x = -b * P.bank
      this.casings.push(cover)
      cover.userData.skin = M.cover
      // two camshafts per bank, turning at half engine speed
      const side = V(0, -Math.sin(P.bank) * b, Math.cos(P.bank)).normalize()
      for (const s of [-1, 1]) {
        const cam = add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 12).rotateZ(Math.PI / 2), M.steel, pu)
        cam.position.copy(V(-0.96, P.yc, 0).addScaledVector(u, 0.24).addScaledVector(side, s * 0.028))
        this.cams.push(cam)
        for (const x of xs) for (const dx of [-0.018, 0.018]) {
          const lobe = add(new THREE.CylinderGeometry(0.017, 0.017, 0.01, 12).rotateZ(Math.PI / 2), M.steel, pu)
          lobe.position.copy(cam.position).setX(x + dx + (b > 0 ? P.offset : 0))
          lobe.scale.set(1, 1, 1)
        }
      }
      for (const x of xs) {
        const xb = x + (b > 0 ? P.offset : 0)
        // cylinder liner
        const liner = casing(revolve([[P.bore / 2, 0.06], [P.bore / 2 + 0.004, 0.06], [P.bore / 2 + 0.004, 0.2], [P.bore / 2, 0.2]], 32), M.block)
        liner.position.set(xb, P.yc, 0)
        liner.quaternion.setFromUnitVectors(V(0, 1, 0), u)
        // four valves: stems and heads, two intake on the V side, two exhaust outside
        for (const s of [-1, 1]) for (const dx of [-0.017, 0.017]) {
          const vp = V(xb + dx, P.yc, 0).addScaledVector(u, 0.19).addScaledVector(side, s * 0.018 * -b)
          const stem = add(new THREE.CylinderGeometry(0.0025, 0.0025, 0.05, 8), M.steel, pu)
          stem.position.copy(vp).addScaledVector(u, 0.025)
          stem.quaternion.setFromUnitVectors(V(0, 1, 0), u)
          const vh = add(new THREE.CylinderGeometry(0.013, 0.004, 0.004, 16), M.steel, pu)
          vh.position.copy(vp)
          vh.quaternion.setFromUnitVectors(V(0, 1, 0), u)
        }
        // injector (gold) and ignition coil (black) on top of each cylinder
        const inj = add(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10), M.gold, pu)
        inj.position.copy(V(xb, P.yc, 0).addScaledVector(u, 0.24).addScaledVector(side, 0.03 * b))
        inj.quaternion.setFromUnitVectors(V(0, 1, 0), u)
        const coil = add(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12), M.cover, pu)
        coil.position.copy(V(xb, P.yc, 0).addScaledVector(u, 0.29))
        coil.quaternion.setFromUnitVectors(V(0, 1, 0), u)
        // pistons and rods, placed every frame from the crank angle
        const piston = new THREE.Group()
        pu.add(piston)
        add(revolve([[0, -0.02], [P.bore / 2 - 0.001, -0.02], [P.bore / 2 - 0.001, 0.018], [P.bore / 2 - 0.004, 0.022], [0, 0.024]], 32), M.forged, piston)
        for (const k of [0.008, 0.013]) add(new THREE.TorusGeometry(P.bore / 2 - 0.0005, 0.0012, 6, 32).rotateX(Math.PI / 2).translate(0, k, 0), M.steel, piston)
        const rod = add(new THREE.CylinderGeometry(0.008, 0.012, 1, 12), M.forged, pu)
        this.pistons.push({ mesh: piston, rod, bank: b, i: xs.indexOf(x) })
      }
      // exhaust: three primaries on the outer side of each bank into a collector, then to the turbo
      const outer = V(0, -Math.sin(P.bank), -Math.cos(P.bank) * 0).set(0, 0, b).normalize()
      const col = V(-1.2, P.yc + 0.13, b * 0.2)
      for (const x of xs) {
        const port = V(x + (b > 0 ? P.offset : 0), P.yc, 0).addScaledVector(u, 0.2).addScaledVector(outer, 0.04)
        tube([port, port.clone().addScaledVector(outer, 0.05).add(V(0, -0.04, 0)), V((port.x + col.x) / 2, P.yc + 0.08, b * 0.22), col], 0.016, M.hot)
      }
      tube([col, V(-1.28, P.yc + 0.16, b * 0.14), V(-1.33, P.yc + 0.19, b * 0.04)], 0.024, M.hot)
    }
    anchors.pistons = [pu, V(-0.96, P.yc + 0.14, -0.14)]
    anchors.engine = [pu, V(-0.96, P.yc + 0.3, -0.1)]

    /* ---------------- crankshaft ---------------- */
    this.crank.position.set(0, P.yc, 0)
    pu.add(this.crank)
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.46, 20).rotateZ(Math.PI / 2).translate(-0.96, 0, 0), M.steel, this.crank)
    xs.forEach((x, i) => {
      const a = (i * 2 * Math.PI) / 3
      const pin = add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 16).rotateZ(Math.PI / 2), M.steel, this.crank)
      pin.position.set(x + P.offset / 2, Math.cos(a) * P.r, Math.sin(a) * P.r)
      for (const dx of [-0.032, 0.032]) {
        const web = add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.steel, this.crank)
        web.position.set(x + P.offset / 2 + dx, 0, 0)
        web.rotation.x = -a + Math.PI / 2
      }
    })

    /* ---------------- intake: trumpets in a carbon plenum fed by the compressor ---------------- */
    const plenum = casing(new RoundedBoxGeometry(0.42, 0.1, 0.12, 3, 0.03), M.carbon)
    plenum.position.set(-0.96, P.yc + 0.3, 0)
    for (const b of [-1, 1]) for (const x of xs) {
      const t = add(revolve([[0.018, 0], [0.021, 0], [0.024, 0.05], [0.036, 0.075], [0.032, 0.078], [0.02, 0.05], [0.017, 0]], 24), M.alu, pu)
      t.position.copy(V(x + (b > 0 ? P.offset : 0), P.yc, 0).addScaledVector(axis(b), 0.2).add(V(0, 0.0, -b * 0.06)))
    }
    anchors.intake = [pu, V(-0.96, P.yc + 0.36, 0.06)]

    /* ---------------- turbo: turbine and compressor on one shaft behind the engine ---------------- */
    this.turbo.position.set(-1.36, P.yc + 0.2, 0)
    pu.add(this.turbo)
    const wheel = (r: number, n: number, m: THREE.Material) => {
      const g = new THREE.Group()
      g.add(new THREE.Mesh(revolve([[0, -0.02], [r * 0.4, -0.02], [r * 0.95, 0.0], [r * 0.3, 0.025], [0, 0.025]], 24).rotateZ(Math.PI / 2), m))
      for (let k = 0; k < n; k++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 0.9, 0.0025), m)
        const a = (k / n) * Math.PI * 2
        bl.position.set(0, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5)
        bl.rotation.x = -a
        bl.rotation.y = 0.5
        g.add(bl)
      }
      g.children.forEach((c) => { (c as THREE.Mesh).castShadow = true })
      return g
    }
    const turbine = wheel(0.045, 11, M.hot)
    turbine.position.x = -0.02
    const compressor = wheel(0.055, 12, M.alu)
    compressor.position.x = 0.1
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 12).rotateZ(Math.PI / 2), M.steel)
    shaft.position.x = 0.04
    this.turbo.add(turbine, compressor, shaft)
    casing(revolve([[0.03, -0.05], [0.07, -0.05], [0.085, -0.02], [0.08, 0.03], [0.05, 0.05], [0.03, 0.05]], 32).rotateZ(Math.PI / 2), M.hot).position.set(-1.38, P.yc + 0.2, 0)
    casing(revolve([[0.03, -0.04], [0.08, -0.04], [0.095, 0.0], [0.085, 0.04], [0.035, 0.05]], 32).rotateZ(Math.PI / 2), M.alu).position.set(-1.26, P.yc + 0.2, 0)
    // wastegate and tailpipe
    tube([V(-1.43, P.yc + 0.2, 0), V(-1.7, P.yc + 0.27, 0), V(-2.2, P.yc + 0.3, 0)], 0.036, M.hot)
    tube([V(-1.4, P.yc + 0.26, 0.03), V(-1.6, P.yc + 0.36, 0.05), V(-2.15, P.yc + 0.4, 0.05)], 0.014, M.hot)
    // charge air: compressor to intercooler in the left sidepod, back to the plenum
    tube([V(-1.2, P.yc + 0.24, -0.02), V(-1.0, P.yc + 0.34, -0.22), V(-0.4, P.yc + 0.2, -0.36), V(-0.2, P.yc + 0.2, -0.38)], 0.026, M.alu)
    const ic = add(new THREE.BoxGeometry(0.32, 0.16, 0.05), M.rad, pu)
    ic.position.set(-0.06, 0.37, -0.36)
    ic.rotation.y = -0.2
    tube([V(-0.08, 0.3, -0.3), V(-0.4, 0.42, -0.2), V(-0.8, P.yc + 0.34, -0.04)], 0.024, M.alu)
    anchors.turbo = [pu, V(-1.33, P.yc + 0.3, -0.06)]
    anchors.intercooler = [pu, V(-0.06, 0.46, -0.36)]

    /* ---------------- electric motor on the crank nose ---------------- */
    const mgu = casing(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 32).rotateZ(Math.PI / 2), M.ti)
    mgu.position.set(-0.68, P.yc + 0.02, -0.12)
    // stator windings and rotor inside
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 24, 1, true).rotateZ(Math.PI / 2), surf({ color: 0xc27a3e, metalness: 1, roughness: 0.34, detail: 40, cut, capColor: 0xc27a3e, side: THREE.DoubleSide, name: 'pu-copper' }), pu).position.copy(mgu.position)
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 20).rotateZ(Math.PI / 2), M.steel, pu).position.copy(mgu.position)
    // gear drive to the crank
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 32).rotateZ(Math.PI / 2), M.steel, pu).position.set(-0.77, P.yc - 0.04, -0.08)
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24).rotateZ(Math.PI / 2), M.steel, pu).position.set(-0.77, P.yc, 0)
    anchors.mguk = [pu, V(-0.68, P.yc + 0.1, -0.14)]

    /* ---------------- fuel cell, pumps, oil tank ---------------- */
    const cell = casing(new RoundedBoxGeometry(0.32, 0.4, 0.46, 4, 0.06), M.bladder)
    cell.position.set(-0.53, 0.37, 0)
    for (const z of [-0.12, 0, 0.12]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16), M.alu, pu).position.set(-0.53, 0.22, z)
    tube([V(-0.53, 0.28, 0.12), V(-0.6, 0.55, 0.16), V(-0.72, 0.52, 0.12), V(-0.8, P.yc + 0.26, 0.08)], 0.006, M.yellow)
    // high pressure fuel rail along each head
    for (const b of [-1, 1]) tube([V(-0.8, P.yc, 0).addScaledVector(axis(b), 0.25).add(V(0, 0, b * 0.02)), V(-1.14, P.yc, 0).addScaledVector(axis(b), 0.25).add(V(0, 0, b * 0.02))], 0.005, M.steel)
    const oil = casing(new RoundedBoxGeometry(0.06, 0.26, 0.3, 3, 0.02), M.alu)
    oil.position.set(-0.72, 0.4, 0)
    anchors.fuel = [pu, V(-0.53, 0.6, -0.1)]
    anchors.oil = [pu, V(-0.72, 0.55, -0.12)]

    /* ---------------- battery modules and electronics ---------------- */
    const bat = casing(new RoundedBoxGeometry(0.44, 0.1, 0.42, 3, 0.02), M.battery)
    bat.position.set(-0.45, 0.115, 0)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const mod = add(new RoundedBoxGeometry(0.09, 0.07, 0.09, 2, 0.008), M.battery, pu)
      mod.position.set(-0.6 + i * 0.1, 0.113, -0.15 + j * 0.1)
      add(new THREE.BoxGeometry(0.085, 0.004, 0.085), M.cellTop, pu).position.set(-0.6 + i * 0.1, 0.15, -0.15 + j * 0.1)
    }
    const ce = add(new RoundedBoxGeometry(0.14, 0.08, 0.2, 2, 0.015), M.ti, pu)
    ce.position.set(-0.25, 0.14, -0.12)
    const ecu = add(new RoundedBoxGeometry(0.16, 0.05, 0.12, 2, 0.01), M.cover, pu)
    ecu.position.set(0.25, 0.26, -0.32)
    for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.01, 0.01, 0.02, 12).rotateX(Math.PI / 2), M.gold, pu).position.set(0.2 + k * 0.03, 0.27, -0.26)
    anchors.battery = [pu, V(-0.45, 0.16, -0.18)]
    anchors.ce = [pu, V(-0.25, 0.2, -0.14)]
    anchors.ecu = [pu, V(0.25, 0.3, -0.34)]
    // high voltage: battery to control electronics to the motor
    for (const dz of [-0.012, 0.012]) {
      tube([V(-0.3, 0.12, -0.08 + dz), V(-0.26, 0.12, -0.12 + dz)], 0.009, M.orange, false, 8)
      tube([V(-0.25, 0.16, -0.2 + dz), V(-0.4, 0.2, -0.2 + dz), V(-0.6, 0.18, -0.16 + dz), V(-0.66, P.yc + 0.02, -0.12 + dz)], 0.009, M.orange)
    }

    /* ---------------- gearbox: eight speeds and the differential ---------------- */
    const gbx = casing(new RoundedBoxGeometry(0.5, 0.2, 0.2, 3, 0.04), M.mag)
    gbx.position.set(-1.72, 0.27, 0)
    for (const [y, rs] of [[0.3, [0.028, 0.034, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065]], [0.22, [0.065, 0.06, 0.055, 0.05, 0.045, 0.04, 0.034, 0.028]]] as const) {
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 12).rotateZ(Math.PI / 2), M.steel, pu).position.set(-1.62, y, 0)
      rs.forEach((r, k) => {
        const g = add(new THREE.CylinderGeometry(r, r, 0.018, 40).rotateZ(Math.PI / 2), M.steel, pu)
        g.position.set(-1.45 - k * 0.042, y, 0)
        this.gears.push(g)
      })
    }
    // differential crown on the axle line
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 48), M.steel, pu).position.set(-1.7, 0.355, 0.0)
    anchors.gearbox = [pu, V(-1.7, 0.38, -0.12)]
    // hydraulic shift actuators on the casing, braided lines from the pump on the engine front
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12).rotateZ(Math.PI / 2), M.ti, pu).position.set(-1.6, 0.38, -0.09)
    tube([V(-0.78, P.yc - 0.08, -0.06), V(-1.1, 0.08, -0.12), V(-1.5, 0.12, -0.12), V(-1.6, 0.36, -0.09)], 0.005, M.braid)
    // hydraulic power steering line to the rack in the nose
    tube([V(-0.78, P.yc - 0.07, -0.08), V(-0.3, 0.1, -0.24), V(0.8, 0.14, -0.18), V(1.6, 0.36, -0.12)], 0.005, M.braid, false, 120)
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 16).rotateX(Math.PI / 2), M.ti, pu).position.set(1.68, 0.36, 0)

    /* ---------------- brakes: master cylinders at the pedals, lines to every caliper ---------------- */
    for (const dz of [-0.04, 0.04]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 12).rotateZ(Math.PI / 2), M.alu, pu).position.set(1.2, 0.3, dz)
    for (const s of [-1, 1]) {
      tube([V(1.2, 0.3, s * 0.04), V(1.5, 0.35, s * 0.1), V(1.62, 0.38, s * 0.55), V(1.7, 0.4, s * 0.66)], 0.004, M.braid)
      tube([V(1.2, 0.3, s * 0.04), V(0.6, 0.1, s * 0.2), V(-1.2, 0.1, s * 0.22), V(-1.62, 0.38, s * 0.5), V(-1.7, 0.4, s * 0.6)], 0.004, M.braid, false, 140)
    }
    anchors.brakes = [pu, V(1.2, 0.34, -0.06)]
    // pedals and steering column
    for (const dz of [-0.05, 0.05]) {
      const ped = add(new RoundedBoxGeometry(0.02, 0.12, 0.06, 2, 0.006), M.alu, pu)
      ped.position.set(1.12, 0.3, dz)
      ped.rotation.z = 0.35
    }
    tube([V(0.33, 0.6, 0), V(0.7, 0.54, 0), V(1.55, 0.4, 0)], 0.012, M.steel)
    // fire extinguisher in the chassis
    const ext = add(new THREE.CapsuleGeometry(0.045, 0.2, 6, 20).rotateZ(Math.PI / 2), M.red, pu)
    ext.position.set(0.72, 0.2, 0)

    /* ---------------- inboard front suspension in the nose ---------------- */
    for (const s of [-1, 1]) {
      const rocker = add(new RoundedBoxGeometry(0.06, 0.03, 0.06, 2, 0.01), M.ti, pu)
      rocker.position.set(1.66, 0.5, s * 0.1)
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 14).rotateX(Math.PI / 2), M.gold, pu).position.set(1.55, 0.48, s * 0.06)
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 10).rotateZ(Math.PI / 2), M.steel, pu).position.set(1.4, 0.44, s * 0.08)
    }
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 14).rotateX(Math.PI / 2), M.gold, pu).position.set(1.6, 0.52, 0)
    anchors.suspension = [pu, V(1.62, 0.56, -0.1)]

    /* ---------------- coolant: radiators to the engine ---------------- */
    for (const s of [-1, 1]) {
      tube([V(0.02, 0.32, s * 0.36), V(-0.3, 0.3, s * 0.3), V(-0.7, P.yc + 0.05, s * 0.15), V(-0.82, P.yc + 0.05, s * 0.1)], 0.017, M.hose)
      tube([V(0.02, 0.48, s * 0.42), V(-0.4, 0.5, s * 0.28), V(-1.1, P.yc + 0.2, s * 0.18)], 0.015, M.hose)
    }

    /* ---------------- low voltage looms: ECU to sensors, steering wheel, engine, gearbox, rear light ---------------- */
    const looms: THREE.Vector3[][] = [
      [V(0.25, 0.25, -0.26), V(0.4, 0.3, -0.2), V(0.33, 0.55, -0.08), V(0.33, 0.6, -0.02)],
      [V(0.25, 0.25, -0.26), V(0.8, 0.2, -0.18), V(1.4, 0.32, -0.12), V(2.1, 0.28, -0.05)],
      [V(0.25, 0.25, -0.26), V(-0.2, 0.3, -0.3), V(-0.7, 0.62, -0.18), V(-1.0, P.yc + 0.34, -0.1), V(-1.3, 0.48, -0.08)],
      [V(0.2, 0.24, -0.3), V(-0.4, 0.07, -0.28), V(-1.2, 0.08, -0.16), V(-1.62, 0.2, -0.12), V(-2.35, 0.34, -0.03)],
      [V(0.2, 0.24, -0.3), V(0.1, 0.35, -0.5), V(-0.3, 0.42, -0.52)],
    ]
    for (const pts of looms) {
      tube(pts, 0.007, M.loom, false, 120)
      clips(pts, 0.007, M.orange, 5)
    }
    anchors.looms = [pu, V(0.8, 0.26, -0.2)]
  }

  /** crank angle for the pistons and rods; the turbo and gears just spin. */
  update(crankAng: number, turboAng: number) {
    const P = V6
    this.crank.rotation.x = crankAng
    for (const p of this.pistons) {
      const a = crankAng + (p.i * 2 * Math.PI) / 3
      const x = P.x0 - p.i * P.pitch + (p.bank > 0 ? P.offset : 0)
      const pin = V(x, P.yc + Math.cos(a) * P.r, Math.sin(a) * P.r)
      const u = V(0, Math.cos(P.bank), p.bank * Math.sin(P.bank))
      const rel = pin.clone().sub(V(x, P.yc, 0))
      const along = rel.dot(u)
      const perp = Math.sqrt(Math.max(0, rel.lengthSq() - along * along))
      const s = along + Math.sqrt(P.L * P.L - perp * perp)
      const top = V(x, P.yc, 0).addScaledVector(u, s)
      p.mesh.position.copy(top)
      p.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), u)
      const d = top.clone().sub(pin)
      p.rod.position.copy(pin).addScaledVector(d, 0.5)
      p.rod.scale.set(1, d.length(), 1)
      p.rod.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize())
    }
    for (const c of this.cams) c.rotation.x = crankAng / 2
    this.turbo.rotation.x = turboAng
    this.gears.forEach((g, k) => { g.rotation.x = crankAng * (k < 8 ? 0.6 : -0.6) })
  }

  /** In the cutaway the casings turn to glass. */
  setGhost(on: boolean, cut: CutState) {
    if (on === this.ghosted) return
    this.ghosted = on
    for (const m of this.casings) {
      const skin = m.userData.skin as THREE.Material
      m.geometry.clearGroups()
      m.userData.front = on ? this.ghost : skin
      m.material = on ? this.ghost : skin
    }
    const was = cut.capsOn
    cut.setCaps(!was)
    cut.setCaps(was)
    void this.M
  }
}
