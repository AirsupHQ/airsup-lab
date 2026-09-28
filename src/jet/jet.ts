import * as THREE from 'three'
import { CutState } from '../core/cut'
import { surf } from '../core/materials'
import { revolve, pipe, boltGeo, P2 } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { GLSL_NOISE, NOISE3D } from '../core/noise'
import { wing, foil, carbonTexture } from '../f1/f1'

/**
 * An afterburning low bypass turbofan at full size, after the public outline
 * of the Pratt & Whitney F135 (F-35): 5.6 m long, 1.17 m across, inlet guide
 * vanes, a three stage fan, six stage compressor, annular combustor, one high
 * and two low pressure turbine stages, a lobed mixer, an afterburner and a
 * convergent divergent nozzle with a serrated edge. Built along its own +y
 * axis (fan face at y = 0), turned to lie along world +x. Local +x is down.
 */
export const JET = {
  length: 5.6,
  R: 0.585,
  dry: 125, // kN, maximum without afterburner (about 28,000 lbf)
  wet: 191, // kN with afterburner (about 43,000 lbf)
  fuelDry: 3.4, // kg/s at full dry power (estimate)
  fuelWet: 11.5, // kg/s with full afterburner (estimate)
  tit: 1980, // °C turbine inlet at full power (public estimates)
}

/** Stations along the gas path at full dry power: y, °C, bar. Estimates for an engine of this class. */
export const JET_STATIONS: { name: string; y: number; t: number; p: number }[] = [
  { name: 'Inlet', y: -0.1, t: 15, p: 1.0 },
  { name: 'Fan exit', y: 0.8, t: 160, p: 4.2 },
  { name: 'Compressor exit', y: 1.78, t: 620, p: 28 },
  { name: 'Turbine inlet', y: 2.3, t: 1980, p: 27 },
  { name: 'Turbine exit', y: 2.8, t: 880, p: 3.6 },
  { name: 'Afterburner', y: 4.4, t: 2000, p: 3.4 },
]

export const JET_FLOW = {
  time: { value: 0 },
  rate: { value: 1 },
  air: { value: 0.6 },
  core: { value: 0.6 },
  fire: { value: 0.6 },
  heat: { value: 0.0 },
  ab: { value: 0 },
  power: { value: 0.85 },
}

/* ---------------- temperature along the gas path (normalised 0..1 at 2,000 °C) ---------------- */
const GLSL_TEMP = /* glsl */ `
float coreT(float y, float ab, float power) {
  float t = 0.01;
  t = mix(t, 0.08, smoothstep(0.0, 0.8, y));          // fan
  t = mix(t, 0.31, smoothstep(0.95, 1.78, y));        // compressor heats by squeezing
  t = mix(t, 0.99, smoothstep(1.86, 2.2, y));         // combustion
  t = mix(t, 0.44, smoothstep(2.3, 2.8, y));          // turbines take energy out
  t = mix(t, 0.3, smoothstep(2.9, 3.3, y));           // mixed with bypass air
  t = mix(t, mix(0.3, 1.0, ab), smoothstep(3.15, 3.6, y)); // afterburner
  return t * mix(0.55, 1.0, power);
}
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.05);
  vec3 c = mix(vec3(0.12, 0.4, 1.0), vec3(0.4, 0.22, 0.95), smoothstep(0.0, 0.2, t));
  c = mix(c, vec3(0.85, 0.18, 0.2), smoothstep(0.2, 0.42, t));
  c = mix(c, vec3(1.0, 0.45, 0.08), smoothstep(0.42, 0.65, t));
  c = mix(c, vec3(1.0, 0.85, 0.45), smoothstep(0.65, 0.85, t));
  c = mix(c, vec3(1.0, 1.0, 0.95), smoothstep(0.85, 1.0, t));
  return c;
}
`

/** Flow streamlines coloured by the temperature of the gas they carry. */
function flowMaterial(cut: CutState, kind: 0 | 1, emph: { value: number }) {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      attribute float aS;
      varying float vS;
      varying float vY;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <clipping_planes_vertex>
        vS = aS;
        vY = position.y;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      ${GLSL_TEMP}
      varying float vS;
      varying float vY;
      uniform float uTime, uRate, uEmph, uAB, uPower, uKind;
      void main() {
        #include <clipping_planes_fragment>
        float t = uKind < 0.5 ? 0.06 + 0.05 * smoothstep(0.0, 0.8, vY) : coreT(vY, uAB, uPower);
        if (uKind < 0.5) t = mix(t, 0.3 * mix(0.55, 1.0, uPower), smoothstep(2.9, 3.4, vY));
        // gas speeds up through the hot sections: dashes stretch where it is fast
        float speed = 1.0 + 1.5 * t;
        float ph = vS / (0.14 * speed) - uTime * 3.0 * uRate;
        float pulse = pow(0.5 + 0.5 * sin(ph * 6.2831853), 5.0);
        vec3 c = thermal(t) * (0.35 + 1.4 * pulse) * uEmph * (0.6 + 0.8 * t);
        gl_FragColor = vec4(c, 1.0);
      }`,
    uniforms: { uTime: JET_FLOW.time, uRate: JET_FLOW.rate, uEmph: emph, uAB: JET_FLOW.ab, uPower: JET_FLOW.power, uKind: { value: kind } },
    clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  m.clippingPlanes = cut.planes
  m.clipIntersection = cut.intersect
  return m
}

/** The gas path as a thermal image: the annulus between hub and case, coloured by temperature. */
function heatMaterial(cut: CutState) {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vP;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <clipping_planes_vertex>
        vP = position;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_TEMP}
      varying vec3 vP;
      uniform float uTime, uHeat, uAB, uPower;
      void main() {
        #include <clipping_planes_fragment>
        float t = coreT(vP.y, uAB, uPower);
        float n = n3(vec3(atan(vP.z, vP.x) * 0.6, vP.y * 0.8 - uTime * 0.9, length(vP.xz) * 2.0));
        t *= 0.92 + 0.16 * n;
        gl_FragColor = vec4(thermal(t) * (0.12 + 0.6 * t) * uHeat * 0.55, 1.0);
      }`,
    uniforms: { uNoise3D: NOISE3D, uTime: JET_FLOW.time, uHeat: JET_FLOW.heat, uAB: JET_FLOW.ab, uPower: JET_FLOW.power },
    clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
  m.clippingPlanes = cut.planes
  return m
}

/** A thin twisted, cambered blade from hub to tip along +z; y is the engine axis. */
function blade(rHub: number, rTip: number, chord: number, twist: number, th: number, sweep = 0) {
  const nr = 10, nc = 7
  const pos: number[] = [], idx: number[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i <= nr; i++) {
      const u = i / nr
      const r = rHub + (rTip - rHub) * u
      const ang = twist * (0.3 + 0.7 * u)
      const c = chord * (1 - 0.2 * u + 0.15 * Math.sin(u * Math.PI))
      for (let j = 0; j <= nc; j++) {
        const v = j / nc - 0.5
        const camber = 0.09 * c * (1 - 4 * v * v)
        const t = side * th * 0.5 * Math.pow(Math.cos(v * Math.PI), 0.7) + camber
        const ay = v * c * Math.cos(ang) - t * Math.sin(ang) + sweep * u * u
        const az = v * c * Math.sin(ang) + t * Math.cos(ang)
        pos.push(az, ay, r)
      }
    }
  }
  const row = nc + 1, half = (nr + 1) * row
  for (let s = 0; s < 2; s++) for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
    const a = s * half + i * row + j, b = a + 1, c = a + row, d = c + 1
    if (s === 0) idx.push(a, b, c, b, d, c)
    else idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** The lobed mixer: a daisy shaped sheet where bypass air folds into the hot core. */
function mixerGeo(y0: number, y1: number, rIn: number, rOut: number, lobes: number) {
  const ny = 24, nt = lobes * 16
  const pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= ny; i++) {
    const u = i / ny
    const y = y0 + (y1 - y0) * u
    const amp = (rOut - rIn) * 0.5 * Math.pow(u, 1.2)
    const mid = rIn + (rOut - rIn) * 0.5
    for (let j = 0; j <= nt; j++) {
      const a = (j / nt) * Math.PI * 2
      const r = mid + amp * Math.sin(a * lobes)
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r)
    }
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < nt; j++) {
    const a = i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export class JetEngine {
  readonly root = new THREE.Group()
  readonly cut: CutState
  readonly parts: { group: THREE.Object3D; explode: THREE.Vector3 }[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly lp = new THREE.Group()
  readonly hp = new THREE.Group()
  readonly petals: { g: THREE.Group; div: THREE.Group }[] = []
  readonly flows: THREE.Mesh[] = []
  readonly heatMesh: THREE.Mesh
  readonly M: Record<string, THREE.MeshStandardMaterial>
  private burner: THREE.ShaderMaterial
  private abFlame: THREE.ShaderMaterial
  private vsvLevers: THREE.InstancedMesh[] = []

  constructor() {
    this.root.name = 'jet'
    this.cut = new CutState(this.root, 0.75, 0)
    const cut = this.cut
    const cap = 0x6f747b
    const M = (this.M = {
      ti: surf({ color: 0x8f949b, metalness: 1, roughness: 0.3, detail: 10, anisotropy: 0.75, cut, capColor: 0x8a9099, side: THREE.DoubleSide, name: 'jet-titanium' }),
      fanCase: surf({ color: 0xffffff, map: (() => { const t = carbonTexture(); t.repeat.set(1, 1); return t })(), metalness: 0.2, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.2, cut, capColor: 0x2a2c30, name: 'jet-fancase' }),
      ram: surf({ color: 0x3b3835, metalness: 0.2, roughness: 0.78, detail: 20, colorVar: 0.1, cut, capColor: 0x4a4541, side: THREE.DoubleSide, name: 'jet-ram' }),
      tile: surf({ color: 0xffffff, map: (() => {
        const c = document.createElement('canvas'); c.width = c.height = 128
        const g = c.getContext('2d')!
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 96 + Math.floor(Math.random() * 18); g.fillStyle = `rgb(${v},${v + 2},${v - 4})`; g.fillRect(i * 32, j * 32, 32, 32); g.strokeStyle = 'rgba(30,30,30,0.6)'; g.lineWidth = 2; g.strokeRect(i * 32 + 1, j * 32 + 1, 30, 30) }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t
      })(), metalness: 0.1, roughness: 0.62, detail: 8, cut, capColor: 0x5a5c58, side: THREE.DoubleSide, emissive: 0xff4a10, emissiveIntensity: 0, name: 'jet-tile' }),
      innerFlap: surf({ color: 0xa9a49c, metalness: 0.55, roughness: 0.5, detail: 30, colorVar: 0.08, streaks: 0.2, cut, capColor: 0x8a8680, side: THREE.DoubleSide, emissive: 0xff5a14, emissiveIntensity: 0, name: 'jet-innerflap' }),
      case: surf({ color: 0x80868e, metalness: 1, roughness: 0.34, detail: 3, roughVar: 0.25, colorVar: 0.05, anisotropy: 0.4, cut, capColor: cap, name: 'jet-case' }),
      inco: surf({ color: 0x8e8479, metalness: 1, roughness: 0.38, detail: 6, colorVar: 0.08, roughVar: 0.3, cut, capColor: 0x7a6e64, tint: { y0: 1.9, y1: 3.0, a: 0x8a8278, b: 0x9a7e62, c: 0x6d6a80, strength: 0.45 }, name: 'jet-inconel' }),
      heatCase: surf({ color: 0x7a7066, metalness: 1, roughness: 0.36, detail: 4, streaks: 0.25, colorVar: 0.08, cut, capColor: cap, tint: { y0: 2.9, y1: 5.6, a: 0xb89a5a, b: 0x6b4c7a, c: 0x4a5c80, strength: 0.75 }, name: 'jet-heatcase' }),
      hot: surf({ color: 0x8c7f76, metalness: 1, roughness: 0.3, detail: 6, cut, capColor: 0x8a6a58, side: THREE.DoubleSide, tint: { y0: 2.2, y1: 2.8, a: 0x7a6aa0, b: 0xa08070, c: 0x8e8a86, strength: 0.45 }, emissive: 0xff5a1a, emissiveIntensity: 0, name: 'jet-hot' }),
      liner: surf({ color: 0x9a8f86, metalness: 1, roughness: 0.4, detail: 26, bump: 0.0009, cut, capColor: cap, emissive: 0xff6a20, emissiveIntensity: 0, name: 'jet-liner' }),
      nozzle: surf({ color: 0x3a3836, metalness: 0.55, roughness: 0.55, detail: 5, streaks: 0.35, colorVar: 0.1, cut, capColor: cap, emissive: 0xff4a10, emissiveIntensity: 0, side: THREE.DoubleSide, name: 'jet-nozzle' }),
      dark: surf({ color: 0x1b1d21, metalness: 0.6, roughness: 0.45, detail: 3, cut, capColor: 0x6a7079, name: 'jet-dark' }),
      gold: surf({ color: 0xc9a045, metalness: 1, roughness: 0.28, detail: 8, cut, capColor: 0xd9b25e, name: 'jet-gold' }),
      steel: surf({ color: 0xa4a8ae, metalness: 1, roughness: 0.42, detail: 8, anisotropy: 0.6, cut, capColor: 0xd0d3d8, name: 'jet-steel' }),
      hose: surf({ color: 0x2a2c30, metalness: 0.2, roughness: 0.6, detail: 30, bump: 0.0006, cut, capColor: 0x55585e, name: 'jet-hose' }),
      spinner: surf({ color: 0x1d1f23, metalness: 0.8, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, cut, capColor: cap, name: 'jet-spinner' }),
      bolt: surf({ color: 0x6a6e75, metalness: 0.9, roughness: 0.6, cut, capColor: 0x6a6e75, name: 'jet-bolt' }),
      box: surf({ color: 0x3c4a3a, metalness: 0.4, roughness: 0.5, detail: 4, cut, capColor: 0x8a9096, name: 'jet-box' }),
    })
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const part = (dy: number, dx = 0) => {
      const group = new THREE.Group()
      this.root.add(group)
      this.parts.push({ group, explode: new THREE.Vector3(dx, dy, 0) })
      return group
    }
    const ring = (r0: number, r1: number, y0: number, y1: number, b = 0.004): P2[] => [[r0, y0 + b], [r0 + b, y0], [r1 - b, y0], [r1, y0 + b], [r1, y1 - b], [r1 - b, y1], [r0 + b, y1], [r0, y1 - b]]
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], p: THREE.Object3D) => {
      const im = new THREE.InstancedMesh(g, m, mats.length)
      mats.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.castShadow = true
      im.receiveShadow = true
      p.add(im)
      return im
    }
    const around = (n: number, r: number, y: number, f: (d: THREE.Object3D, a: number) => void = () => {}) => {
      const d = new THREE.Object3D()
      const out: THREE.Matrix4[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        d.position.set(Math.sin(a) * r, y, Math.cos(a) * r)
        d.rotation.set(0, a, 0)
        d.scale.set(1, 1, 1)
        f(d, a)
        d.updateMatrix()
        out.push(d.matrix.clone())
      }
      return out
    }
    const row = (p: THREE.Object3D, n: number, rHub: number, rTip: number, y: number, chord: number, twist: number, m: THREE.Material, th = 0.006, sweep = 0) =>
      inst(blade(rHub, rTip, chord, twist, th, sweep), m, around(n, 0, y), p)
    const disc = (p: THREE.Object3D, r0: number, r1: number, y: number, w: number, m: THREE.Material) => add(revolve(ring(r0, r1, y - w / 2, y + w / 2), 72), m, p)
    const bolt = boltGeo(0.006, 0.007)
    /** a bolted flange around the outside of the engine */
    const flange = (p: THREE.Object3D, y: number, r: number, n: number, m: THREE.Material = M.case) => {
      add(revolve(ring(r - 0.01, r + 0.028, y - 0.014, y + 0.014, 0.004), 128), m, p)
      inst(bolt, M.bolt, around(n, r + 0.019, y + 0.014), p)
      inst(bolt, M.bolt, around(n, r + 0.019, y - 0.014, (d) => d.rotateX(Math.PI)), p)
    }

    /* ---------------- inlet: polished fan case, guide vanes, spinner ---------------- */
    const inlet = part(-1.3)
    add(revolve([[0.545, -0.35], [0.58, -0.38], [0.6, -0.34], [0.59, 0.02], [0.548, 0.02]], 128), M.fanCase, inlet)
    flange(inlet, -0.36, 0.585, 48, M.case)
    // no guide vanes: the air meets the first fan stage directly
    this.anchors.igv = [inlet, new THREE.Vector3(0.42, 0.12, 0.0)]

    const fanCase = part(-0.7)
    add(revolve(ring(0.548, 0.585, 0.02, 0.92), 160), M.fanCase, fanCase)
    for (const y of [0.3, 0.6]) flange(fanCase, y, 0.585, 60, M.case)
    flange(fanCase, 0.92, 0.585, 60, M.case)

    const fanPart = part(-0.95)
    fanPart.add(this.lp)
    add(revolve([[0, -0.38], [0.06, -0.33], [0.13, -0.22], [0.19, -0.08], [0.225, 0.04], [0.225, 0.72], [0, 0.72]], 72), M.spinner, this.lp)
    // three fan stages: wide chord titanium blades with sweep, stator rows between
    const fanRows: [number, number, number, number, number][] = [[0.12, 0.23, 0.17, 22, 0.04], [0.37, 0.25, 0.13, 32, 0.02], [0.6, 0.27, 0.11, 40, 0.01]]
    for (const [y, rh, ch, n, sw] of fanRows) {
      row(this.lp, n, rh, 0.544, y, ch, 0.95, M.ti, 0.008, sw)
      disc(this.lp, 0.1, rh + 0.005, y, 0.06, M.ti)
    }
    for (const y of [0.26, 0.49, 0.72]) row(fanCase, 48, 0.3, 0.546, y, 0.06, -0.55, y < 0.3 ? M.fanCase : M.case, 0.005)
    this.anchors.fan = [fanPart, new THREE.Vector3(0.36, 0.2, 0.0)]

    /* ---------------- front frame, splitter, variable vane compressor ---------------- */
    const core = part(0.0)
    add(revolve([[0.34, 0.8], [0.4, 0.82], [0.43, 0.9], [0.415, 2.9], [0.38, 2.9], [0.38, 0.95]], 128), M.case, core) // splitter and inner bypass wall
    inst(new THREE.BoxGeometry(0.02, 0.14, 0.2).translate(0, 0, 0.47), M.case, around(12, 0, 0.98), core) // front frame struts
    const hpPart = part(0.0)
    hpPart.add(this.hp)
    for (let i = 0; i < 6; i++) {
      const y = 1.02 + i * 0.13
      const rh = 0.215 + i * 0.013, rt = 0.35 - i * 0.012
      disc(this.hp, 0.06, rh, y, 0.06, M.ti)
      row(this.hp, 46 + i * 6, rh, rt, y, 0.06 - i * 0.004, 0.8, M.ti, 0.004)
      row(core, 54 + i * 6, rh + 0.01, rt + 0.006, y + 0.065, 0.04, -0.62, M.case, 0.003)
    }
    add(revolve(ring(0.06, 0.09, 0.95, 2.45), 32), M.ti, this.hp)
    this.anchors.hpc = [core, new THREE.Vector3(0.3, 1.35, 0.0)]

    /* ---------------- combustor: diffuser, dome with swirlers, liners, fuel nozzles ---------------- */
    const comb = part(0.6)
    add(revolve([[0.22, 1.83], [0.26, 1.8], [0.345, 1.8], [0.37, 1.84], [0.37, 2.26], [0.357, 2.26], [0.357, 1.85], [0.34, 1.815], [0.265, 1.815], [0.233, 1.85], [0.233, 2.26], [0.22, 2.26]], 128), M.liner, comb)
    inst(revolve([[0, -0.01], [0.022, -0.01], [0.026, 0.01], [0.012, 0.012], [0, 0.012]], 16).rotateX(Math.PI / 2).rotateY(0), M.steel, around(24, 0.29, 1.83, (d) => d.rotateX(-Math.PI / 2)), comb)
    // fuel nozzle stems through the case, fed from a manifold ring outside
    inst(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 8).translate(0, 0.16, 0).rotateX(Math.PI / 2), M.gold, around(24, 0.29, 1.8), comb)
    this.burner = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <clipping_planes_pars_vertex>
        varying vec3 vP;
        void main() {
          #include <begin_vertex>
          #include <project_vertex>
          #include <clipping_planes_vertex>
          vP = position;
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <clipping_planes_pars_fragment>
        ${GLSL_NOISE}
        varying vec3 vP;
        uniform float uTime, uK;
        void main() {
          #include <clipping_planes_fragment>
          float a = atan(vP.z, vP.x);
          float swirl = n3(vec3(a * 1.2 + vP.y * 3.0 - uTime * 2.4, vP.y * 2.2 - uTime * 1.8, length(vP.xz) * 6.0));
          float jets = pow(0.5 + 0.5 * cos(a * 24.0), 3.0) * smoothstep(2.1, 1.85, vP.y);
          float I = (0.4 + 0.9 * swirl + 0.8 * jets) * smoothstep(2.28, 2.05, vP.y);
          vec3 c = mix(vec3(0.3, 0.45, 1.0), mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.8, 0.45), swirl), smoothstep(1.87, 2.0, vP.y));
          gl_FragColor = vec4(c * I * uK, 1.0);
        }`,
      uniforms: { uNoise3D: NOISE3D, uTime: JET_FLOW.time, uK: { value: 1 } },
      clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.burner.clippingPlanes = cut.planes
    const fz = new THREE.Mesh(revolve([[0.238, 1.86], [0.35, 1.86], [0.35, 2.25], [0.238, 2.25]], 128), this.burner)
    fz.layers.set(LAYER_GLOW)
    fz.userData.fluid = 'glow'
    comb.add(fz)
    this.anchors.combustor = [comb, new THREE.Vector3(0.31, 2.05, 0.0)]

    /* ---------------- turbines: cooled blades, counter rotating spools ---------------- */
    const turb = part(1.0)
    const hpt = new THREE.Group()
    this.hp.add(hpt)
    row(turb, 40, 0.24, 0.37, 2.3, 0.05, 0.75, M.hot, 0.012) // nozzle guide vanes
    disc(hpt, 0.06, 0.245, 2.38, 0.06, M.hot)
    row(hpt, 66, 0.245, 0.365, 2.38, 0.045, -0.8, M.hot, 0.01)
    const lpt = new THREE.Group()
    this.lp.add(lpt)
    for (const [y, rh, rt] of [[2.55, 0.235, 0.39], [2.7, 0.225, 0.41]] as const) {
      disc(lpt, 0.06, rh, y, 0.05, M.hot)
      row(lpt, 72, rh, rt, y, 0.05, -0.85, M.hot, 0.007)
      row(turb, 58, rh, rt + 0.005, y - 0.075, 0.035, 0.7, M.hot, 0.006)
    }
    add(revolve(ring(0.03, 0.055, 0.25, 2.75), 24), M.ti, this.lp)
    add(revolve([[0.37, 2.26], [0.42, 2.26], [0.44, 2.85], [0.41, 2.85]], 128), M.inco, turb)
    // turbine exhaust case struts and the tail cone
    inst(new THREE.BoxGeometry(0.018, 0.12, 0.2).translate(0, 0, 0.32), M.inco, around(10, 0, 2.85), turb)
    add(revolve([[0.2, 2.8], [0.22, 2.8], [0.18, 3.1], [0.08, 3.45], [0.0, 3.52], [0.0, 3.5], [0.07, 3.43], [0.165, 3.1], [0.2, 2.82]], 64), M.inco, turb)
    this.anchors.turbine = [turb, new THREE.Vector3(0.36, 2.5, 0.0)]

    /* ---------------- lobed mixer ---------------- */
    const mix = part(1.35)
    add(mixerGeo(2.88, 3.28, 0.3, 0.52, 14), M.inco, mix).material = M.inco
    this.anchors.mixer = [mix, new THREE.Vector3(0.45, 3.15, 0.0)]

    /* ---------------- outer cases ---------------- */
    const outer = part(0.25, 0)
    add(revolve([[0.548, 0.92], [0.585, 0.92], [0.585, 2.92], [0.548, 2.92]], 160), M.case, outer)
    for (const y of [1.2, 1.55, 1.82, 2.28, 2.92]) flange(outer, y, 0.585, 64, y > 1.8 ? M.inco : M.case)
    // variable stator vane actuation: unison rings with a lever for every vane
    for (let k = 0; k < 3; k++) {
      const y = 1.05 + k * 0.13
      add(revolve(ring(0.605, 0.62, y - 0.008, y + 0.008), 128), M.steel, outer)
      this.vsvLevers.push(inst(new THREE.BoxGeometry(0.008, 0.05, 0.02).translate(0, 0.02, 0.595), M.steel, around(40, 0, y - 0.03), outer))
    }
    // fuel manifold ring and a pigtail to each nozzle
    add(new THREE.TorusGeometry(0.64, 0.012, 8, 160).rotateX(Math.PI / 2).translate(0, 1.72, 0), M.gold, outer)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.sin(a) * 0.64, 1.72, Math.cos(a) * 0.64), new THREE.Vector3(Math.sin(a + 0.05) * 0.66, 1.76, Math.cos(a + 0.05) * 0.66), new THREE.Vector3(Math.sin(a) * 0.6, 1.8, Math.cos(a) * 0.6)])
      add(pipe(c, { r: 0.005, tubular: 12, radial: 6 }), M.gold, outer)
    }
    this.anchors.manifold = [outer, new THREE.Vector3(-0.66, 1.72, 0.1)]

    /* ---------------- afterburner duct, spray rings, flame holders, liner ---------------- */
    const ab = part(1.8)
    add(revolve([[0.548, 2.92], [0.585, 2.92], [0.575, 4.95], [0.54, 4.95]], 160), M.heatCase, ab)
    for (const y of [3.6, 4.3, 4.95]) flange(ab, y, 0.58, 56, M.heatCase)
    add(revolve([[0.47, 3.3], [0.5, 3.3], [0.5, 4.93], [0.47, 4.93]], 128), M.liner, ab)
    // augmentor: no spray bars or gutters. Fuel is injected from inside 22 thick curved vanes,
    // which anchor the flame in their wakes and hide the turbine from behind
    const vane = wing(0.12, 0.475, 14, (z) => ({ x: 0, y: 0, c: 0.25 - 0.05 * ((z - 0.12) / 0.355), a: 0.1 }), foil(0.2, 0.1), false)
    vane.rotateZ(-Math.PI / 2).translate(0, 3.28, 0)
    inst(vane, M.ram, around(22, 0, 0), ab)
    // fuel feed ring outside the case with a line to each vane
    add(new THREE.TorusGeometry(0.62, 0.01, 8, 128).rotateX(Math.PI / 2).translate(0, 3.36, 0), M.gold, ab)
    inst(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6).rotateX(Math.PI / 2).translate(0, 0, 0.59), M.gold, around(22, 0, 3.36), ab)
    this.abFlame = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <clipping_planes_pars_vertex>
        varying vec3 vP;
        void main() {
          #include <begin_vertex>
          #include <project_vertex>
          #include <clipping_planes_vertex>
          vP = position;
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <clipping_planes_pars_fragment>
        ${GLSL_NOISE}
        varying vec3 vP;
        uniform float uTime, uK;
        void main() {
          #include <clipping_planes_fragment>
          float r = length(vP.xz);
          float n = n3(vec3(vP.x * 2.5, vP.y * 1.4 - uTime * 3.5, vP.z * 2.5)) * 0.7 + n3(vec3(vP.x * 6.0, vP.y * 3.0 - uTime * 6.0, vP.z * 6.0)) * 0.3;
          float grow = smoothstep(3.55, 4.3, vP.y);
          // the flame starts as a sheet behind every vane, then fills the duct
          float wake = pow(0.5 + 0.5 * cos(atan(vP.z, vP.x) * 22.0 + 0.3), 4.0 - 3.0 * grow);
          float sheet = wake * smoothstep(0.1, 0.18, r) * smoothstep(0.49, 0.42, r);
          float I = (0.15 + n * n * 1.6) * mix(sheet, 1.0, grow * 0.7);
          vec3 c = mix(vec3(0.5, 0.45, 1.0), mix(vec3(1.0, 0.4, 0.1), vec3(1.0, 0.8, 0.4), n), smoothstep(3.55, 3.9, vP.y));
          gl_FragColor = vec4(c * I * uK, 1.0);
        }`,
      uniforms: { uNoise3D: NOISE3D, uTime: JET_FLOW.time, uK: { value: 0 } },
      clipping: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.abFlame.clippingPlanes = cut.planes
    const abf = new THREE.Mesh(revolve([[0.0, 3.54], [0.46, 3.54], [0.46, 4.92], [0.0, 4.92]], 128), this.abFlame)
    abf.layers.set(LAYER_GLOW)
    abf.userData.fluid = 'glow'
    ab.add(abf)
    this.anchors.afterburner = [ab, new THREE.Vector3(0.44, 3.8, 0.0)]
    this.anchors.vanes = [ab, new THREE.Vector3(0.36, 3.42, 0.1)]

    /* ---------------- nozzle: convergent flaps, divergent flaps with a serrated edge ---------------- */
    const noz = part(2.4)
    add(revolve(ring(0.5, 0.575, 4.93, 5.0), 128), M.heatCase, noz)
    const n = 15
    const conv = new THREE.BoxGeometry(0.2, 0.3, 0.012).translate(0, 0.15, 0)
    const saw = (() => {
      // divergent flap with a pointed tip, the shape of the F-35's serrated nozzle edge
      const s = new THREE.Shape()
      s.moveTo(-0.1, 0); s.lineTo(0.1, 0); s.lineTo(0.1, 0.3); s.lineTo(0, 0.42); s.lineTo(-0.1, 0.3); s.closePath()
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false })
      g.translate(0, 0, -0.006)
      return g
    })()
    // two overlapping sets of 15: thin metal inner flaps ending in a point, and thicker tiled
    // outer flaps centred on the gaps between them, whose chevrons make the sawtooth edge
    for (let i = 0; i < n * 2; i++) {
      const outer = i % 2 === 1
      const a = (i / (n * 2)) * Math.PI * 2
      const g = new THREE.Group()
      const rr = outer ? 0.522 : 0.505
      g.position.set(Math.sin(a) * rr, 4.98, Math.cos(a) * rr)
      if (!outer) g.scale.set(0.92, 1, 0.6)
      g.rotation.y = a
      noz.add(g)
      add(conv, outer ? M.tile : M.innerFlap, g).position.z = -0.006
      const div = new THREE.Group()
      div.position.y = 0.3
      g.add(div)
      add(saw, outer ? M.tile : M.innerFlap, div)
      // hinge and actuator rod
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 10).rotateZ(Math.PI / 2), M.steel, g).position.set(0, 0.3, 0)
      this.petals.push({ g, div })
    }
    inst(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8).translate(0, -0.2, 0), M.steel, around(8, 0.6, 4.95, (d) => d.rotateX(0.2)), noz)
    this.anchors.nozzle = [noz, new THREE.Vector3(0.5, 5.3, 0.0)]

    /* ---------------- accessories: gearbox and pumps below, controls on the side, plumbing ---------------- */
    const acc = part(0.0, 1.0)
    {
      // accessory gearbox hanging under the fan case (local +x is down)
      const agb = add(new THREE.CapsuleGeometry(0.1, 0.62, 6, 16), M.case, acc)
      agb.rotation.set(0, 0, 0)
      agb.position.set(0.68, 1.05, 0.0)
      const pumps: [number, number, number, number][] = [[0.8, 0.8, 0.14, 0.07], [0.8, 1.1, -0.12, 0.06], [0.79, 1.32, 0.1, 0.08], [0.78, 0.95, -0.02, 0.05]]
      for (const [x, y, z, r] of pumps) {
        const p = add(new THREE.CylinderGeometry(r, r, 0.16, 20).rotateZ(Math.PI / 2), M.steel, acc)
        p.position.set(x, y, z)
        add(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.02, 20).rotateZ(Math.PI / 2), M.dark, acc).position.set(x + 0.08, y, z)
      }
      const shaft = add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12).rotateZ(Math.PI / 2), M.steel, acc)
      shaft.position.set(0.5, 0.95, 0)
      this.anchors.gearbox = [acc, new THREE.Vector3(0.82, 1.1, 0.2)]
      // two engine control units on the camera side, with their harness looms
      for (const [y, z] of [[1.35, 0.66], [2.05, 0.66]] as const) {
        const b = add(new THREE.BoxGeometry(0.2, 0.26, 0.07), M.box, acc)
        b.position.set(0.0, y, z)
        for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.01, 0.2, 0.012), M.dark, acc).position.set(-0.08 + k * 0.032, y, z + 0.04)
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12).rotateX(Math.PI / 2), M.gold, acc).position.set(0.06, y + 0.1, z + 0.045)
      }
      this.anchors.fadec = [acc, new THREE.Vector3(0.0, 1.35, 0.75)]
      let sd = 5
      const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647)
      const mats = [M.gold, M.steel, M.hose, M.case, M.gold, M.hose]
      for (let i = 0; i < 64; i++) {
        const a0 = Math.round(rnd() * 16) / 16 * Math.PI * 2 + (rnd() - 0.5) * 0.08, a1 = a0 + (rnd() - 0.5) * 0.35
        const y0 = 0.95 + rnd() * 3.4, y1 = Math.min(4.85, y0 + 0.4 + rnd() * 1.5)
        const r = 0.61 + rnd() * 0.05
        const pts: THREE.Vector3[] = []
        for (let k = 0; k <= 10; k++) {
          const u = k / 10
          const a = a0 + (a1 - a0) * u
          const rr = r + 0.025 * Math.sin(u * Math.PI)
          pts.push(new THREE.Vector3(Math.sin(a) * rr, y0 + (y1 - y0) * u, Math.cos(a) * rr))
        }
        const rad = 0.006 + rnd() * 0.013
        add(pipe(new THREE.CatmullRomCurve3(pts), { r: rad, tubular: 60, radial: 8 }), mats[i % mats.length], acc)
        // p clips holding each line to the case
        for (const u of [0.25, 0.75]) {
          const p = pts[Math.round(u * 10)]
          const clip = add(new THREE.TorusGeometry(rad + 0.004, 0.003, 6, 12), M.steel, acc)
          clip.position.copy(p)
          clip.lookAt(pts[Math.round(u * 10) + 1])
        }
      }
      for (let k = 0; k < 5; k++) add(revolve(ring(0.6, 0.622, 1.34 + k * 0.72, 1.36 + k * 0.72), 128), M.dark, acc)
      // wiring looms: bundles of three cables running aft along the case, tied every 0.3 m
      for (const a0 of [0.5, 1.3, -0.9, 2.4, -2.2]) {
        for (let w = 0; w < 3; w++) {
          const pts: THREE.Vector3[] = []
          for (let k = 0; k <= 12; k++) {
            const y = 0.35 + k * 0.33
            const a = a0 + w * 0.022 + 0.04 * Math.sin(k * 0.9)
            const rr = 0.6 + 0.012 * (w % 2) + (y < 0.95 ? 0.0 : 0.018)
            pts.push(new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr))
          }
          add(pipe(new THREE.CatmullRomCurve3(pts), { r: 0.007, tubular: 90, radial: 6 }), w === 1 ? M.gold : M.hose, acc)
        }
        inst(new THREE.TorusGeometry(0.022, 0.004, 5, 12).rotateX(Math.PI / 2), M.steel, Array.from({ length: 13 }, (_, k) => new THREE.Matrix4().makeTranslation(Math.sin(a0 + 0.022) * 0.62, 0.35 + k * 0.33, Math.cos(a0 + 0.022) * 0.62)), acc)
      }
      // bleed valves and sensor bosses on the compressor and turbine cases
      for (const [y, a, r] of [[1.4, 0.3, 0.05], [1.62, -0.6, 0.04], [2.1, 0.9, 0.035], [2.6, -0.2, 0.03], [2.7, 1.6, 0.03], [1.5, 2.2, 0.05]] as const) {
        const v = add(new THREE.CylinderGeometry(r, r * 1.1, 0.09, 18), M.steel, acc)
        v.position.set(Math.sin(a) * 0.64, y, Math.cos(a) * 0.64)
        v.lookAt(0, y, 0)
        v.rotateX(Math.PI / 2)
      }
    }

    /* ---------------- the gas path as heat, and the flows ---------------- */
    const hm = heatMaterial(cut)
    this.heatMesh = new THREE.Mesh(revolve([[0.08, -0.3], [0.54, -0.3], [0.54, 0.9], [0.36, 0.95], [0.34, 1.8], [0.36, 2.28], [0.4, 2.85], [0.52, 3.3], [0.47, 4.92], [0.02, 4.92], [0.02, 3.5], [0.2, 2.85], [0.24, 2.3], [0.23, 1.85], [0.28, 1.7], [0.22, 1.0], [0.22, 0.7], [0.1, 0.0]], 128), hm)
    this.heatMesh.layers.set(LAYER_GLOW)
    this.heatMesh.userData.fluid = 'glow'
    this.root.add(this.heatMesh)
    const line = (pts: [number, number][], mat: THREE.Material, phases: number[]) => {
      for (const ph of phases) {
        const c = new THREE.CatmullRomCurve3(pts.map(([r, y]) => new THREE.Vector3(Math.sin(ph) * r, y, Math.cos(ph) * r)))
        const m = new THREE.Mesh(pipe(c, { r: 0.0055, tubular: 120, radial: 6 }), mat)
        m.layers.set(LAYER_GLOW)
        m.userData.fluid = 'glow'
        this.root.add(m)
        this.flows.push(m)
      }
    }
    const phases = [Math.PI * 0.55, Math.PI * 0.72, Math.PI * 0.88, Math.PI, Math.PI * 1.12, Math.PI * 1.28, Math.PI * 1.45]
    const air = flowMaterial(cut, 0, JET_FLOW.air)
    const coreM = flowMaterial(cut, 1, JET_FLOW.core)
    const fireM = flowMaterial(cut, 1, JET_FLOW.fire)
    for (const r of [0.46, 0.5]) line([[r - 0.03, -0.6], [r - 0.01, 0.4], [r, 0.9], [r + 0.01, 2.0], [r, 2.9], [r - 0.06, 3.3], [r - 0.12, 4.2], [r - 0.16, 4.95]], air, phases)
    for (const r of [0.28, 0.33]) line([[r + 0.05, -0.6], [r + 0.04, 0.6], [r, 0.95], [r - 0.02, 1.4], [r - 0.03, 1.8], [r, 2.05], [r + 0.02, 2.3], [r + 0.06, 2.8], [r - 0.04, 3.3], [r - 0.1, 4.2], [r - 0.14, 4.95]], coreM, phases)
    for (const r of [0.26, 0.31]) line([[r, 1.9], [r, 2.25], [r + 0.03, 2.55], [r + 0.05, 2.85], [r - 0.06, 3.4], [r - 0.1, 4.2], [r - 0.12, 4.95]], fireM, phases.slice(0, 5))
  }

  /** Materials whose shaders need the shared 3D noise. */
  noiseMats() {
    return [this.burner, this.abFlame, this.heatMesh.material as THREE.ShaderMaterial]
  }

  /** e 0..1 explode, lp and hp spool angles, afterburner 0..1, power 0..1 */
  update(explode: number, lpAng: number, hpAng: number, ab: number, heat: number) {
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    this.lp.rotation.y = lpAng
    this.hp.rotation.y = -hpAng // the two spools turn opposite ways
    // dry: the nozzle closes down to a narrow throat; afterburner: it opens wide
    const conv = -(0.36 - 0.2 * ab)
    const div = 0.02 + 0.1 * ab
    for (const p of this.petals) {
      p.g.rotation.x = conv
      p.div.rotation.x = div - conv
    }
    // variable vanes close at low power
    for (const im of this.vsvLevers) im.rotation.y = (1 - heat) * 0.02
    ;(this.burner.uniforms.uK as { value: number }).value = 0.5 + 2.6 * heat
    ;(this.abFlame.uniforms.uK as { value: number }).value = 0.85 * ab
    this.M.hot.emissiveIntensity = 0.06 * heat + 0.06 * ab
    this.M.liner.emissiveIntensity = 0.03 * heat + 0.12 * ab
    this.M.nozzle.emissiveIntensity = 0.04 * ab
    this.M.innerFlap.emissiveIntensity = 0.05 * ab
    this.M.tile.emissiveIntensity = 0.015 * ab
    JET_FLOW.ab.value = ab
    JET_FLOW.power.value = heat
  }
}

/* ---------------- the afterburner plume: a ray marched flame with shock diamonds ---------------- */

const PLUME_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vCam;
void main() {
  vObj = position;
  vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`
const PLUME_FRAG = /* glsl */ `
uniform highp sampler3D uNoise3D;
float n3(vec3 p) { return texture(uNoise3D, p).r; }
varying vec3 vObj;
varying vec3 vCam;
uniform float uTime, uAB, uDry, uLen;
// flame along +y from the nozzle exit; exit radius about 0.4
vec3 flame(vec3 p) {
  float y = p.y;
  if (y < 0.0 || y > uLen) return vec3(0.0);
  float r = length(p.xz);
  // shock cells: the jet overexpands and recompresses, cells shorten and fade downstream
  float cell = 0.58 * (1.0 - 0.04 * y);
  float k = y / cell;
  float decay = exp(-y / 2.6);
  float R = 0.4 * (1.0 + 0.1 * y) * (1.0 - 0.14 * cos(6.2831853 * k) * decay);
  float tu = n3(vec3(p.x * 0.9, y * 0.3 - uTime * 2.8, p.z * 0.9)) * 0.55 + n3(vec3(p.x * 2.6, y * 0.9 - uTime * 6.0, p.z * 2.6)) * 0.45;
  float shear = smoothstep(R * 0.5, R * 1.1, r);
  float fade = exp(-y / 3.2);
  float body = smoothstep(R * 1.25, R * 0.3, r) * (0.45 + 1.2 * tu * tu) * fade;
  float halo = smoothstep(R * 1.9, R * 0.8, r) * tu * exp(-y / 4.5) * 0.35;
  // diamond shaped bright cells on the axis, where the shock waves cross
  float d = abs(fract(k) - 0.5) * 2.0;
  float Rd = 0.26 * decay + 0.04;
  float knot = smoothstep(1.0, 0.55, r / Rd + d * 0.9) * decay * (0.8 + 0.3 * tu);
  // blue base where the fuel is still burning, pale yellow cells, orange turbulent edge
  vec3 base = vec3(0.35, 0.45, 1.0) * exp(-y * 3.0) * smoothstep(R, 0.0, r) * 1.2;
  vec3 hot = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.38, 0.08), clamp(shear + y / 9.0, 0.0, 1.0));
  vec3 c = hot * body + vec3(1.0, 0.45, 0.12) * halo + vec3(1.0, 0.93, 0.75) * knot * 2.6 + base;
  return c * uAB + vec3(0.25, 0.15, 0.1) * body * 0.05 * uDry;
}
void main() {
  vec3 rd = normalize(vObj - vCam);
  vec3 p = vObj;
  vec3 acc = vec3(0.0);
  float h = 0.03;
  for (int i = 0; i < 220; i++) {
    acc += flame(p) * h;
    p -= rd * h;
    if (dot(p - vCam, rd) < 0.0) break;
    if (abs(p.x) > 1.3 || abs(p.z) > 1.3 || p.y < -0.2 || p.y > uLen + 0.2) break;
  }
  gl_FragColor = vec4(acc * 1.35, 1.0);
}
`

export function plumeMesh(noise: { value: THREE.Data3DTexture | null }) {
  const len = 7
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
    uniforms: { uNoise3D: noise, uTime: JET_FLOW.time, uAB: { value: 0 }, uDry: { value: 1 }, uLen: { value: len } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  })
  const g = new THREE.CylinderGeometry(1.2, 0.55, len + 0.2, 32, 1, false)
  g.translate(0, (len + 0.2) / 2 - 0.1, 0)
  const mesh = new THREE.Mesh(g, mat)
  mesh.layers.set(1)
  mesh.userData.fluid = 'plume'
  mesh.frustumCulled = false
  return mesh
}

