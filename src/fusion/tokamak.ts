import * as THREE from 'three'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import { revolve, ringProfile, pipe, boltGeo, ringMatrices, P2 } from '../core/geometry'
import { rng } from '../core/noise'
import { LAYER_GAS, LAYER_GLOW } from '../render/pipeline'
import { TK, dContour, dShell, fluxPoint, rhoAt, plasmaMaterial, glowLineMaterial, PLASMA } from './plasma'

/** Per system emphasis, animated by main from the Follow control. */
export const TK_EMPH = {
  plasma: { value: 1 },
  field: { value: 0.35 },
  coils: { value: 0.25 },
  neutrons: { value: 1 },
  beam: { value: 1 },
  heat: { value: 0.2 },
}
export const TK_RATE = { beam: { value: 1 }, coils: { value: 1 } }

const TF_N = 18
const TF_W = 0.066
/** Coils are wedges: wider the further they are from the axis, like the real ones. */
const tfHalfWidth = (R: number) => Math.min(0.1, Math.max(0.032, 0.16 * R))
/** the TF coil winding runs between these two D contours */
const TF_HOLE = () => dContour(TK.vvOut, 120, 0.05, 0.26)
const TF_OUT = () => dContour(TK.vvOut, 120, 0.16, 0.155)

function shapeFrom(pts: P2[]) {
  const s = new THREE.Shape()
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  s.closePath()
  return s
}

interface Neutron { p: THREE.Vector3; v: THREE.Vector3; age: number; hit: number }

export class Tokamak {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly parts: { group: THREE.Object3D; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly glows: THREE.Mesh[] = []
  readonly M: Record<string, THREE.MeshStandardMaterial>
  readonly plasma: THREE.Mesh
  private tf: THREE.InstancedMesh
  private tfGlow: THREE.InstancedMesh
  private tfBase: THREE.Matrix4[] = []
  private neutrons: THREE.InstancedMesh
  private ns: Neutron[] = []
  private rnd = rng(7)
  private dummy = new THREE.Object3D()
  /** 0..1, share of neutrons in flight (follows fusion power) */
  activity = 1
  explode = 0

  constructor() {
    this.root.name = 'tokamak'
    this.cut = new CutState(this.root, 2.1, 0, (58 * Math.PI) / 180)
    const cut = this.cut
    const steelCap = 0x9ea4ab
    const copper = 0xc8793f
    const tileTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const g = c.getContext('2d')!
      g.fillStyle = '#b8bbc0'
      g.fillRect(0, 0, 256, 256)
      g.fillStyle = '#3a3d42'
      g.fillRect(0, 0, 256, 10)
      g.fillRect(0, 0, 10, 256)
      g.fillStyle = 'rgba(0,0,0,0.12)'
      for (let i = 0; i < 4; i++) g.fillRect(10 + i * 62, 10, 2, 246)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(36, 11)
      t.anisotropy = 8
      return t
    })()
    const M = (this.M = {
      vessel: surf({ color: 0xa9aeb5, metalness: 1, roughness: 0.34, detail: 0.9, roughVar: 0.18, colorVar: 0.02, anisotropy: 0.35, cut, capColor: steelCap, capMetalness: 0.6, name: 'vessel' }),
      blanket: surf({ color: 0x8b8e94, metalness: 0.85, roughness: 0.46, map: tileTex, detail: 3, roughVar: 0.3, cut, capColor: 0x9ea3aa, name: 'blanket' }),
      divertor: surf({ color: 0x3c3f45, metalness: 0.9, roughness: 0.38, detail: 6, cut, capColor: 0x8b9097, name: 'divertor' }),
      coil: surf({ color: 0x252a32, metalness: 0.75, roughness: 0.34, detail: 3, roughVar: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.25, cut, capColor: copper, capMetalness: 0.95, capRoughness: 0.3, name: 'coil' }),
      pf: surf({ color: 0x2c313a, metalness: 0.75, roughness: 0.36, detail: 3, clearcoat: 0.4, cut, capColor: copper, capMetalness: 0.95, capRoughness: 0.3, name: 'pf' }),
      cs: surf({ color: 0x9aa0a8, metalness: 1, roughness: 0.28, detail: 4, anisotropy: 0.5, cut, capColor: copper, capMetalness: 0.95, capRoughness: 0.3, name: 'cs' }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.3, detail: 8, cut, capColor: 0xd9b25e, name: 'gold' }),
      port: surf({ color: 0x6f757d, metalness: 1, roughness: 0.42, detail: 0.8, roughVar: 0.15, colorVar: 0.03, anisotropy: 0.3, cut, capColor: steelCap, name: 'port' }),
      dark: surf({ color: 0x1b1f26, metalness: 0.6, roughness: 0.42, detail: 0.8, roughVar: 0.15, colorVar: 0.03, cut, capColor: 0x6a7079, name: 'dark' }),
      nbi: surf({ color: 0x2a3e5c, metalness: 0.55, roughness: 0.42, detail: 3, clearcoat: 0.5, cut, capColor: 0x9aa3ad, name: 'nbi' }),
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
    const glowMesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      mesh.userData.fluid = 'glow'
      parent.add(mesh)
      this.glows.push(mesh)
      return mesh
    }

    /* ---------------- vessel, blanket, divertor (fixed) ---------------- */
    const core = new THREE.Group()
    this.root.add(core)
    for (const up of [true, false]) {
      add(revolve(dShell(TK.vvIn, TK.vvOut, up), 144, 50), M.vessel, core)
      add(revolve(dShell(TK.fw, TK.blanket, up), 144, 50), M.blanket, core)
    }
    // divertor: a dome between two target plates on the floor of the vessel
    const zb = -TK.K * TK.a * TK.fw
    const rb = TK.R0 - TK.a * TK.fw * TK.D
    const div: P2[] = [
      [rb - 0.2, zb + 0.02], [rb - 0.16, zb + 0.05], [rb - 0.1, zb + 0.015], [rb - 0.05, zb + 0.03],
      [rb, zb + 0.06], [rb + 0.05, zb + 0.03], [rb + 0.1, zb + 0.015], [rb + 0.17, zb + 0.06], [rb + 0.22, zb + 0.03],
      [rb + 0.22, zb - 0.03], [rb - 0.2, zb - 0.03],
    ]
    add(revolve(div, 144, 25), M.divertor, core)
    // strike lines: where the plasma exhaust lands, a few thousand degrees
    const strikeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.25).multiplyScalar(3) })
    strikeMat.clippingPlanes = cut.planes
    strikeMat.clipIntersection = true
    this.strike = strikeMat
    for (const r of [rb - 0.1, rb + 0.1]) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 160), strikeMat)
      s.rotation.x = Math.PI / 2
      s.position.y = zb + 0.02
      s.layers.set(LAYER_GLOW)
      s.userData.fluid = 'glow'
      core.add(s)
    }
    this.anchors.vessel = [core, new THREE.Vector3(0.1, TK.K * TK.a * 1.62, 0.0)]
    this.anchors.blanket = [core, new THREE.Vector3(TK.R0 + TK.a * 1.3, 0.28, 0.0)]
    this.anchors.divertor = [core, new THREE.Vector3(rb + 0.05, zb + 0.06, 0.0)]

    /* ---------------- plasma ---------------- */
    const plasmaGeo = revolve(dContour(TK.fw - 0.02, 128), 160, 60)
    this.plasma = new THREE.Mesh(plasmaGeo, plasmaMaterial(cut))
    this.plasma.layers.set(LAYER_GAS)
    this.plasma.userData.fluid = 'plasma'
    this.plasma.renderOrder = 2
    core.add(this.plasma)
    this.anchors.plasma = [core, new THREE.Vector3(TK.R0 + 0.05, 0.1, 0.0)]
    this.anchors.core = [core, new THREE.Vector3(TK.R0 * 0.94, -0.05, 0.0)]

    // magnetic field lines on nested flux surfaces
    const fieldMat = glowLineMaterial(cut, { color: 0x6fe0ff, emph: TK_EMPH.field, speed: 0.6, scale: 0.35, base: 0.3 })
    const lines: [number, number, number][] = [[0.42, 1.5, 0], [0.42, 1.5, Math.PI], [0.68, 2, 0.6], [0.68, 2, 0.6 + Math.PI], [0.9, 3, 1.2], [0.9, 3, 1.2 + (2 * Math.PI) / 3], [0.9, 3, 1.2 + (4 * Math.PI) / 3]]
    for (const [rho, q, th0] of lines) {
      const turns = q === 1.5 ? 3 : q
      const pts: THREE.Vector3[] = []
      const N = 420 * turns
      for (let i = 0; i < N; i++) {
        const phi = (i / N) * Math.PI * 2 * turns
        pts.push(fluxPoint(rho, th0 + phi / q, phi))
      }
      const curve = new THREE.CatmullRomCurve3(pts, true)
      glowMesh(pipe(curve, { r: 0.0032, tubular: N, radial: 6 }), fieldMat, core)
    }

    /* ---------------- toroidal field coils ---------------- */
    const tfGroup = part([0, 0, 0])
    const tfShape = shapeFrom(TF_OUT())
    tfShape.holes.push(new THREE.Path(TF_HOLE().map(([x, y]) => new THREE.Vector2(x, y))))
    const tfGeo = new THREE.ExtrudeGeometry(tfShape, { depth: TF_W, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 })
    tfGeo.translate(0, 0, -TF_W / 2)
    {
      const pos = tfGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const R = pos.getX(i), z = pos.getZ(i)
        pos.setZ(i, (z / (TF_W / 2 + 0.006)) * (tfHalfWidth(R) + 0.006))
      }
      tfGeo.computeVertexNormals()
    }
    for (let i = 0; i < TF_N; i++) {
      const phi = (i / TF_N) * Math.PI * 2
      const m = new THREE.Matrix4().makeRotationY(-phi)
      this.tfBase.push(m)
    }
    this.tf = new THREE.InstancedMesh(tfGeo, M.coil, TF_N)
    this.tf.castShadow = true
    this.tf.receiveShadow = true
    this.tfBase.forEach((m, i) => this.tf.setMatrixAt(i, m))
    tfGroup.add(this.tf)
    // current in the winding: a glowing loop on each coil face
    const mid: P2[] = TF_HOLE().map(([x, y], i) => {
      const o = TF_OUT()[i]
      return [(x + o[0]) / 2, (y + o[1]) / 2]
    })
    const loop = new THREE.CatmullRomCurve3(mid.map(([x, y]) => new THREE.Vector3(x, y, tfHalfWidth(x) + 0.014)), true)
    const coilGlowMat = glowLineMaterial(cut, { color: 0x7fd8ff, emph: TK_EMPH.coils, rate: TK_RATE.coils, speed: 0.9, scale: 0.3, base: 0.25 })
    this.tfGlow = new THREE.InstancedMesh(pipe(loop, { r: 0.006, tubular: 320, radial: 6 }), coilGlowMat, TF_N)
    this.tfBase.forEach((m, i) => this.tfGlow.setMatrixAt(i, m))
    this.tfGlow.layers.set(LAYER_GLOW)
    this.tfGlow.userData.fluid = 'glow'
    tfGroup.add(this.tfGlow)
    this.anchors.tf = [this.root, new THREE.Vector3(Math.cos(0.17) * 1.43, 0.35, -Math.sin(0.17) * 1.43)]

    /* ---------------- central solenoid ---------------- */
    const cs = part([0, 1.15, 0])
    const csH = 1.9, csN = 6, gap = 0.012
    for (let i = 0; i < csN; i++) {
      const y0 = -csH / 2 + (i * csH) / csN + gap / 2
      add(revolve(ringProfile(0.05, 0.135, y0, y0 + csH / csN - gap, 0.006), 96), M.cs, cs)
    }
    add(revolve(ringProfile(0.03, 0.15, csH / 2, csH / 2 + 0.05, 0.01), 96), M.dark, cs)
    add(revolve(ringProfile(0.03, 0.15, -csH / 2 - 0.05, -csH / 2, 0.01), 96), M.dark, cs)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      const rod = add(new THREE.CylinderGeometry(0.008, 0.008, csH + 0.1, 10), M.gold, cs)
      rod.position.set(Math.cos(a) * 0.142, 0, Math.sin(a) * 0.142)
    }
    const csGlowMat = glowLineMaterial(cut, { color: 0x7fd8ff, emph: TK_EMPH.coils, rate: TK_RATE.coils, speed: 1.4, scale: 0.12, base: 0.25 })
    {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 900; i++) {
        const u = i / 900
        const a = u * Math.PI * 2 * 22
        pts.push(new THREE.Vector3(Math.cos(a) * 0.138, -csH / 2 + 0.03 + u * (csH - 0.06), Math.sin(a) * 0.138))
      }
      glowMesh(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.0025, tubular: 1800, radial: 5 }), csGlowMat, cs)
    }
    this.anchors.cs = [cs, new THREE.Vector3(0, 0.62, 0.02)]

    /* ---------------- poloidal field coils ---------------- */
    const pfDefs: [number, number, number, number, number][] = [
      // R, Z, radial size, height, explode dy
      [0.62, 1.12, 0.12, 0.08, 0.55],
      [1.2, 0.86, 0.08, 0.08, 0.4],
      [1.56, 0.3, 0.07, 0.1, 0.12],
      [1.56, -0.3, 0.07, 0.1, -0.05],
      [1.2, -0.86, 0.08, 0.08, -0.08],
      [0.62, -1.12, 0.12, 0.08, -0.08],
    ]
    const pfGlowMat = glowLineMaterial(cut, { color: 0x7fd8ff, emph: TK_EMPH.coils, rate: TK_RATE.coils, speed: 0.7, scale: 0.4, base: 0.25 })
    pfDefs.forEach(([R, Z, w, h, dy], i) => {
      const g = part([0, dy, 0])
      add(revolve(ringProfile(R - w / 2, R + w / 2, Z - h / 2, Z + h / 2, 0.01), 180), M.pf, g)
      const ring = new THREE.CatmullRomCurve3(Array.from({ length: 256 }, (_, k) => {
        const a = (k / 256) * Math.PI * 2
        return new THREE.Vector3(Math.cos(a) * (R + w / 2 + 0.004), Z, Math.sin(a) * (R + w / 2 + 0.004))
      }), true)
      glowMesh(pipe(ring, { r: 0.004, tubular: 512, radial: 5 }), pfGlowMat, g)
      // clamps tying each ring to the coil cases
      const n = 18
      const clamp = new THREE.BoxGeometry(0.035, h + 0.03, w + 0.03)
      const im = new THREE.InstancedMesh(clamp, M.dark, n)
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2
        this.dummy.position.set(Math.cos(a) * R, Z, -Math.sin(a) * R)
        this.dummy.rotation.set(0, a, 0)
        this.dummy.updateMatrix()
        im.setMatrixAt(k, this.dummy.matrix)
      }
      im.castShadow = true
      im.receiveShadow = true
      g.add(im)
      if (i === 2) this.anchors.pf = [g, new THREE.Vector3(R * Math.cos(-0.9), Z + 0.07, R * Math.sin(-0.9))]
    })

    /* ---------------- ports ---------------- */
    const ports = part([0, 0, 0])
    const portShape = new THREE.Shape()
    const pw = 0.11, ph = 0.16
    portShape.moveTo(-pw, -ph); portShape.lineTo(pw, -ph); portShape.lineTo(pw, ph); portShape.lineTo(-pw, ph); portShape.closePath()
    portShape.holes.push(new THREE.Path([new THREE.Vector2(-pw + 0.02, -ph + 0.02), new THREE.Vector2(-pw + 0.02, ph - 0.02), new THREE.Vector2(pw - 0.02, ph - 0.02), new THREE.Vector2(pw - 0.02, -ph + 0.02)]))
    const portGeo = new THREE.ExtrudeGeometry(portShape, { depth: 0.62, bevelEnabled: false })
    portGeo.rotateY(Math.PI / 2)
    portGeo.translate(1.28, 0, 0)
    const flangeGeo = new THREE.BoxGeometry(0.04, ph * 2 + 0.07, pw * 2 + 0.07)
    flangeGeo.translate(1.92, 0, 0)
    const plugGeo = new THREE.BoxGeometry(0.03, ph * 2 - 0.02, pw * 2 - 0.02)
    plugGeo.translate(1.9, 0, 0)
    const bolt = boltGeo(0.008, 0.01)
    const portAngles: number[] = []
    for (let i = 0; i < TF_N; i += 2) portAngles.push(((i + 0.5) / TF_N) * Math.PI * 2)
    const portMats = portAngles.map((phi) => new THREE.Matrix4().makeRotationY(-phi))
    for (const [g, m] of [[portGeo, M.port], [flangeGeo, M.port], [plugGeo, M.dark]] as const) {
      const im = new THREE.InstancedMesh(g, m, portMats.length)
      portMats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.castShadow = true
      im.receiveShadow = true
      ports.add(im)
    }
    {
      const bm: THREE.Matrix4[] = []
      for (const pm of portMats) for (let k = 0; k < 10; k++) {
        const side = k < 5 ? -1 : 1
        const t = (k % 5) / 4
        const m = new THREE.Matrix4().makeRotationZ(-Math.PI / 2)
        m.setPosition(1.943, side * (ph + 0.018), -pw + t * pw * 2)
        bm.push(pm.clone().multiply(m))
      }
      const im = new THREE.InstancedMesh(bolt, M.gold, bm.length)
      bm.forEach((m, i) => im.setMatrixAt(i, m))
      ports.add(im)
    }
    // upper ports, straight up between the coils
    const upGeo = revolve(ringProfile(0.06, 0.08, 0.62, 1.16, 0.004), 40)
    const upCap = revolve(ringProfile(0.0, 0.105, 1.16, 1.19, 0.006), 40)
    const upMats = portAngles.map((phi) => new THREE.Matrix4().makeRotationY(-phi).multiply(new THREE.Matrix4().makeTranslation(1.02, 0, 0)))
    for (const [g, m] of [[upGeo, M.port], [upCap, M.dark]] as const) {
      const im = new THREE.InstancedMesh(g, m, upMats.length)
      upMats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.castShadow = true
      im.receiveShadow = true
      ports.add(im)
    }

    /* ---------------- heating beam ---------------- */
    const nbi = part([0.35, 0, -0.55])
    const beamPhi = -1.05
    const tangency = 0.95
    const dir = new THREE.Vector3(-Math.sin(beamPhi), 0, Math.cos(beamPhi)) // tangent to the torus at beamPhi
    const tp = new THREE.Vector3(Math.cos(beamPhi) * tangency, 0.02, Math.sin(beamPhi) * tangency)
    const src = tp.clone().addScaledVector(dir, -2.35)
    {
      const box = add(new THREE.BoxGeometry(0.42, 0.44, 0.9), M.nbi, nbi)
      box.position.copy(src).addScaledVector(dir, -0.2)
      box.lookAt(box.position.clone().add(dir))
      const duct = add(pipe(new THREE.LineCurve3(src.clone().addScaledVector(dir, 0.25), tp.clone().addScaledVector(dir, -1.2)), { r: 0.075, ri: 0.06, tubular: 8, radial: 32 }), M.port, nbi)
      void duct
      for (const k of [0.3, 0.75]) {
        const fl = add(revolve(ringProfile(0.075, 0.11, -0.012, 0.012, 0.003), 40), M.port, nbi)
        fl.position.copy(src).addScaledVector(dir, k)
        fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      }
      const leg = add(new THREE.BoxGeometry(0.3, 1.0, 0.5), M.dark, nbi)
      leg.position.copy(box.position)
      leg.position.y = -0.78
      leg.rotation.copy(box.rotation)
      const beamMat = glowLineMaterial(cut, { color: 0x8fb4ff, emph: TK_EMPH.beam, rate: TK_RATE.beam, speed: 3.2, scale: 0.18, base: 0.2 })
      glowMesh(pipe(new THREE.LineCurve3(src.clone().addScaledVector(dir, 0.3), tp.clone().addScaledVector(dir, 0.35)), { r: 0.022, tubular: 64, radial: 12 }), beamMat, nbi)
      this.anchors.nbi = [nbi, box.position.clone().add(new THREE.Vector3(0, 0.28, 0))]
    }

    /* ---------------- supports ---------------- */
    const base = new THREE.Group()
    this.root.add(base)
    const legMats: THREE.Matrix4[] = []
    for (let i = 0; i < TF_N; i++) {
      const phi = (i / TF_N) * Math.PI * 2
      const m = new THREE.Matrix4().makeRotationY(-phi).multiply(new THREE.Matrix4().makeTranslation(1.02, -1.12, 0))
      legMats.push(m)
    }
    {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), M.dark, TF_N)
      legMats.forEach((m, i) => im.setMatrixAt(i, m))
      im.castShadow = true
      im.receiveShadow = true
      base.add(im)
    }
    add(revolve(ringProfile(0.82, 1.22, -1.36, -1.3, 0.01), 144), M.dark, base)
    const bolts = new THREE.InstancedMesh(bolt, M.gold, 36)
    ringMatrices(36, 1.16, -1.3).forEach((m, i) => bolts.setMatrixAt(i, m))
    base.add(bolts)

    // coolant: hot water leaves the blanket through two lines to the floor
    const heatMat = glowLineMaterial(cut, { color: 0xff8a3a, emph: TK_EMPH.heat, speed: 1.1, scale: 0.2, base: 0.3 })
    for (const phi of [-2.25, -2.6]) {
      const r0 = 1.93
      const pts: [number, number, number][] = [[r0, 0.1, 0], [r0 + 0.2, 0.1, 0], [r0 + 0.28, 0.02, 0], [r0 + 0.28, -1.34, 0]]
      const rot = new THREE.Matrix4().makeRotationY(-phi)
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p).applyMatrix4(rot)), false, 'catmullrom', 0.1)
      add(pipe(curve, { r: 0.035, tubular: 80, radial: 18 }), M.port, ports)
      glowMesh(pipe(curve, { r: 0.037, tubular: 80, radial: 12 }), heatMat, ports)
      if (phi === -2.25) this.anchors.heat = [ports, new THREE.Vector3(r0 + 0.28, -0.6, 0).applyMatrix4(rot)]
    }

    /* ---------------- neutrons ---------------- */
    const nMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 1.0, 0.55).multiplyScalar(4) })
    nMat.clippingPlanes = cut.planes
    nMat.clipIntersection = true
    this.nMat = nMat
    const nGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.06, 5)
    nGeo.rotateX(Math.PI / 2)
    this.neutrons = new THREE.InstancedMesh(nGeo, nMat, 220)
    this.neutrons.layers.set(LAYER_GLOW)
    this.neutrons.userData.fluid = 'glow'
    this.neutrons.frustumCulled = false
    core.add(this.neutrons)
    for (let i = 0; i < 220; i++) {
      const n: Neutron = { p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, hit: 0 }
      this.spawn(n)
      // spread the first generation along their paths
      const k = this.rnd() * 0.5
      n.p.addScaledVector(n.v, k)
      this.ns.push(n)
    }
  }

  private strike: THREE.MeshBasicMaterial
  private nMat: THREE.MeshBasicMaterial

  private spawn(n: Neutron) {
    const r = this.rnd
    fluxPoint(Math.sqrt(r()) * 0.75, r() * Math.PI * 2, r() * Math.PI * 2, n.p)
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u)
    n.v.set(s * Math.cos(a), u, s * Math.sin(a)).multiplyScalar(0.9)
    n.age = 0
    n.hit = 0
  }

  /** explode 0..1; heat and fusion activity drive the glows */
  update(dt: number, explode: number, fusion: number, heatK: number) {
    this.explode = explode
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    // coils move straight out
    const m = new THREE.Matrix4()
    for (let i = 0; i < TF_N; i++) {
      const phi = (i / TF_N) * Math.PI * 2
      m.copy(this.tfBase[i]).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(phi) * 0.55 * e, 0, Math.sin(phi) * 0.55 * e))
      this.tf.setMatrixAt(i, m)
      this.tfGlow.setMatrixAt(i, m)
    }
    this.tf.instanceMatrix.needsUpdate = true
    this.tfGlow.instanceMatrix.needsUpdate = true
    this.plasma.visible = PLASMA.on.value * PLASMA.emph.value > 0.003
    this.strike.color.setRGB(1.0, 0.55, 0.25).multiplyScalar(0.4 + 3.2 * fusion * PLASMA.on.value)
    const blanketGlow = heatK * fusion
    this.M.blanket.emissive.setRGB(1.0, 0.36, 0.1)
    this.M.blanket.emissiveIntensity = 0.35 * blanketGlow

    // neutrons fly straight out until they hit the blanket
    const act = Math.max(0, Math.min(1, this.activity))
    const nOn = TK_EMPH.neutrons.value
    this.nMat.color.setRGB(0.75, 1.0, 0.55).multiplyScalar(3 * nOn)
    this.neutrons.visible = nOn * act > 0.01
    const d = this.dummy
    const ahead = new THREE.Vector3()
    for (let i = 0; i < this.ns.length; i++) {
      const n = this.ns[i]
      n.p.addScaledVector(n.v, dt)
      n.age += dt
      if (rhoAt(n.p) > TK.fw - 0.01 || n.age > 3) this.spawn(n)
      const live = i < this.ns.length * act
      d.position.copy(n.p)
      ahead.copy(n.p).add(n.v)
      d.lookAt(ahead)
      const s = live ? Math.min(1, n.age * 8) * (0.6 + 0.4 * Math.min(1, nOn)) : 0
      d.scale.set(s, s, s)
      d.updateMatrix()
      this.neutrons.setMatrixAt(i, d.matrix)
    }
    this.neutrons.instanceMatrix.needsUpdate = true
  }
}
