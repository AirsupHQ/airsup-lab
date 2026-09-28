import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf } from '../core/materials'
import { revolve, pipe, P2 } from '../core/geometry'
import { CutState } from '../core/cut'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from '../fusion/plasma'
import { F1Internals } from './internals'

/**
 * A 2026 regulation Formula 1 car at full size, built in the car's own frame:
 * +x forward, +y up, ground at y = 0, z across. Numbers from the public 2026
 * rules: 3.4 m wheelbase, 1.9 m wide, 768 kg minimum with the driver, 18 inch
 * wheels, active front and rear wings with a straight mode and a corner mode,
 * and a power unit split close to half and half between the 1.6 litre V6 and
 * a 350 kW electric motor. No team livery: it wears the lab's own.
 */
export const F1 = {
  wb: 3.4,
  axF: 1.7,
  axR: -1.7,
  width: 1.9,
  mass: 800, // kg with driver and some fuel
  Rf: 0.3525,
  Rr: 0.355,
  wf: 0.28,
  wr: 0.375,
  zf: 0.81,
  zr: 0.7625,
  ice: 400, // kW
  mguk: 350, // kW
  // aero estimates for the 2026 car: lift and drag area, m²
  clCorner: 3.3,
  cdCorner: 1.05,
  clStraight: 1.3,
  cdStraight: 0.62,
}

export type F1Mode = 'straight' | 'corner' | 'brake'

/** Forces at a speed, km/h, from ½ρv²·area. Estimates, not team data. */
export function f1Physics(kmh: number, mode: F1Mode, open: number) {
  const v = kmh / 3.6
  const q = 0.5 * 1.225 * v * v
  const cl = F1.clCorner + (F1.clStraight - F1.clCorner) * open
  const cd = F1.cdCorner + (F1.cdStraight - F1.cdCorner) * open
  const df = q * cl
  const drag = q * cd
  const W = F1.mass * 9.81
  const mu = 1.6
  const lat = ((W + df) * mu) / F1.mass / 9.81
  const brake = ((W + df) * mu + drag) / F1.mass / 9.81
  const airKW = (drag * v) / 1000
  const ceiling = Math.sqrt((2 * W) / (1.225 * F1.clCorner)) * 3.6
  void mode
  return { df, dfKg: df / 9.81, drag, lat, brake, airKW, ceiling, ratio: df / W }
}

export const F1_FLOW = {
  air: { value: 0.8 },
  under: { value: 0.8 },
  vortex: { value: 0.6 },
  power: { value: 0 },
  harvest: { value: 0 },
  rate: { value: 1 },
  pressure: { value: 0 },
  q: { value: 1 },
  time: { value: 0 },
}

/* ---------------- smooth lofts ---------------- */

export interface Sec { x: number; y: number; w: number; wb?: number; t: number; b: number; n: number; nb: number }
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const sp = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e)

/**
 * Loft superellipse sections along x into one smooth closed skin. Each section
 * has its own top and bottom half height and exponent, and a bottom width for
 * undercuts. paint(x, y, z) gives a vertex colour.
 */
export function loft(secs: Sec[], paint: (x: number, y: number, z: number) => number, steps = 10, ring = 72) {
  const keys: (keyof Sec)[] = ['x', 'y', 'w', 'wb', 't', 'b', 'n', 'nb']
  const S = secs.map((s) => ({ ...s, wb: s.wb ?? s.w }))
  const at = (i: number) => S[Math.max(0, Math.min(S.length - 1, i))]
  const rows: Sec[] = []
  for (let i = 0; i < S.length - 1; i++)
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const o = {} as Record<string, number>
      for (const key of keys) o[key] = cr(at(i - 1)[key] as number, at(i)[key] as number, at(i + 1)[key] as number, at(i + 2)[key] as number, t)
      rows.push(o as unknown as Sec)
    }
  rows.push(S[S.length - 1])
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const c = new THREE.Color()
  for (const r of rows) {
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2
      const ca = Math.cos(a), sa = Math.sin(a)
      const up = ss(-0.45, 0.45, sa)
      const w = r.wb! + (r.w - r.wb!) * up
      const n = r.nb + (r.n - r.nb) * up
      const y = r.y + sp(sa, 2 / n) * (sa > 0 ? r.t : r.b)
      const z = w * sp(ca, 2 / n)
      pos.push(r.x, y, z)
      c.setHex(paint(r.x, y, z))
      col.push(c.r, c.g, c.b)
    }
  }
  const R = rows.length
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j, b = i * ring + ((j + 1) % ring), cc = a + ring, d = b + ring
      idx.push(a, b, cc, b, d, cc)
    }
  // end caps
  for (const [row, flip] of [[0, true], [R - 1, false]] as const) {
    const base = pos.length / 3
    const r = rows[row]
    pos.push(r.x, r.y, 0)
    c.setHex(paint(r.x, r.y, 0))
    col.push(c.r, c.g, c.b)
    for (let j = 0; j < ring; j++) {
      const a = row * ring + j, b = row * ring + ((j + 1) % ring)
      if (flip) idx.push(base, b, a)
      else idx.push(base, a, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* ---------------- wings ---------------- */

/** A cambered section, closed, from the trailing edge over the top to the leading edge and back underneath. */
export function foil(t: number, m: number, n = 22): P2[] {
  const up: P2[] = [], lo: P2[] = []
  for (let i = 0; i <= n; i++) {
    const u = (1 - Math.cos((Math.PI * i) / n)) / 2
    const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
    const yc = m * 4 * u * (1 - u)
    const th = Math.atan(m * 4 * (1 - 2 * u))
    up.push([u - yt * Math.sin(th), yc + yt * Math.cos(th)])
    lo.push([u + yt * Math.sin(th), yc - yt * Math.cos(th)])
  }
  return [...up.reverse(), ...lo.slice(1)]
}

export interface WingAt { x: number; y: number; c: number; a: number }
/**
 * An inverted wing element along z: at each span station the section is placed
 * with its leading edge at (x, y), chord c, trailing edge raised by angle a.
 */
export function wing(z0: number, z1: number, n: number, f: (z: number) => WingAt, profIn: P2[], invert = true) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  // a lifting (not inverted) section is mirrored, so walk it the other way to keep the skin facing out
  const prof = invert ? profIn : profIn.slice().reverse()
  const P = prof.length
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n
    const { x, y, c, a } = f(z)
    const dx = -Math.cos(a), dy = Math.sin(a)
    const nx = Math.sin(a), ny = Math.cos(a)
    for (let j = 0; j < P; j++) {
      const [u, v0] = prof[j]
      const v = invert ? -v0 : v0 // inverted: camber faces down, suction underneath
      pos.push(x + (dx * u + nx * v) * c, y + (dy * u + ny * v) * c, z)
      uv.push(z * 30, u * c * 30)
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < P; j++) {
      const a = i * P + j, b = i * P + ((j + 1) % P), c = a + P, d = b + P
      idx.push(a, c, b, b, c, d)
    }
  for (const [row, flip] of [[0, true], [n, false]] as const) {
    const base = pos.length / 3
    let cx = 0, cy = 0
    for (let j = 0; j < P; j++) { cx += pos[(row * P + j) * 3]; cy += pos[(row * P + j) * 3 + 1] }
    pos.push(cx / P, cy / P, pos[row * P * 3 + 2])
    uv.push(0, 0)
    for (let j = 0; j < P; j++) {
      const a = row * P + j, b = row * P + ((j + 1) % P)
      if (flip) idx.push(base, a, b)
      else idx.push(base, b, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** A flat plate from an outline in (x, y), thickness th, centred on z = 0. */
export function plate(pts: P2[], th: number, bevel = 0.003) {
  const s = new THREE.Shape()
  s.moveTo(pts[0][0], pts[0][1])
  for (const p of pts.slice(1)) s.lineTo(p[0], p[1])
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 12 })
  g.translate(0, 0, -th / 2)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 30, uv.getY(i) * 30)
  return g
}

/** A streamlined strut between two points, chord w across the flow, thickness t. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, t: number) {
  const d = new THREE.Vector3().subVectors(b, a)
  const len = d.length()
  const g = new THREE.CylinderGeometry(1, 1, len, 14, 1)
  g.scale(w / 2, 1, t / 2)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  g.applyQuaternion(q)
  const m = a.clone().add(b).multiplyScalar(0.5)
  g.translate(m.x, m.y, m.z)
  return g
}

/* ---------------- surfaces ---------------- */

export function carbonTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const cell = 16
  for (let i = 0; i < 128 / cell; i++)
    for (let j = 0; j < 128 / cell; j++) {
      // 2x2 twill: tows alternate direction on a diagonal step
      const horiz = ((i + j) >> 1) % 2 === 0
      const grad = horiz ? g.createLinearGradient(0, j * cell, 0, (j + 1) * cell) : g.createLinearGradient(i * cell, 0, (i + 1) * cell, 0)
      grad.addColorStop(0, '#0b0c0e')
      grad.addColorStop(0.5, horiz ? '#2b2e33' : '#1f2226')
      grad.addColorStop(1, '#0b0c0e')
      g.fillStyle = grad
      g.fillRect(i * cell, j * cell, cell, cell)
    }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Illustrative pressure on the car's surfaces: red where air piles up, blue where it is sucked away. */
function pressureMaterial(cut: CutState, inv: { value: THREE.Matrix4 }) {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      uniform mat4 uInv;
      varying vec3 vL;
      varying vec3 vN;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <clipping_planes_vertex>
        mat4 toCar = uInv * modelMatrix;
        vL = (toCar * vec4(position, 1.0)).xyz;
        vN = normalize(mat3(toCar) * normal);
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uQ, uOpen, uTime;
      varying vec3 vL;
      varying vec3 vN;
      vec3 cmap(float c) {
        // suction blue through cyan to green at ambient, then yellow and red where air piles up
        vec3 g = vec3(0.25, 0.85, 0.35);
        vec3 lo = mix(g, vec3(0.1, 0.75, 1.0), smoothstep(0.0, 0.45, -c));
        lo = mix(lo, vec3(0.08, 0.2, 0.95), smoothstep(0.45, 1.2, -c));
        vec3 hi = mix(g, vec3(1.0, 0.88, 0.15), smoothstep(0.0, 0.45, c));
        hi = mix(hi, vec3(1.0, 0.15, 0.06), smoothstep(0.45, 0.9, c));
        return c < 0.0 ? lo : hi;
      }
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 p = vL;
        float fwd = max(n.x, 0.0);
        float cp = fwd * fwd;
        cp -= max(-n.x, 0.0) * 0.35;
        cp -= max(n.y, 0.0) * 0.95 * smoothstep(0.28, 0.62, p.y) * (1.0 - fwd);
        cp -= abs(n.z) * 0.3 * (1.0 - fwd) * smoothstep(0.1, 0.3, p.y);
        float fw = step(2.05, p.x) * step(p.y, 0.4);
        float rw = step(p.x, -1.95) * step(0.62, p.y);
        float wk = fw + rw * (1.0 - 0.6 * uOpen);
        cp += (fw + rw) * max(n.y, 0.0) * 0.8 * (1.0 - 0.6 * uOpen);
        cp -= wk * max(-n.y, 0.0) * 2.0;
        float under = max(-n.y, 0.0) * step(p.y, 0.1) * step(-2.3, p.x) * step(p.x, 1.3);
        cp -= under * (0.7 + 1.1 * exp(-pow((p.x + 0.45) / 0.8, 2.0))) * (1.0 - 0.35 * uOpen);
        cp *= uQ;
        float lam = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
        gl_FragColor = vec4(cmap(cp) * lam * 0.9, 1.0);
      }`,
    uniforms: { uInv: inv, uQ: F1_FLOW.q, uOpen: { value: 0 }, uTime: F1_FLOW.time },
    clipping: true,
    side: THREE.DoubleSide,
  })
  m.clippingPlanes = cut.planes
  return m
}

/* ---------------- the car ---------------- */

export class F1Car {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly M: Record<string, THREE.MeshStandardMaterial>
  readonly parts: { group: THREE.Object3D; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly wheels: { spin: THREE.Group; steer: THREE.Group; front: boolean }[] = []
  readonly flows: THREE.Mesh[] = []
  readonly powerLines: THREE.Mesh[] = []
  readonly discMat: THREE.MeshStandardMaterial
  readonly aero: THREE.Mesh[] = []
  readonly pressure: THREE.ShaderMaterial
  /** a soft light inside the car that comes up when it is cut open */
  readonly inner = new THREE.PointLight(0xe4ecff, 0, 3.2, 2)
  readonly pu!: F1Internals
  private inv = { value: new THREE.Matrix4() }
  private fwFlaps: { g: THREE.Group; k: number }[] = []
  private rwFlap = new THREE.Group()
  private rwMain = new THREE.Group()
  private rain: THREE.MeshBasicMaterial
  private pressureOn = false

  constructor() {
    this.root.name = 'f1'
    this.cut = new CutState(this.root, 1.2, 0.0)
    const cut = this.cut
    const carbonTex = carbonTexture()
    const M = (this.M = {
      paint: surf({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4, cut, capColor: 0x2a2d33, side: THREE.DoubleSide, name: 'f1-paint' }),
      carbon: surf({ color: 0xffffff, map: carbonTex, metalness: 0.25, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.06, envMapIntensity: 1.1, cut, capColor: 0x2a2c30, side: THREE.DoubleSide, name: 'f1-carbon' }),
      satin: surf({ color: 0x17181b, metalness: 0.3, roughness: 0.5, detail: 6, cut, capColor: 0x2a2c30, name: 'f1-satin' }),
      blue: surf({ color: 0x1f5fff, metalness: 0.4, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4, cut, capColor: 0x2a3a66, side: THREE.DoubleSide, name: 'f1-blue' }),
      white: surf({ color: 0xd9dde2, metalness: 0.1, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, cut, capColor: 0x6a6e74, side: THREE.DoubleSide, name: 'f1-white' }),
      tyre: surf({ color: 0x151517, metalness: 0, roughness: 0.78, detail: 40, bump: 0.0008, colorVar: 0.05, sheen: 0.25, sheenColor: 0x3a3c40, cut, capColor: 0x2a2a2c, name: 'f1-tyre' }),
      rim: surf({ color: 0x2b2d31, metalness: 0.9, roughness: 0.32, detail: 8, anisotropy: 0.4, cut, capColor: 0x5a5d62, name: 'f1-rim' }),
      ti: surf({ color: 0x6f757c, metalness: 0.85, roughness: 0.52, detail: 8, anisotropy: 0.5, cut, capColor: 0x5d6268, name: 'f1-ti' }),
      alu: surf({ color: 0x7c8187, metalness: 0.85, roughness: 0.58, detail: 8, colorVar: 0.06, cut, capColor: 0x44484e, name: 'f1-alu' }),
      hot: surf({ color: 0x6e6258, metalness: 1, roughness: 0.42, detail: 8, cut, capColor: 0x8a6a58, tint: { y0: -1.9, y1: -0.9, a: 0x6a5a8a, b: 0xa0826a, c: 0x8e8a86, strength: 0.5 }, name: 'f1-hot' }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.22, detail: 8, cut, capColor: 0xd9b25e, name: 'f1-gold' }),
      mag: surf({ color: 0x3e4247, metalness: 0.7, roughness: 0.55, detail: 10, colorVar: 0.06, cut, capColor: 0x3e4247, side: THREE.DoubleSide, name: 'f1-magnesium' }),
      rad: surf({ color: 0x8a9098, metalness: 0.9, roughness: 0.4, detail: 90, bump: 0.0012, cut, capColor: 0x8a9098, name: 'f1-radiator' }),
      battery: surf({ color: 0x2b3038, metalness: 0.6, roughness: 0.35, detail: 4, clearcoat: 0.3, cut, capColor: 0x47c8ff, name: 'f1-battery' }),
      orange: surf({ color: 0xff7a1c, metalness: 0, roughness: 0.45, clearcoat: 0.4, cut, capColor: 0xff7a1c, name: 'f1-hv' }),
      visor: surf({ color: 0x0b0c10, metalness: 0.9, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, cut, capColor: 0x222222, name: 'f1-visor' }),
      mirror: surf({ color: 0xdfe3e8, metalness: 1, roughness: 0.02, envMapIntensity: 1.6, cut, capColor: 0x777777, name: 'f1-mirror' }),
    })
    this.discMat = surf({ color: 0x2a2624, metalness: 0.2, roughness: 0.6, detail: 30, emissive: 0xff5a14, emissiveIntensity: 0, cut, capColor: 0x3a3634, name: 'f1-disc' })
    this.pressure = pressureMaterial(cut, this.inv)

    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, aero = false) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      p.add(mesh)
      if (aero) { this.aero.push(mesh); mesh.userData.skin = m }
      return mesh
    }
    const part = (dx: number, dy: number, dz = 0) => {
      const group = new THREE.Group()
      this.root.add(group)
      this.parts.push({ group, explode: new THREE.Vector3(dx, dy, dz) })
      return group
    }
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

    /* livery: gloss black with carbon underneath, a blue sweep and a white nose tip */
    const BLACK = 0x0d0e11, CARB = 0x16171a, BLUE = 0x1f5fff, WHITE = 0xe6e9ee
    const cockpit = (x: number, y: number, z: number) => x < 0.52 && x > -0.36 && y > 0.52 && Math.abs(z) < 0.19 + 0.03 * Math.sin(((x + 0.36) / 0.88) * Math.PI)
    const chassisPaint = (x: number, y: number, z: number) => {
      if (cockpit(x, y, z)) return 0x050506
      if (y < 0.2 + 0.1 * ss(0, 2.8, x)) return CARB
      if (x > 2.35) return WHITE
      if (x > 1.9 && x < 2.35 && Math.abs(z) < 0.03 + 0.02 * (2.35 - x)) return BLUE
      if (x < -0.5 && x > -2.0 && y > 0.6 && Math.abs(z) < 0.035) return BLUE
      return BLACK
    }
    const podPaint = (x: number, y: number, z: number) => {
      if (y < 0.23) return CARB
      const line = 0.5 - 0.1 * (0.4 - x)
      if (Math.abs(y - line) < 0.022 && x < 0.38 && x > -1.3 && Math.abs(z) > 0.3) return BLUE
      if (Math.abs(y - line + 0.05) < 0.006 && x < 0.3 && x > -1.0 && Math.abs(z) > 0.3) return WHITE
      return BLACK
    }

    /* ---------------- chassis, nose and engine cover ---------------- */
    const body = part(0, 0.9)
    const chassis: Sec[] = [
      { x: 2.82, y: 0.13, w: 0.05, t: 0.028, b: 0.022, n: 2.2, nb: 3 },
      { x: 2.62, y: 0.165, w: 0.08, t: 0.05, b: 0.05, n: 2.4, nb: 3 },
      { x: 2.2, y: 0.26, w: 0.115, t: 0.08, b: 0.08, n: 2.6, nb: 3 },
      { x: 1.8, y: 0.36, w: 0.15, t: 0.105, b: 0.1, n: 2.8, nb: 3.4 },
      { x: 1.35, y: 0.42, w: 0.195, t: 0.14, b: 0.15, n: 3, nb: 4 },
      { x: 0.9, y: 0.45, w: 0.245, t: 0.17, b: 0.3, n: 3.2, nb: 5 },
      { x: 0.5, y: 0.45, w: 0.285, t: 0.185, b: 0.36, n: 3.4, nb: 6 },
      { x: 0.1, y: 0.44, w: 0.3, t: 0.18, b: 0.36, n: 3.4, nb: 6 },
      { x: -0.3, y: 0.44, w: 0.3, t: 0.21, b: 0.36, n: 3.2, nb: 6 },
      { x: -0.52, y: 0.47, w: 0.27, t: 0.43, b: 0.38, n: 2.4, nb: 6 },
      { x: -0.78, y: 0.47, w: 0.23, t: 0.42, b: 0.38, n: 2.2, nb: 6 },
      { x: -1.1, y: 0.45, w: 0.19, t: 0.31, b: 0.34, n: 2.3, nb: 5 },
      { x: -1.5, y: 0.42, w: 0.15, t: 0.2, b: 0.26, n: 2.4, nb: 4 },
      { x: -1.9, y: 0.4, w: 0.11, t: 0.12, b: 0.18, n: 2.5, nb: 3 },
      { x: -2.25, y: 0.39, w: 0.075, t: 0.07, b: 0.1, n: 2.5, nb: 3 },
      { x: -2.4, y: 0.39, w: 0.05, t: 0.045, b: 0.06, n: 2.5, nb: 3 },
    ]
    add(loft(chassis, chassisPaint, 12, 80), M.paint, body, true).userData.hollow = true
    // sidepods with an undercut and a downwash ramp into the coke bottle
    const pods: Sec[] = [
      { x: 0.44, y: 0.39, w: 0.66, wb: 0.6, t: 0.14, b: 0.12, n: 5, nb: 2.4 },
      { x: 0.25, y: 0.39, w: 0.71, wb: 0.56, t: 0.17, b: 0.16, n: 4.6, nb: 2.4 },
      { x: -0.15, y: 0.38, w: 0.67, wb: 0.45, t: 0.18, b: 0.2, n: 3.8, nb: 2.4 },
      { x: -0.6, y: 0.35, w: 0.55, wb: 0.37, t: 0.16, b: 0.22, n: 3.2, nb: 2.5 },
      { x: -1.0, y: 0.31, w: 0.41, wb: 0.29, t: 0.12, b: 0.2, n: 3, nb: 2.5 },
      { x: -1.4, y: 0.28, w: 0.27, wb: 0.21, t: 0.09, b: 0.18, n: 3, nb: 2.5 },
      { x: -1.78, y: 0.27, w: 0.16, wb: 0.14, t: 0.06, b: 0.15, n: 3, nb: 2.5 },
    ]
    add(loft(pods, podPaint, 12, 80), M.paint, body, true).userData.hollow = true
    // inlet mouths: dark recessed ovals at the front of each pod
    const mouth = new THREE.Shape()
    mouth.absellipse(0, 0, 0.19, 0.075, 0, Math.PI * 2, false, 0)
    const mouthG = new THREE.ShapeGeometry(mouth, 32).rotateY(Math.PI / 2)
    for (const s of [-1, 1]) {
      add(mouthG, M.satin, body).position.set(0.445, 0.43, s * 0.47)
      const lip = new THREE.EllipseCurve(0, 0, 0.195, 0.08, 0, Math.PI * 2, false, 0)
      const pts = lip.getPoints(64).map((p) => V(0.447, 0.43 + p.y, s * 0.47 + p.x))
      add(pipe(new THREE.CatmullRomCurve3(pts, true), { r: 0.007, tubular: 96, radial: 8 }), M.blue, body)
    }
    this.anchors.pod = [body, V(0.1, 0.62, 0.62)]
    // airbox intake above the driver's head and the camera pod on top
    const airbox = new THREE.Shape()
    airbox.absellipse(0, 0, 0.09, 0.075, 0, Math.PI * 2, false, 0)
    add(new THREE.ShapeGeometry(airbox, 32).rotateY(Math.PI / 2), M.satin, body).position.set(-0.47, 0.8, 0)
    add(new RoundedBoxGeometry(0.16, 0.03, 0.1, 2, 0.01), M.satin, body).position.set(-0.6, 0.905, 0)
    // cockpit: coaming pads, seat back, steering wheel with its display
    add(pipe(new THREE.CatmullRomCurve3([V(0.5, 0.6, 0), V(0.35, 0.62, 0.2), V(0, 0.63, 0.22), V(-0.3, 0.64, 0.2), V(-0.38, 0.63, 0), V(-0.3, 0.64, -0.2), V(0, 0.63, -0.22), V(0.35, 0.62, -0.2)], true), { r: 0.022, tubular: 120, radial: 10 }), M.satin, body)
    const wheelG = new RoundedBoxGeometry(0.05, 0.14, 0.27, 3, 0.02)
    const sw = add(wheelG, M.satin, body)
    sw.position.set(0.33, 0.62, 0)
    sw.rotation.z = 0.5
    const disp = add(new THREE.PlaneGeometry(0.08, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1).multiplyScalar(1.4) }), body)
    disp.position.set(0.305, 0.635, 0)
    disp.rotation.y = -Math.PI / 2
    disp.rotation.x = 0.5
    // the driver: helmet with a dark visor, head restraint pads
    const helmet = add(new THREE.SphereGeometry(0.135, 48, 32), M.white, body)
    helmet.scale.set(1.12, 1, 0.98)
    helmet.position.set(0.0, 0.73, 0)
    helmet.userData.hollow = true
    const visor = add(new THREE.SphereGeometry(0.137, 48, 16, Math.PI - 0.9, 1.8, 1.15, 0.45), M.visor, body)
    visor.scale.copy(helmet.scale)
    visor.position.copy(helmet.position)
    const stripe = add(new THREE.TorusGeometry(0.136, 0.012, 8, 64, Math.PI), M.blue, body)
    stripe.scale.copy(helmet.scale)
    stripe.position.copy(helmet.position)
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.3, 0.1, 0.08, 3, 0.03), M.satin, body).position.set(-0.12, 0.66, s * 0.17)
    // halo: titanium hoop around the cockpit on a centre pillar
    const halo = part(0, 1.2)
    add(pipe(new THREE.CatmullRomCurve3([V(-0.37, 0.61, 0.25), V(-0.3, 0.76, 0.265), V(0, 0.81, 0.265), V(0.3, 0.81, 0.21), V(0.48, 0.8, 0.09), V(0.52, 0.8, 0), V(0.48, 0.8, -0.09), V(0.3, 0.81, -0.21), V(0, 0.81, -0.265), V(-0.3, 0.76, -0.265), V(-0.37, 0.61, -0.25)]), { r: 0.024, tubular: 160, radial: 14 }), M.paint, halo)
    add(pipe(new THREE.CatmullRomCurve3([V(0.51, 0.8, 0), V(0.58, 0.72, 0), V(0.64, 0.62, 0)]), { r: 0.022, tubular: 30, radial: 12 }), M.paint, halo)
    this.anchors.halo = [halo, V(0.2, 0.84, 0.2)]
    // mirrors on stalks
    for (const s of [-1, 1]) {
      add(strut(V(0.3, 0.55, s * 0.4), V(0.36, 0.7, s * 0.5), 0.04, 0.012), M.carbon, body)
      const h = add(new RoundedBoxGeometry(0.06, 0.06, 0.16, 3, 0.02), M.paint, body)
      h.position.set(0.36, 0.72, s * 0.52)
      add(new THREE.PlaneGeometry(0.13, 0.045), M.mirror, body).position.set(0.328, 0.72, s * 0.52)
      ;(body.children[body.children.length - 1] as THREE.Mesh).rotation.y = -Math.PI / 2
    }
    this.anchors.cockpit = [body, V(0.2, 0.78, 0.0)]

    /* ---------------- floor, tunnels and diffuser ---------------- */
    const floor = part(0, -0.35)
    const outline: P2[] = [[1.3, 0.12], [1.2, 0.34], [0.95, 0.5], [0.55, 0.8], [-1.05, 0.8], [-1.3, 0.62], [-1.95, 0.6], [-2.2, 0.5], [-2.2, -0.5], [-1.95, -0.6], [-1.3, -0.62], [-1.05, -0.8], [0.55, -0.8], [0.95, -0.5], [1.2, -0.34], [1.3, -0.12]]
    const fl = plate(outline, 0.014, 0.002)
    fl.rotateX(Math.PI / 2)
    fl.translate(0, 0.055, 0)
    add(fl, M.carbon, floor, true)
    // edge wing along the floor sides and the plank underneath
    for (const s of [-1, 1]) {
      const e = plate([[0.5, 0], [-1.0, 0], [-1.0, 0.03], [0.4, 0.05]], 0.008)
      e.translate(0, 0.06, s * 0.8)
      add(e, M.carbon, floor)
    }
    add(new THREE.BoxGeometry(2.8, 0.01, 0.3), M.satin, floor).position.set(-0.3, 0.043, 0)
    // tunnel fences under the front of the floor
    for (const z of [-0.5, -0.36, -0.22, 0.22, 0.36, 0.5]) {
      const f = plate([[1.15, 0], [0.4, 0], [0.4, -0.012], [1.0, -0.03]], 0.006)
      f.translate(0, 0.05, z)
      add(f, M.carbon, floor)
    }
    // diffuser: the floor sweeps up behind the rear axle, split by strakes
    const dif = new THREE.PlaneGeometry(0.95, 1.0, 12, 1)
    const dp = dif.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < dp.count; i++) {
      const u = (dp.getX(i) + 0.475) / 0.95 // 0 front .. 1 rear
      dp.setXYZ(i, -1.3 - u * 0.95, 0.05 + 0.26 * Math.pow(u, 1.6), dp.getY(i) * 1.05)
    }
    dif.computeVertexNormals()
    add(dif, M.carbon, floor, true)
    for (const z of [-0.5, -0.3, -0.12, 0.12, 0.3, 0.5]) {
      const st = plate([[-1.35, 0.05], [-2.25, 0.05], [-2.25, 0.32], [-1.9, 0.13]], 0.008)
      st.translate(0, 0, z)
      add(st, M.carbon, floor)
    }
    this.anchors.floor = [floor, V(-0.4, 0.05, 0.8)]
    this.anchors.diffuser = [floor, V(-2.2, 0.28, 0.4)]

    /* ---------------- front wing: mainplane and three flaps, the top two move ---------------- */
    const fw = part(1.1, 0)
    const f1 = foil(0.1, 0.06), f2 = foil(0.09, 0.07)
    const S = 0.9
    const lift = (z: number) => { const u = Math.max(0, (Math.abs(z) - 0.5) / (S - 0.5)); return u * u }
    add(wing(-S, S, 60, (z) => ({ x: 2.88 - 0.14 * (Math.abs(z) / S) ** 2, y: 0.075 + 0.03 * lift(z), c: 0.3 - 0.06 * lift(z), a: 0.06 + 0.1 * lift(z) }), f1), M.carbon, fw, true)
    const flaps: [number, number, number, number][] = [[0.17, 0.3, 0.035, 0], [0.14, 0.52, 0.07, 1], [0.12, 0.75, 0.1, 2]]
    let lx = 2.88 - 0.25, ly = 0.075 + 0.025
    for (const [c, ang, dy, moves] of flaps) {
      const g = new THREE.Group()
      g.position.set(lx, ly + dy, 0)
      fw.add(g)
      add(wing(-S + 0.02, S - 0.02, 60, (z) => ({ x: -0.14 * (Math.abs(z) / S) ** 2 - 0.09 * lift(z), y: 0.12 * lift(z), c: c - 0.03 * lift(z), a: ang + 0.25 * lift(z) }), f2), moves === 2 ? M.blue : M.carbon, g, true)
      if (moves) this.fwFlaps.push({ g, k: ang })
      lx -= c * 0.7
      ly += c * Math.sin(ang) * 0.6
    }
    // endplates with the lab's name
    for (const s of [-1, 1]) {
      const ep = plate([[2.93, 0.03], [2.36, 0.03], [2.3, 0.13], [2.42, 0.29], [2.72, 0.27], [2.92, 0.12]], 0.008)
      ep.translate(0, 0, s * S)
      add(ep, M.carbon, fw, true)
      const foot = plate([[2.95, 0.02], [2.2, 0.02], [2.2, 0.035], [2.9, 0.04]], 0.05)
      foot.translate(0, 0, s * (S - 0.02))
      add(foot, M.carbon, fw)
    }
    this.anchors.frontWing = [fw, V(2.6, 0.3, 0.7)]

    /* ---------------- rear wing: mainplane and the active flap on a swan neck pylon ---------------- */
    const rw = part(-0.9, 0.5)
    const RS = 0.5
    const tip = (z: number) => { const u = Math.max(0, (Math.abs(z) - 0.36) / (RS - 0.36)); return u * u }
    this.rwMain.position.set(0, 0, 0)
    rw.add(this.rwMain)
    add(wing(-RS, RS, 50, (z) => ({ x: -2.15, y: 0.78 - 0.1 * tip(z), c: 0.3, a: 0.12 + 0.2 * tip(z) }), foil(0.11, 0.07)), M.carbon, this.rwMain, true)
    this.rwFlap.position.set(-2.4, 0.84, 0)
    rw.add(this.rwFlap)
    add(wing(-RS + 0.01, RS - 0.01, 50, (z) => ({ x: 0, y: -0.14 * tip(z), c: 0.2, a: 0.62 + 0.2 * tip(z) }), foil(0.09, 0.06)), M.blue, this.rwFlap, true)
    for (const s of [-1, 1]) {
      const ep = plate([[-2.1, 0.64], [-2.52, 0.62], [-2.62, 0.78], [-2.6, 0.98], [-2.34, 1.01], [-2.12, 0.9]], 0.01)
      ep.translate(0, 0, s * (RS + 0.006))
      add(ep, M.carbon, rw, true)
      const lip = plate([[-2.34, 1.0], [-2.6, 0.97], [-2.6, 0.99], [-2.34, 1.015]], 0.014)
      lip.translate(0, 0, s * (RS + 0.006))
      add(lip, M.blue, rw)
    }
    add(pipe(new THREE.CatmullRomCurve3([V(-2.15, 0.46, 0), V(-2.2, 0.62, 0), V(-2.1, 0.8, 0)]), { r: 0.022, tubular: 24, radial: 10 }), M.carbon, rw)
    // actuator pod for the flap
    add(new RoundedBoxGeometry(0.12, 0.05, 0.05, 2, 0.015), M.satin, rw).position.set(-2.3, 0.9, 0)
    this.anchors.rearWing = [rw, V(-2.35, 1.02, 0.4)]
    // rain light and exhaust
    this.rain = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.03).multiplyScalar(2.2) })
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.12), this.rain)
    rl.position.set(-2.415, 0.36, 0)
    rl.layers.set(LAYER_GLOW)
    rw.add(rl)
    add(revolve([[0.045, 0], [0.05, 0], [0.05, 0.22], [0.045, 0.22]], 32).rotateZ(Math.PI / 2).translate(-2.2, 0.5, 0), M.hot, rw)

    /* ---------------- wheels, brakes and suspension ---------------- */
    const tyreGeo = (R: number, w: number) => {
      const h = w / 2
      return revolve([[0.232, -h * 0.82], [0.26, -h * 0.97], [0.3, -h - 0.006], [R - 0.045, -h], [R - 0.012, -h + 0.018], [R, -h + 0.05], [R, h - 0.05], [R - 0.012, h - 0.018], [R - 0.045, h], [0.3, h + 0.006], [0.26, h * 0.97], [0.232, h * 0.82]], 128, 50).rotateX(Math.PI / 2)
    }
    const band = new THREE.MeshStandardMaterial({ color: 0xd9a90f, roughness: 0.55 })
    const spokeG = new THREE.BoxGeometry(0.022, 0.15, 0.03)
    const wheel = (x: number, z: number, R: number, w: number, front: boolean) => {
      const s = Math.sign(z)
      const g = part(0, 0, s * 0.7)
      const steer = new THREE.Group()
      steer.position.set(x, R, z)
      g.add(steer)
      const spin = new THREE.Group()
      steer.add(spin)
      add(tyreGeo(R, w), M.tyre, spin, true)
      for (const side of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.RingGeometry(0.289, 0.296, 128), band)
        b.position.z = side * (w / 2 + 0.0075)
        b.rotation.y = side > 0 ? 0 : Math.PI
        spin.add(b)
      }
      add(revolve([[0.21, -w / 2 + 0.02], [0.229, -w / 2 + 0.02], [0.229, w / 2 - 0.02], [0.21, w / 2 - 0.02]], 96), M.rim, spin).rotation.x = Math.PI / 2
      // outer face: ten spokes and a centre lock nut
      const face = s * (w / 2 - 0.03)
      for (let k = 0; k < 10; k++) {
        const sp = add(spokeG, M.rim, spin)
        const a = (k / 10) * Math.PI * 2
        sp.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, face)
        sp.rotation.z = a - Math.PI / 2
      }
      add(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 6).rotateX(Math.PI / 2), M.gold, spin).position.z = face + s * 0.02
      add(new THREE.TorusGeometry(0.222, 0.01, 8, 96), M.rim, spin).position.z = face
      // carbon brake disc and the duct drum behind it
      const disc = add(revolve([[0.1, -0.016], [front ? 0.164 : 0.14, -0.016], [front ? 0.164 : 0.14, 0.016], [0.1, 0.016]], 64).rotateX(Math.PI / 2), this.discMat, spin)
      disc.position.z = -s * 0.03
      add(revolve([[0.17, -w / 2 + 0.03], [0.195, -w / 2 + 0.03], [0.195, w / 2 - 0.08], [0.17, w / 2 - 0.08]], 48).rotateX(Math.PI / 2), M.carbon, steer).position.z = -s * 0.02
      this.wheels.push({ spin, steer, front })
      return g
    }
    const susp = (ax: number, R: number, zw: number, front: boolean) => {
      for (const s of [-1, 1]) {
        const g = part(0, 0, s * 0.45)
        const zi = s * (front ? 0.2 : 0.16), zo = s * (zw - 0.12)
        const yT = R + 0.13, yB = R - 0.13
        for (const dx of [-0.2, 0.2]) {
          add(strut(V(ax + dx, yT + 0.08, zi), V(ax, yT, zo), 0.055, 0.014), M.carbon, g)
          add(strut(V(ax + dx * 1.3, yB + 0.05, zi), V(ax, yB, zo), 0.055, 0.014), M.carbon, g)
        }
        add(strut(V(ax + 0.02, yB + 0.02, zo - s * 0.04), V(ax - 0.05, yT + 0.2, zi), 0.04, 0.02), M.carbon, g)
        add(strut(V(ax + 0.12, R, zi), V(ax + 0.1, R, zo), 0.03, 0.012), M.carbon, g)
        add(new RoundedBoxGeometry(0.12, 0.3, 0.06, 2, 0.02), M.ti, g).position.set(ax, R, zo)
        // driveshafts at the back
        if (!front) add(new THREE.CylinderGeometry(0.022, 0.022, zw - 0.2, 12).rotateX(Math.PI / 2), M.ti, g).position.set(ax, R, s * (zw / 2 + 0.05))
      }
    }
    const wF = [wheel(F1.axF, F1.zf, F1.Rf, F1.wf, true), wheel(F1.axF, -F1.zf, F1.Rf, F1.wf, true)]
    wheel(F1.axR, F1.zr, F1.Rr, F1.wr, false)
    wheel(F1.axR, -F1.zr, F1.Rr, F1.wr, false)
    susp(F1.axF, F1.Rf, F1.zf, true)
    susp(F1.axR, F1.Rr, F1.zr, false)
    this.anchors.tyre = [wF[0], V(F1.axF, F1.Rf + 0.4, F1.zf)]
    this.anchors.brake = [wF[0], V(F1.axF - 0.12, F1.Rf, F1.zf + 0.2)]

    /* ---------------- the power unit and everything under the bodywork ---------------- */
    const pu = part(0, 0)
    this.pu = new F1Internals({ add: (g, m, p) => add(g, m, p), pu, cut, M, anchors: this.anchors })
    // radiators in the sidepods: tilted cores
    for (const s of [-1, 1]) {
      const r = add(new THREE.BoxGeometry(0.44, 0.24, 0.06), M.rad, pu)
      r.position.set(0.0, 0.4, s * 0.4)
      r.rotation.set(0, s * 0.2, s * -0.15)
    }
    this.inner.position.set(-0.9, 0.75, 0.7)
    this.root.add(this.inner)
    this.anchors.radiator = [pu, V(0.02, 0.5, -0.46)]

    /* ---------------- energy flows through the power unit ---------------- */
    const pline = (pts: THREE.Vector3[], color: number, emph: { value: number }) => {
      const m = glowLineMaterial(cut, { color, emph, rate: F1_FLOW.rate, speed: 1.4, scale: 0.12, base: 0.3 })
      const mesh = new THREE.Mesh(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.012, tubular: 80, radial: 6 }), m)
      mesh.layers.set(LAYER_GLOW)
      mesh.userData.fluid = 'glow'
      this.root.add(mesh)
      this.powerLines.push(mesh)
    }
    // deploy: battery to control electronics to the motor, crank, gearbox and the rear wheels
    pline([V(-0.45, 0.17, -0.05), V(-0.3, 0.17, -0.1), V(-0.25, 0.19, -0.16), V(-0.5, 0.21, -0.19), V(-0.66, 0.22, -0.13), V(-0.77, 0.2, -0.02), V(-1.2, 0.2, -0.01), V(-1.5, 0.26, -0.02), V(-1.7, 0.33, -0.05), V(-1.7, F1.Rr, -0.6)], 0x49c8ff, F1_FLOW.power)
    // fuel: tank to the rail, then the exhaust heat out through the turbo and the tailpipe
    pline([V(-0.53, 0.26, -0.02), V(-0.62, 0.5, -0.04), V(-0.8, 0.46, -0.06), V(-0.96, 0.44, -0.12)], 0xffa13a, F1_FLOW.power)
    pline([V(-1.2, 0.33, -0.2), V(-1.33, 0.39, -0.04), V(-1.38, 0.4, -0.01), V(-1.7, 0.47, -0.01), V(-2.3, 0.5, -0.01)], 0xff5a1a, F1_FLOW.power)
    // air: airbox to the compressor, intercooler, plenum
    pline([V(-0.47, 0.8, -0.01), V(-0.8, 0.7, -0.02), V(-1.2, 0.46, -0.03), V(-1.2, 0.44, -0.04), V(-0.4, 0.4, -0.36), V(-0.1, 0.37, -0.34), V(-0.4, 0.42, -0.2), V(-0.9, 0.5, -0.03)], 0x9fd8ff, F1_FLOW.power)
    // harvest under braking: rear wheels back through the motor into the battery
    pline([V(-1.7, F1.Rr, -0.62), V(-1.7, 0.3, -0.12), V(-1.2, 0.22, -0.02), V(-0.77, 0.2, -0.03), V(-0.66, 0.22, -0.13), V(-0.4, 0.2, -0.2), V(-0.25, 0.16, -0.14), V(-0.45, 0.15, -0.06)], 0x5aff9a, F1_FLOW.harvest)

    /* ---------------- air ---------------- */
    const airM = glowLineMaterial(cut, { color: 0x9fd8ff, emph: F1_FLOW.air, rate: F1_FLOW.rate, speed: 2.4, scale: 0.35, base: 0.18 })
    const underM = glowLineMaterial(cut, { color: 0x7a8cff, emph: F1_FLOW.under, rate: F1_FLOW.rate, speed: 3.6, scale: 0.35, base: 0.22 })
    const vortM = glowLineMaterial(cut, { color: 0xd4f0ff, emph: F1_FLOW.vortex, rate: F1_FLOW.rate, speed: 2.4, scale: 0.2, base: 0.15 })
    const flow = (pts: [number, number, number][], m: THREE.Material, r = 0.006) => {
      for (const s of [1, -1]) {
        const c = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x, y, z * s)))
        const mesh = new THREE.Mesh(pipe(c, { r, tubular: 160, radial: 5 }), m)
        mesh.layers.set(LAYER_GLOW)
        mesh.userData.fluid = 'glow'
        this.root.add(mesh)
        this.flows.push(mesh)
        if (pts.every((p) => p[2] === 0)) break
      }
    }
    // over the top: lifted over the cockpit and the airbox, then thrown up by the rear wing
    for (const [z, h] of [[0, 0], [0.14, 0.02], [0.3, -0.06], [0.45, -0.14]] as const)
      flow([[5, 0.62 + h, z], [3.2, 0.5 + h, z], [2.2, 0.62 + h, z], [0.6, 0.86 + h, z], [-0.5, 1.02 + h, z], [-1.6, 1.02 + h, z * 0.9], [-2.3, 1.06 + h, z * 0.85], [-3.0, 1.3 + h, z * 0.8], [-4.4, 1.45 + h, z * 0.8]], airM)
    // front wing: turned outward round the front tyre, then drawn in along the sidepod undercut
    for (const [z, y] of [[0.62, 0.2], [0.74, 0.26]] as const)
      flow([[5, y, z * 0.9], [3.1, y, z], [2.4, y + 0.08, z + 0.12], [1.7, y + 0.1, 1.08], [1.0, y + 0.05, 1.0], [0.2, 0.3, 0.86], [-0.8, 0.26, 0.62], [-1.5, 0.3, 0.48], [-2.3, 0.45, 0.4], [-3.2, 0.8, 0.45], [-4.4, 1.0, 0.5]], airM)
    // under the floor: into the tunnels, fastest at the throat, up the diffuser and into the wing's wake
    for (const z of [0.2, 0.38, 0.55])
      flow([[5, 0.17, z * 0.6], [3.2, 0.14, z * 0.7], [1.6, 0.1, z], [1.1, 0.03, z], [-0.5, 0.025, z], [-1.3, 0.03, z * 0.95], [-2.2, 0.26, z * 0.9], [-3.2, 0.7, z * 0.85], [-4.4, 1.0, z * 0.8]], underM)
    // cooling air into the sidepods
    flow([[5, 0.43, 0.5], [2.4, 0.43, 0.52], [0.9, 0.43, 0.5], [0.44, 0.43, 0.47], [0.3, 0.42, 0.46]], airM)
    // tip vortices off the rear wing and the front wing endplates
    const helix = (x0: number, x1: number, y: number, z: number, r0: number, r1: number, turns: number, dz = 0) => {
      const pts: [number, number, number][] = []
      for (let i = 0; i <= 80; i++) {
        const u = i / 80
        const a = u * turns * Math.PI * 2
        const r = r0 + (r1 - r0) * u
        pts.push([x0 + (x1 - x0) * u, y + Math.cos(a) * r, z + dz * u + Math.sin(a) * r])
      }
      return pts
    }
    flow(helix(-2.55, -4.6, 0.95, 0.52, 0.015, 0.12, 5, -0.05), vortM, 0.005)
    flow(helix(2.3, -0.6, 0.26, 0.92, 0.015, 0.09, 6, 0.2), vortM, 0.005)
    this.anchors.vortex = [this.root, V(-3.3, 1.02, 0.55)]
    this.anchors.under = [this.root, V(-0.4, 0.02, 0.6)]
  }

  /** After the cut has collected its meshes: skins are open shells, so no caps on them. */
  hollowSkins() {
    this.root.traverse((o) => {
      if (!o.userData.hollow) return
      const m = o as THREE.Mesh
      this.cut.meshes.delete(m)
      m.geometry.clearGroups()
      m.material = (m.userData.front ?? m.material) as THREE.Material
    })
  }

  /** Swap every aero skin for the pressure map, or back. */
  setPressure(on: boolean) {
    if (on === this.pressureOn) return
    this.pressureOn = on
    for (const m of this.aero) {
      const skin = m.userData.skin as THREE.Material
      if (on) {
        m.userData.front = this.pressure
        m.material = this.pressure
      } else {
        m.userData.front = skin
        m.material = skin
      }
    }
    // re-register with the cut so caps follow the right material
    const was = this.cut.capsOn
    this.cut.setCaps(!was)
    this.cut.setCaps(was)
  }

  /**
   * explode 0..1, wheel angle, open 0..1 (straight mode: wings flat),
   * brake 0..1 (disc heat), steer radians, t seconds.
   */
  update(explode: number, wheelAng: number, open: number, brake: number, steer: number, t: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    for (const w of this.wheels) {
      w.spin.rotation.z = -wheelAng
      w.steer.rotation.y = w.front ? steer : 0
    }
    // active aero: flaps rotate flat in straight mode
    for (const f of this.fwFlaps) f.g.rotation.z = open * 0.32
    this.rwFlap.rotation.z = open * 0.52
    this.discMat.emissiveIntensity = brake * 2.2
    this.pu.update(t * 14, t * 31)
    this.rain.color.setRGB(1, 0.05, 0.03).multiplyScalar(brake > 0.3 ? 2.6 : 0.7)
    void t
    ;(this.pressure.uniforms.uOpen as { value: number }).value = open
    this.root.updateWorldMatrix(true, false)
    this.inv.value.copy(this.root.matrixWorld).invert()
  }
}

/* ---------------- the wind tunnel bay: rolling road, smoke rake, studio lights ---------------- */

export class F1Bay {
  readonly group = new THREE.Group()
  readonly belt: THREE.Texture
  readonly lights: THREE.Light[] = []
  readonly softbox: THREE.Mesh

  constructor(at: THREE.Vector3) {
    const G = this.group
    G.position.copy(at)
    const deck = surf({ color: 0x16181c, metalness: 0.4, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, detail: 2, name: 'f1-deck' })
    const frame = surf({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35, detail: 4, name: 'f1-frame' })
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, cast = true) => {
      const o = new THREE.Mesh(g, m)
      o.position.set(x, y, z)
      o.castShadow = cast
      o.receiveShadow = true
      G.add(o)
      return o
    }
    add(new THREE.BoxGeometry(11.5, 0.1, 5.4), deck, -0.4, 0.05, 0, false)
    // the belt: a moving steel band the car sits on, ribbed so its motion reads
    const c = document.createElement('canvas')
    c.width = 64; c.height = 512
    const g = c.getContext('2d')!
    g.fillStyle = '#3a3d42'
    g.fillRect(0, 0, 64, 512)
    for (let i = 0; i < 512; i += 32) { g.fillStyle = '#2c2f33'; g.fillRect(0, i, 64, 3) }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * 64, Math.random() * 512, 1, 6 + Math.random() * 14) }
    this.belt = new THREE.CanvasTexture(c)
    this.belt.wrapS = this.belt.wrapT = THREE.RepeatWrapping
    this.belt.repeat.set(1, 4)
    this.belt.colorSpace = THREE.SRGBColorSpace
    const beltM = surf({ color: 0xffffff, map: this.belt, metalness: 0.7, roughness: 0.38, name: 'f1-belt' })
    const bg = new THREE.PlaneGeometry(2.2, 8.2).rotateX(-Math.PI / 2).rotateY(Math.PI / 2)
    add(bg, beltM, 0, 0.102, 0, false)
    for (const z of [-1.14, 1.14]) add(new THREE.BoxGeometry(8.4, 0.03, 0.06), frame, 0, 0.115, z, false)
    // smoke rake ahead of the car: a frame of nozzles the streamlines leave from
    for (const z of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.06, 1.6, 0.06), frame, 5.2, 0.9, z)
    add(new THREE.BoxGeometry(0.06, 0.06, 2.46), frame, 5.2, 1.68, 0)
    for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.04, 0.02, 2.4), frame, 5.17, 0.2 + k * 0.17, 0)
    // an overhead softbox for long reflections along the bodywork
    this.softbox = add(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.95).multiplyScalar(2.2) }), -0.2, 4.4, 0.2, false)
    this.softbox.rotation.x = Math.PI / 2
    add(new THREE.BoxGeometry(6.6, 0.08, 1.8), frame, -0.2, 4.47, 0.2, false)
    const key = new THREE.SpotLight(0xfff4e8, 120, 14, 0.75, 0.6, 2)
    key.position.set(-0.2, 4.3, 0.4)
    key.target.position.set(-0.2, 0, 0.2)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.camera.near = 1.5
    key.shadow.camera.far = 7
    G.add(key, key.target)
    const rim = new THREE.SpotLight(0x9cc4ff, 60, 14, 0.7, 0.7, 2)
    rim.position.set(-4.4, 2.6, -3.0)
    rim.target.position.set(0, 0.4, 0)
    G.add(rim, rim.target)
    const fill = new THREE.SpotLight(0xffe2c4, 40, 14, 0.8, 0.8, 2)
    fill.position.set(3.2, 2.2, 4.0)
    fill.target.position.set(0, 0.4, 0)
    G.add(fill, fill.target)
    this.lights.push(key, rim, fill)
    // a dark partition behind the bay so the car stands against a clean wall
    const wallM = surf({ color: 0x15171b, metalness: 0.2, roughness: 0.7, detail: 2, name: 'f1-wall' })
    add(new THREE.BoxGeometry(0.2, 5.2, 6.4), wallM, -6.6, 2.6, -1.8, false)
    const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.7, 1).multiplyScalar(1.6) })
    for (let k = 0; k < 6; k++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.03, 4.6, 0.02), led)
      l.position.set(-6.49, 2.6, -4.6 + k * 1.1)
      l.layers.set(LAYER_GLOW)
      G.add(l)
    }
    // light strips along the deck edges
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.7, 1).multiplyScalar(2.0) })
    for (const z of [-2.68, 2.68]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.015, 0.03), strip)
      s.position.set(-0.4, 0.1, z)
      s.layers.set(LAYER_GLOW)
      G.add(s)
    }
  }
}
