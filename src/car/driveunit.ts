import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import { revolve, ringProfile, pipe, bentPath, P2 } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from '../fusion/plasma'

/**
 * One of the truck's drive units at full size: a permanent magnet motor, the
 * inverter on top of it and a two stage gearbox that ends in the differential.
 *
 * Every axis runs along local z. The cut removes everything in front of the
 * middle of the stator, so the section shows what a motor really is: 54 slots
 * of copper around a rotor with six magnet poles. Each slot glows in the colour
 * of its phase as the three currents rise and fall, and a ring over the teeth
 * shows the north and south poles of the field they make, turning with the rotor.
 */

export const DU = {
  slots: 54,
  poles: 6,
  /** 55/17 × 72/19 */
  ratio: (55 / 17) * (72 / 19),
  cutZ: 0.11,
}

export const DU_EMPH = {
  current: { value: 1 },
  field: { value: 1 },
  gears: { value: 0 },
  hvRate: { value: 1 },
  hv: { value: 0.4 },
}

const PHASE_COLOR = [new THREE.Color(0xff9a3c), new THREE.Color(0x5fd0ff), new THREE.Color(0xb194ff)]

function gearShape(teeth: number, r: number, bore: number) {
  const m = (2 * r) / teeth
  const ra = r + m, rf = r - 1.25 * m
  const s = new THREE.Shape()
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, p = (Math.PI * 2) / teeth
    const pts: [number, number][] = [[rf, a - p * 0.25], [rf, a - p * 0.2], [ra, a - p * 0.1], [ra, a + p * 0.1], [rf, a + p * 0.2], [rf, a + p * 0.25]]
    pts.forEach(([rr, aa], k) => {
      const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr
      if (i === 0 && k === 0) s.moveTo(x, y)
      else s.lineTo(x, y)
    })
  }
  s.closePath()
  if (bore > 0) {
    const h = new THREE.Path()
    h.absarc(0, 0, bore, 0, Math.PI * 2, true)
    s.holes.push(h)
  }
  return s
}

const FIELD_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FIELD_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uAngle;
uniform float uK;
void main() {
  float a = atan(vP.y, vP.x);
  float B = cos(3.0 * (a - uAngle));
  vec3 c = B > 0.0 ? vec3(1.0, 0.28, 0.24) : vec3(0.25, 0.55, 1.0);
  float I = pow(abs(B), 1.6) * uK;
  gl_FragColor = vec4(c * I * 2.2, 1.0);
}
`

export class DriveUnit {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly parts: { group: THREE.Object3D; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly M: Record<string, THREE.MeshStandardMaterial>
  private rotor = new THREE.Group()
  private gearsR: { o: THREE.Object3D; k: number }[] = []
  private slotGlow: THREE.InstancedMesh
  private fieldMat: THREE.ShaderMaterial
  private fieldRing: THREE.Mesh
  private phaseBars: THREE.MeshBasicMaterial[] = []
  private cover: THREE.Object3D
  private hvMat: THREE.ShaderMaterial
  explode = 0

  constructor() {
    this.root.name = 'driveunit'
    this.cut = new CutState(this.root, 0.7, DU.cutZ)
    const cut = this.cut
    const copper = 0xc8793f
    const M = (this.M = {
      housing: surf({ color: 0xa4aab1, metalness: 1, roughness: 0.36, detail: 3, colorVar: 0.01, roughVar: 0.1, cut, capColor: 0xb8bdc3, capMetalness: 0.7, name: 'du-housing' }),
      lam: surf({ color: 0x5f646c, metalness: 0.9, roughness: 0.32, detail: 6, colorVar: 0.02, roughVar: 0.15, cut, capColor: 0x8d939b, capMetalness: 0.8, capRoughness: 0.32, name: 'du-lam' }),
      copper: surf({ color: copper, metalness: 1, roughness: 0.3, detail: 20, cut, capColor: 0xd08a52, capMetalness: 0.95, capRoughness: 0.25, name: 'du-copper' }),
      shaft: surf({ color: 0xc4c8ce, metalness: 1, roughness: 0.22, anisotropy: 0.6, detail: 12, cut, capColor: 0xc9ccd1, name: 'du-shaft' }),
      gear: surf({ color: 0xb4b8be, metalness: 1, roughness: 0.28, detail: 14, anisotropy: 0.35, cut, capColor: 0xc4c8ce, name: 'du-gear' }),
      magN: surf({ color: 0x3a3d42, metalness: 0.8, roughness: 0.35, cut, capColor: 0xe0443a, capMetalness: 0.2, capRoughness: 0.4, name: 'du-magN' }),
      magS: surf({ color: 0x3a3d42, metalness: 0.8, roughness: 0.35, cut, capColor: 0x3a7bff, capMetalness: 0.2, capRoughness: 0.4, name: 'du-magS' }),
      inverter: surf({ color: 0x23272d, metalness: 0.6, roughness: 0.4, detail: 4, clearcoat: 0.3, cut, capColor: 0x8b9097, name: 'du-inv' }),
      board: surf({ color: 0x1d4d3a, metalness: 0.2, roughness: 0.5, detail: 12, cut, capColor: 0x2c6b52, name: 'du-board' }),
      chip: surf({ color: 0x15171a, metalness: 0.4, roughness: 0.3, cut, capColor: 0x3a3d42, name: 'du-chip' }),
      hv: surf({ color: 0xff7a1c, metalness: 0, roughness: 0.5, clearcoat: 0.3, cut, capColor: 0xd9d2c5, name: 'du-hv' }),
      rubber: surf({ color: 0x1a1b1d, metalness: 0, roughness: 0.7, cut, capColor: 0x2a2b2e, name: 'du-rubber' }),
    })
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const part = (explode: [number, number, number], parent: THREE.Object3D = this.root) => {
      const group = new THREE.Group()
      parent.add(group)
      this.parts.push({ group, explode: new THREE.Vector3(...explode) })
      return group
    }
    /** revolve around local z */
    const revZ = (prof: P2[], m: THREE.Material, parent: THREE.Object3D, segs = 96) => {
      const mesh = add(revolve(prof, segs), m, parent)
      mesh.rotation.x = Math.PI / 2
      return mesh
    }
    // after rotation.x = +90° the profile's y runs along local +z
    const rz = (prof: P2[]): P2[] => prof

    /* ---------------- housing ---------------- */
    const housing = part([0, 0, 0])
    const Z0 = -0.005, Z1 = 0.235
    revZ(rz(ringProfile(0.133, 0.148, Z0, Z1, 0.003)), M.housing, housing)
    for (let k = 0; k < 9; k++) {
      const z = Z0 + 0.02 + k * 0.025
      revZ(rz([[0.147, z - 0.004], [0.162, z - 0.002], [0.162, z + 0.002], [0.147, z + 0.004]]), M.housing, housing, 96)
    }
    // mounting feet and bosses
    const standMat = surf({ color: 0x1d2128, metalness: 0.6, roughness: 0.42, detail: 3, name: 'du-stand' })
    for (const s of [-1, 1]) {
      const foot = add(new RoundedBoxGeometry(0.07, 0.05, 0.2, 2, 0.01), M.housing, housing)
      foot.position.set(s * 0.11, -0.145, 0.11)
      // cradle down to the pedestal
      const leg = add(new RoundedBoxGeometry(0.06, 0.23, 0.16, 2, 0.01), standMat, this.root)
      leg.position.set(s * 0.11, -0.285, 0.11)
    }
    {
      const leg = add(new RoundedBoxGeometry(0.08, 0.05, 0.08, 2, 0.01), standMat, this.root)
      leg.position.set(0.118, -0.39, -0.1)
    }
    this.anchors.housing = [housing, new THREE.Vector3(-0.13, 0.08, 0.2)]

    /* ---------------- stator ---------------- */
    const stator = part([0, 0, 0.1])
    const SZ0 = 0.02, SZ1 = 0.2
    {
      const s = new THREE.Shape()
      s.absarc(0, 0, 0.133, 0, Math.PI * 2, false)
      const bore = new THREE.Path()
      bore.absarc(0, 0, 0.0785, 0, Math.PI * 2, true)
      s.holes.push(bore)
      for (let i = 0; i < DU.slots; i++) {
        const a = (i / DU.slots) * Math.PI * 2
        const h = new THREE.Path()
        const r0 = 0.084, r1 = 0.108, w = 0.0038
        const c = Math.cos(a), sn = Math.sin(a)
        const P = (rr: number, t: number): [number, number] => [c * rr - sn * t, sn * rr + c * t]
        const pts = [P(r0, -w), P(r0, w), P(r1, w * 1.25), P(r1, -w * 1.25)]
        h.moveTo(...pts[0])
        for (const p of [pts[3], pts[2], pts[1]]) h.lineTo(...p)
        h.closePath()
        s.holes.push(h)
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: SZ1 - SZ0, bevelEnabled: false, curveSegments: 48 })
      g.translate(0, 0, SZ0)
      add(g, M.lam, stator)
      // copper hairpins in every slot
      const bar = new THREE.BoxGeometry(0.02, 0.0062, SZ1 - SZ0 + 0.03)
      const im = new THREE.InstancedMesh(bar, M.copper, DU.slots)
      const glowG = new THREE.PlaneGeometry(0.021, 0.0066)
      this.slotGlow = new THREE.InstancedMesh(glowG, new THREE.MeshBasicMaterial({ color: 0xffffff }), DU.slots)
      const m = new THREE.Matrix4()
      for (let i = 0; i < DU.slots; i++) {
        const a = (i / DU.slots) * Math.PI * 2
        m.makeRotationZ(a).setPosition(Math.cos(a) * 0.096, Math.sin(a) * 0.096, (SZ0 + SZ1) / 2)
        im.setMatrixAt(i, m)
        m.makeRotationZ(a).setPosition(Math.cos(a) * 0.096, Math.sin(a) * 0.096, DU.cutZ + 0.0008)
        this.slotGlow.setMatrixAt(i, m)
        this.slotGlow.setColorAt(i, new THREE.Color(0, 0, 0))
      }
      im.castShadow = true
      im.receiveShadow = true
      stator.add(im)
      this.slotGlow.layers.set(LAYER_GLOW)
      this.slotGlow.userData.fluid = 'glow'
      this.slotGlow.frustumCulled = false
      stator.add(this.slotGlow)
      // end windings
      for (const [z0, z1] of [[SZ0 - 0.028, SZ0], [SZ1, SZ1 + 0.028]]) {
        revZ(rz([[0.083, z0 + 0.006], [0.088, z0], [0.106, z0], [0.112, z0 + 0.006], [0.112, z1], [0.083, z1]]), M.copper, stator, 108)
      }
      // three phase leads up to the inverter
      for (let p = 0; p < 3; p++) {
        const x = -0.035 + p * 0.035
        const c = bentPath([[x, 0.1, SZ1 + 0.02], [x, 0.1, SZ1 + 0.03], [x, 0.14, SZ1 + 0.03], [x, 0.19, SZ1 + 0.01]], 0.01)
        add(pipe(c, { r: 0.0055, tubular: 30, radial: 8 }), M.copper, stator)
        const gm = new THREE.MeshBasicMaterial({ color: PHASE_COLOR[p].clone() })
        gm.clippingPlanes = cut.planes
        gm.clipIntersection = cut.intersect
        const gmesh = new THREE.Mesh(pipe(c, { r: 0.0068, tubular: 30, radial: 8 }), gm)
        gmesh.layers.set(LAYER_GLOW)
        gmesh.userData.fluid = 'glow'
        stator.add(gmesh)
        this.phaseBars.push(gm)
      }
    }
    this.anchors.stator = [stator, new THREE.Vector3(0.0, 0.123, DU.cutZ)]
    this.anchors.slots = [stator, new THREE.Vector3(-0.1, -0.03, DU.cutZ)]

    /* ---------------- field ring over the teeth ---------------- */
    this.fieldMat = new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: { uAngle: { value: 0 }, uK: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.fieldRing = new THREE.Mesh(new THREE.RingGeometry(0.0788, 0.0835, 144, 1), this.fieldMat)
    this.fieldRing.position.z = DU.cutZ + 0.0009
    this.fieldRing.layers.set(LAYER_GLOW)
    this.fieldRing.userData.fluid = 'glow'
    stator.add(this.fieldRing)

    /* ---------------- rotor ---------------- */
    const rotorPart = part([0, 0, 0.46])
    rotorPart.add(this.rotor)
    {
      const RZ0 = 0.021, RZ1 = 0.199
      const s = new THREE.Shape()
      s.absarc(0, 0, 0.0775, 0, Math.PI * 2, false)
      const bore = new THREE.Path()
      bore.absarc(0, 0, 0.021, 0, Math.PI * 2, true)
      s.holes.push(bore)
      // pockets for the magnets, a V per pole
      const mags: { x: number; y: number; a: number; n: boolean }[] = []
      for (let p = 0; p < DU.poles; p++) {
        const a = (p / DU.poles) * Math.PI * 2
        for (const side of [-1, 1]) {
          const ang = a + side * 0.2
          const cx = Math.cos(ang) * 0.06, cy = Math.sin(ang) * 0.06
          const ori = a + side * 0.9
          mags.push({ x: cx, y: cy, a: ori, n: p % 2 === 0 })
          const h = new THREE.Path()
          const c = Math.cos(ori), sn = Math.sin(ori)
          const hw = 0.0135, ht = 0.0036
          const P = (u: number, v: number): [number, number] => [cx + c * u - sn * v, cy + sn * u + c * v]
          h.moveTo(...P(-hw, -ht))
          h.lineTo(...P(-hw, ht))
          h.lineTo(...P(hw, ht))
          h.lineTo(...P(hw, -ht))
          h.closePath()
          s.holes.push(h)
        }
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: RZ1 - RZ0, bevelEnabled: false, curveSegments: 48 })
      g.translate(0, 0, RZ0)
      add(g, M.lam, this.rotor)
      for (const mg of mags) {
        const b = add(new THREE.BoxGeometry(0.026, 0.0068, RZ1 - RZ0 - 0.004), mg.n ? M.magN : M.magS, this.rotor)
        b.position.set(mg.x, mg.y, (RZ0 + RZ1) / 2)
        b.rotation.z = mg.a
      }
      revZ(rz([[0, -0.16], [0.018, -0.16], [0.021, -0.155], [0.021, 0.3], [0.018, 0.305], [0, 0.305]]), M.shaft, this.rotor, 32)
      // bearings
      for (const z of [-0.012, 0.215]) revZ(rz(ringProfile(0.021, 0.036, z - 0.009, z + 0.009, 0.002)), M.shaft, this.rotor, 40)
    }
    this.anchors.rotor = [rotorPart, new THREE.Vector3(0.04, 0.055, DU.cutZ)]

    /* ---------------- front cover ---------------- */
    const front = part([0, 0, 0.26])
    revZ(rz([[0.036, Z1], [0.148, Z1], [0.148, Z1 + 0.018], [0.12, Z1 + 0.03], [0.05, Z1 + 0.034], [0.036, Z1 + 0.034]]), M.housing, front)

    /* ---------------- inverter ---------------- */
    const inv = part([0, 0.34, 0])
    {
      const b = add(new RoundedBoxGeometry(0.25, 0.1, 0.25, 3, 0.015), M.inverter, inv)
      b.position.set(0, 0.2, 0.11)
      const board = add(new THREE.BoxGeometry(0.2, 0.006, 0.2), M.board, inv)
      board.position.set(0, 0.2, 0.11)
      for (let k = 0; k < 6; k++) {
        const c = add(new THREE.BoxGeometry(0.035, 0.01, 0.03), M.chip, inv)
        c.position.set(-0.06 + (k % 3) * 0.06, 0.208, 0.07 + Math.floor(k / 3) * 0.05)
      }
      const cap = add(new THREE.BoxGeometry(0.16, 0.035, 0.05), M.inverter, inv)
      cap.position.set(0, 0.222, 0.175)
      // HV connector and the cables to the battery
      const con = add(new RoundedBoxGeometry(0.08, 0.05, 0.06, 2, 0.01), M.hv, inv)
      con.position.set(-0.08, 0.265, 0.02)
      this.hvMat = glowLineMaterial(cut, { color: 0x5fd0ff, emph: DU_EMPH.hv, rate: DU_EMPH.hvRate, speed: 1.2, scale: 0.12, base: 0.2 })
      for (const dx of [-0.02, 0.02]) {
        const c = bentPath([[-0.08 + dx, 0.29, 0.02], [-0.08 + dx, 0.33, 0.02], [-0.08 + dx, 0.33, -0.2], [-0.2 + dx, 0.1, -0.35], [-0.34 + dx, -0.37, -0.35]], 0.06)
        add(pipe(c, { r: 0.012, tubular: 80, radial: 10 }), M.hv, inv)
        const gm = new THREE.Mesh(pipe(c, { r: 0.0145, tubular: 80, radial: 8 }), this.hvMat)
        gm.layers.set(LAYER_GLOW)
        gm.userData.fluid = 'glow'
        inv.add(gm)
      }
    }
    this.anchors.inverter = [inv, new THREE.Vector3(0.1, 0.26, 0.2)]

    /* ---------------- gearbox ---------------- */
    const G1 = new THREE.Vector2(Math.cos(-0.7) * 0.118, Math.sin(-0.7) * 0.118)
    const G2 = G1.clone().add(new THREE.Vector2(Math.cos(-1.4) * 0.164, Math.sin(-1.4) * 0.164))
    const gear = (teeth: number, r: number, w: number, z: number, parent: THREE.Object3D, bore = 0.012) => {
      const g = new THREE.ExtrudeGeometry(gearShape(teeth, r, bore), { depth: w, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 12 })
      g.translate(0, 0, z - w / 2)
      return add(g, M.gear, parent)
    }
    const pinionP = part([0, 0, -0.1])
    const pinion = new THREE.Group()
    pinionP.add(pinion)
    gear(17, 0.028, 0.03, -0.06, pinion, 0.019)
    this.gearsR.push({ o: pinion, k: 1 })
    const midP = part([0.05, 0.02, -0.2])
    const mid = new THREE.Group()
    mid.position.set(G1.x, G1.y, 0)
    midP.add(mid)
    gear(55, 0.09, 0.024, -0.06, mid)
    gear(19, 0.034, 0.03, -0.1, mid)
    revZ(rz([[0, -0.13], [0.012, -0.13], [0.012, -0.03], [0, -0.03]]), M.shaft, mid, 24)
    this.gearsR.push({ o: mid, k: -17 / 55 })
    const finP = part([0.08, -0.06, -0.3])
    const fin = new THREE.Group()
    fin.position.set(G2.x, G2.y, 0)
    finP.add(fin)
    gear(72, 0.13, 0.03, -0.1, fin, 0.05)
    // differential carrier and the two half shafts
    revZ(rz([[0.0, -0.13], [0.05, -0.13], [0.058, -0.1], [0.05, -0.07], [0.03, -0.06], [0, -0.06]]), M.housing, fin, 48)
    revZ(rz([[0, -0.42], [0.02, -0.42], [0.02, 0.44], [0, 0.44]]), M.shaft, fin, 24)
    for (const z of [0.44, -0.42]) {
      const boot = revZ(rz([[0, z - 0.05], [0.03, z - 0.05], [0.045, z - 0.03], [0.03, z - 0.01], [0.045, z + 0.01], [0.03, z + 0.03], [0.04, z + 0.05], [0, z + 0.05]]), M.rubber, fin, 24)
      void boot
    }
    this.gearsR.push({ o: fin, k: 1 / DU.ratio })
    this.anchors.gears = [finP, new THREE.Vector3(G2.x + 0.1, G2.y + 0.1, -0.1)]
    this.anchors.diff = [finP, new THREE.Vector3(G2.x, G2.y, 0.44)]

    // gearbox case: side wall around the gear train, and a back cover that lifts away
    {
      const hull = new THREE.Shape()
      const pts: [number, number, number][] = [[0, 0, 0.06], [G1.x, G1.y, 0.11], [G2.x, G2.y, 0.155]]
      // rounded outline around the three centres
      const outline: THREE.Vector2[] = []
      for (let i = 0; i < 180; i++) {
        const a = (i / 180) * Math.PI * 2
        const d = new THREE.Vector2(Math.cos(a), Math.sin(a))
        let best = -Infinity
        for (const [x, y, r] of pts) best = Math.max(best, x * d.x + y * d.y + r)
        outline.push(d.multiplyScalar(best))
      }
      outline.forEach((p, i) => (i ? hull.lineTo(p.x, p.y) : hull.moveTo(p.x, p.y)))
      hull.closePath()
      const inner = new THREE.Path()
      outline.slice().reverse().forEach((p, i) => {
        const q = p.clone().multiplyScalar(1 - 0.012 / p.length())
        if (i) inner.lineTo(q.x, q.y)
        else inner.moveTo(q.x, q.y)
      })
      const wall = new THREE.Shape(hull.getPoints())
      wall.holes.push(inner)
      const wg = new THREE.ExtrudeGeometry(wall, { depth: 0.12, bevelEnabled: false })
      wg.translate(0, 0, -0.13)
      add(wg, M.housing, housing)
      // front plate behind the motor closes the case
      const fp = new THREE.ExtrudeGeometry(hull, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 })
      fp.translate(0, 0, -0.022)
      add(fp, M.housing, housing)
      const cov = part([0, 0, -0.34])
      const cg = new THREE.ExtrudeGeometry(hull, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 })
      cg.translate(0, 0, -0.146)
      add(cg, M.housing, cov)
      this.cover = cov
      this.anchors.cover = [cov, new THREE.Vector3(G1.x, G1.y + 0.1, -0.15)]
    }
  }

  /**
   * angle: rotor angle (rad, already slowed for the eye); torque: +1 motoring, -1 regenerating, 0 coasting;
   * showCover: 0..1 how far the gearbox cover is lifted in the cut view
   */
  update(dt: number, explode: number, angle: number, torque: number, coverOff: number, cutOpen: number) {
    this.explode = explode
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) {
      p.group.position.copy(p.explode).multiplyScalar(e)
    }
    // in the gears view the back cover lifts up and away so the train shows from behind
    this.cover.position.y += coverOff * 0.55 * (1 - e)
    this.cover.position.z -= coverOff * 0.08 * (1 - e)
    this.rotor.rotation.z = angle
    for (const g of this.gearsR) g.o.rotation.z = angle * g.k
    // the stator field leads the rotor by a quarter pole pitch when motoring, lags when braking
    const pp = DU.poles / 2
    const lead = (torque * Math.PI) / 2 / pp
    const fieldAngle = angle + lead
    this.fieldMat.uniforms.uAngle.value = fieldAngle
    const I = Math.abs(torque)
    const cur = DU_EMPH.current.value
    const show = cutOpen > 0.9 && e < 0.05 ? 1 : 0
    this.slotGlow.visible = show > 0
    this.fieldRing.visible = show > 0 && DU_EMPH.field.value > 0.02
    this.fieldMat.uniforms.uK.value = DU_EMPH.field.value
    // slot currents: 60 degree phase belts, U+ W- V+ U- W+ V- around each pole pair
    const belt = [0, 2, 1, 0, 2, 1]
    const sign = [1, -1, 1, -1, 1, -1]
    const theta = pp * angle + (torque >= 0 ? Math.PI / 2 : -Math.PI / 2)
    const iPh = [Math.cos(theta), Math.cos(theta - (2 * Math.PI) / 3), Math.cos(theta + (2 * Math.PI) / 3)]
    const c = new THREE.Color()
    for (let i = 0; i < DU.slots; i++) {
      const b = Math.floor(i / 3) % 6
      const ph = belt[b]
      const v = iPh[ph] * sign[b]
      const k = Math.max(0, v) * I * cur * 2.2 + 0.05
      c.copy(PHASE_COLOR[ph]).multiplyScalar(k)
      this.slotGlow.setColorAt(i, c)
    }
    if (this.slotGlow.instanceColor) this.slotGlow.instanceColor.needsUpdate = true
    for (let p = 0; p < 3; p++) this.phaseBars[p].color.copy(PHASE_COLOR[p]).multiplyScalar((0.15 + Math.abs(iPh[p]) * 2.2) * I * cur)
    void dt
  }
}
