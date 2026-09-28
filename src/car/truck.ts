import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf } from '../core/materials'
import { revolve, pipe, bentPath, P2 } from '../core/geometry'
import { CutState } from '../core/cut'
import { rng } from '../core/noise'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from '../fusion/plasma'

/**
 * A full size electric pickup in the Cybertruck idiom, built in metres with the
 * truck's own frame: +x forward, +y up, ground at y = 0, z across.
 *
 * The body is one faceted stainless shell lofted through cross sections; the
 * chassis under it is the skateboard: a structural pack of 1,344 cylindrical
 * cells, front and rear castings, three drive units, air suspension and
 * steer by wire. X-ray sweeps a scan plane from nose to tail, swapping the
 * steel for a glowing ghost of the same shell.
 */

export const TR = {
  L: 5.68,
  xF: 2.84,
  xR: -2.84,
  W: 1.0,
  axF: 1.72,
  axR: -2.09,
  track: 0.86,
  wheelR: 0.445,
  base: 0.48,
  archTop: 1.02,
}

/** emphasis values animated by main */
export const CAR_EMPH = {
  energy: { value: 0.3 },
  energyRate: { value: 1 },
  regen: { value: 0 },
}

const top = (x: number) => (x >= -0.25 ? 1.03 + ((TR.xF - x) / (TR.xF + 0.25)) * 0.76 : 1.79 - ((-0.25 - x) / (-0.25 - TR.xR)) * 0.57)

type Region = 'hood' | 'cabin' | 'bed' | 'crease'
interface Station { x: number; bottom: number; arch: number; belt: number; wTop: number; region: Region }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function archAt(x: number) {
  for (const ax of [TR.axF, TR.axR]) {
    const d = Math.abs(x - ax)
    if (d <= 0.4) return TR.archTop
    if (d < 0.62) return lerp(TR.archTop, TR.base, (d - 0.4) / 0.22)
  }
  return TR.base
}

function station(x: number, region: Region, bottom = TR.base): Station {
  const t = top(x)
  let belt = t - 0.045, wTop = 0.93
  if (region === 'cabin') {
    belt = lerp(1.4, 1.31, (0.975 - x) / (0.975 + 0.85))
    wTop = x > -0.25 ? lerp(0.9, 0.66, (0.975 - x) / 1.225) : lerp(0.66, 0.8, (-0.25 - x) / 0.6)
  } else if (region === 'bed') {
    belt = t - 0.05
    wTop = 0.9
  }
  return { x, bottom, arch: Math.max(bottom, archAt(x)), belt, wTop, region }
}

/** Cross section points (y, z), counter clockwise seen from the front. */
function sectionPts(s: Station): P2[] {
  const W = TR.W, tub = 0.7
  return [
    [s.bottom, -tub], [s.bottom, tub], [s.arch, tub], [s.arch, W], [s.belt, W],
    [top(s.x), s.wTop], [top(s.x), -s.wTop], [s.belt, -W], [s.arch, -W], [s.arch, -tub],
  ]
}

function stations(): Station[] {
  const S: Station[] = []
  S.push(station(2.84, 'hood', 0.94))
  S.push(station(2.7, 'hood', 0.5))
  for (const x of [2.34, 2.12, 1.32, 1.1, 0.98]) S.push(station(x, 'hood'))
  for (const x of [0.975, 0.2, 0.14, -0.25, -0.5, -0.85]) S.push(station(x, 'cabin'))
  S.push(station(-0.854, 'bed'))
  for (const x of [-1.47, -1.69, -2.49, -2.71]) S.push(station(x, 'bed'))
  S.push(station(-2.8, 'bed', 0.56))
  S.push(station(-2.84, 'bed', 0.64))
  return S
}

/** The x-section outline of the shell at any x, for the scan line. */
export function shellSection(x: number): P2[] {
  const S = stations()
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1]
    if (x <= a.x && x >= b.x) {
      const t = (a.x - x) / Math.max(1e-6, a.x - b.x)
      const pa = sectionPts(a), pb = sectionPts(b)
      return pa.map((p, k) => [lerp(p[0], pb[k][0], t), lerp(p[1], pb[k][1], t)])
    }
  }
  return []
}

/** Loft the stations into a flat shaded solid with one material group per surface kind. */
function shellGeometry() {
  const S = stations()
  // 0 steel, 1 glass, 2 dark trim, 3 tonneau
  const tris: number[][][] = [[], [], [], []]
  const push = (mat: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    if (n.lengthSq() < 1e-12) return
    tris[mat].push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z])
  }
  const v = (x: number, p: P2) => new THREE.Vector3(x, p[0], p[1])
  for (let k = 0; k < S.length - 1; k++) {
    const A = S[k], B = S[k + 1]
    const pa = sectionPts(A), pb = sectionPts(B)
    const n = pa.length
    const crease = A.region !== B.region
    const xm = (A.x + B.x) / 2
    const region = crease ? 'crease' : A.region
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      let mat = 0
      if (i === 0) mat = xm < 2.7 && xm > -2.8 ? 2 : 0
      else if (i === 1 || i === 2 || i === 8 || i === 9) mat = 2
      // glass roof up to the apex, stainless sail behind it; side windows either side of a dark B pillar
      else if (i === 4 || i === 6) mat = region === 'cabin' ? (xm > 0.14 && xm < 0.2 ? 2 : xm > -0.5 ? 1 : 0) : 0
      else if (i === 5) mat = region === 'cabin' ? (xm > -0.25 ? 1 : 0) : region === 'bed' ? 3 : 0
      // quad a0 a1 b1 b0; wound so that the section order gives outward faces
      const a0 = v(A.x, pa[i]), a1 = v(A.x, pa[j]), b0 = v(B.x, pb[i]), b1 = v(B.x, pb[j])
      push(mat, a0, b0, b1)
      push(mat, a0, b1, a1)
    }
  }
  // end caps
  for (const [s, front] of [[S[0], true], [S[S.length - 1], false]] as const) {
    const pts = sectionPts(s).filter((p, i, a) => { const q = a[(i + a.length - 1) % a.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6 })
    const contour = pts.map(([y, z]) => new THREE.Vector2(z, y))
    const faces = THREE.ShapeUtils.triangulateShape(contour, [])
    for (const f of faces) {
      const [a, b, c] = f.map((i) => v(s.x, pts[i]))
      const nx = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).x
      const want = front ? 1 : -1
      if (nx * want >= 0) push(front ? 2 : 0, a, b, c)
      else push(front ? 2 : 0, a, c, b)
    }
  }
  // orient: the loft must enclose positive volume
  let vol = 0
  for (const list of tris) for (const t of list) {
    const a = new THREE.Vector3(t[0], t[1], t[2]), b = new THREE.Vector3(t[3], t[4], t[5]), c = new THREE.Vector3(t[6], t[7], t[8])
    vol += a.dot(b.clone().cross(c)) / 6
  }
  const pos: number[] = [], uv: number[] = []
  const g = new THREE.BufferGeometry()
  let start = 0
  tris.forEach((list, mat) => {
    for (const t of list) {
      const order = vol < 0 ? [0, 2, 1] : [0, 1, 2]
      for (const o of order) {
        const x = t[o * 3], y = t[o * 3 + 1], z = t[o * 3 + 2]
        pos.push(x, y, z)
        uv.push(x * 0.5, y * 0.5 + z * 0.35)
      }
    }
    const count = list.length * 3
    g.addGroup(start, count, mat)
    start += count
  })
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

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
  float I = (0.035 + pow(f, 3.0) * 0.55) * uK;
  gl_FragColor = vec4(uColor * I, 1.0);
}
`

interface Part { group: THREE.Object3D; explode: THREE.Vector3 }

export class Truck {
  readonly root = new THREE.Group()
  readonly parts: Part[] = []
  readonly anchors: Record<string, [THREE.Object3D, THREE.Vector3]> = {}
  readonly M: Record<string, THREE.MeshStandardMaterial>
  /** the steel shell, cladding, lights and glass: everything x-ray swaps for the ghost */
  readonly shellMats: THREE.Material[] = []
  readonly solidPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10)
  readonly ghostPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -10)
  readonly scanLine: THREE.LineLoop
  readonly ghost: THREE.Group = new THREE.Group()
  readonly wheels: THREE.Object3D[] = []
  readonly shafts: THREE.Object3D[] = []
  readonly rotors: THREE.Object3D[] = []
  readonly cellMat: THREE.MeshStandardMaterial
  private ghostMat: THREE.ShaderMaterial
  private edgeMat: THREE.LineBasicMaterial
  private scanMat: THREE.LineBasicMaterial
  private lightbar: THREE.MeshBasicMaterial
  private taillight: THREE.MeshBasicMaterial
  private flowMats: THREE.ShaderMaterial[] = []
  private noCut = { planes: [] as THREE.Plane[], intersect: false } as unknown as CutState
  explode = 0
  readonly hubs: { hub: THREE.Object3D; front: boolean }[] = []
  readonly springs: THREE.Object3D[] = []
  private beamMat!: THREE.ShaderMaterial
  private beam!: THREE.Mesh

  constructor() {
    this.root.name = 'truck'
    const r = rng(11)
    const tonneauTex = (() => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 8
      const g = c.getContext('2d')!
      g.fillStyle = '#2a2d31'
      g.fillRect(0, 0, 64, 8)
      g.fillStyle = '#0c0d0f'
      g.fillRect(0, 0, 4, 8)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(22, 1)
      t.anisotropy = 8
      return t
    })()
    const M = (this.M = {
      steel: surf({ color: 0xc4c8cd, metalness: 0.82, roughness: 0.2, anisotropy: 0.75, detail: 22, roughVar: 0.1, colorVar: 0.01, envMapIntensity: 1.25, name: 'stainless' }),
      glass: surf({ color: 0x14171c, metalness: 0.9, roughness: 0.035, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.9, name: 'glass' }),
      trim: surf({ color: 0x232528, metalness: 0.05, roughness: 0.66, detail: 7, colorVar: 0.05, roughVar: 0.2, name: 'trim' }),
      tonneau: surf({ color: 0xffffff, map: tonneauTex, metalness: 0.35, roughness: 0.42, name: 'tonneau' }),
      tyre: surf({ color: 0x141517, metalness: 0, roughness: 0.86, detail: 26, bump: 0.0015, colorVar: 0.06, name: 'tyre' }),
      cover: surf({ color: 0x1c1e21, metalness: 0.25, roughness: 0.5, detail: 4, name: 'aerocover' }),
      alu: surf({ color: 0xaab0b7, metalness: 1, roughness: 0.4, detail: 7, colorVar: 0.07, roughVar: 0.45, name: 'casting' }),
      housing: surf({ color: 0x8e949b, metalness: 1, roughness: 0.36, detail: 6, colorVar: 0.05, anisotropy: 0.3, name: 'housing' }),
      pack: surf({ color: 0x2b3038, metalness: 0.75, roughness: 0.38, detail: 3, colorVar: 0.04, clearcoat: 0.3, name: 'pack' }),
      dark: surf({ color: 0x17191c, metalness: 0.6, roughness: 0.45, detail: 3, name: 'dark' }),
      hv: surf({ color: 0xff7a1c, metalness: 0, roughness: 0.5, clearcoat: 0.3, name: 'hv' }),
      disc: surf({ color: 0x8a8d92, metalness: 1, roughness: 0.34, anisotropy: 0.6, anisotropyRotation: 1.57, detail: 20, name: 'disc' }),
      rubber: surf({ color: 0x1a1b1d, metalness: 0, roughness: 0.7, name: 'rubber' }),
      seat: surf({ color: 0x1c1d20, metalness: 0, roughness: 0.62, sheen: 0.5, sheenColor: 0x6a6f78, detail: 12, colorVar: 0.05, name: 'seat' }),
      cabin: surf({ color: 0x2c2e32, metalness: 0.1, roughness: 0.55, detail: 3, name: 'cabin' }),
      spring: surf({ color: 0x33363b, metalness: 0.2, roughness: 0.55, detail: 10, name: 'airspring' }),
    })
    this.cellMat = surf({ color: 0x3a4048, metalness: 0.9, roughness: 0.3, detail: 12, emissive: 0x47c8ff, emissiveIntensity: 0, name: 'cell' })
    const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], parent: THREE.Object3D, cast = true) => {
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
    const box = (w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, rad = 0.008) => {
      const mesh = add(rad > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), m, parent)
      mesh.position.set(x, y, z)
      return mesh
    }
    const glowMat = (c: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) })
    const glowMesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      mesh.userData.fluid = 'glow'
      parent.add(mesh)
      return mesh
    }

    /* ---------------- the shell ---------------- */
    const shell = part([0, 1.55, 0])
    const shellGeo = shellGeometry()
    add(shellGeo, [M.steel, M.glass, M.trim, M.tonneau], shell)
    // wheel arch flares and the dark sill that runs between them
    for (const ax of [TR.axF, TR.axR]) {
      const o = 0.085
      const s = new THREE.Shape()
      s.moveTo(ax + 0.62 + o, TR.base)
      s.lineTo(ax + 0.4 + o * 0.45, TR.archTop + o)
      s.lineTo(ax - 0.4 - o * 0.45, TR.archTop + o)
      s.lineTo(ax - 0.62 - o, TR.base)
      s.lineTo(ax - 0.62, TR.base)
      s.lineTo(ax - 0.4, TR.archTop)
      s.lineTo(ax + 0.4, TR.archTop)
      s.lineTo(ax + 0.62, TR.base)
      s.closePath()
      for (const side of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 })
        const m = add(g, M.trim, shell)
        m.position.z = side > 0 ? TR.W - 0.015 : -TR.W + 0.015 - 0.04
      }
    }
    for (const side of [-1, 1]) {
      const sill = box(TR.axF - 0.62 - (TR.axR + 0.62) + 0.02, 0.15, 0.06, M.trim, shell, (TR.axF - 0.62 + TR.axR + 0.62) / 2, TR.base + 0.07, side * (TR.W + 0.005), 0.01)
      void sill
      // door seams on the flat lower side
      for (const [x, y1] of [[0.955, 1.39], [-0.1, 1.36], [-1.02, 1.33]] as const) {
        const seam = add(new THREE.BoxGeometry(0.006, y1 - TR.base - 0.16, 0.004), M.trim, shell, false)
        seam.position.set(x, (y1 + TR.base + 0.16) / 2, side * (TR.W + 0.0015))
      }
      // mirror on its stalk
      const mir = add(new RoundedBoxGeometry(0.07, 0.1, 0.17, 2, 0.02), M.trim, shell)
      mir.position.set(0.86, 1.42, side * 1.08)
      const stalk = add(new THREE.BoxGeometry(0.05, 0.02, 0.1), M.trim, shell)
      stalk.position.set(0.88, 1.4, side * 1.0)
    }
    // front and rear bumpers
    box(0.16, 0.14, 1.94, M.trim, shell, 2.63, 0.56, 0, 0.02)
    box(0.12, 0.2, 1.96, M.trim, shell, -2.8, 0.62, 0, 0.02)
    // the lightbars: white across the nose, red across the tail
    this.lightbar = glowMat(0xffffff, 3.2)
    this.taillight = glowMat(0xff1a1a, 2.6)
    glowMesh(new THREE.BoxGeometry(0.012, 0.018, 1.92), this.lightbar, shell).position.set(TR.xF + 0.004, 0.99, 0)
    glowMesh(new THREE.BoxGeometry(0.012, 0.035, 1.9), this.taillight, shell).position.set(TR.xR - 0.004, 1.17, 0)
    // one long wiper
    {
      const wp = add(new THREE.BoxGeometry(0.02, 0.012, 1.25), M.trim, shell)
      wp.position.set(0.95, top(0.95) + 0.012, -0.05)
      wp.rotation.set(0, 0.25, -0.23)
    }
    // the light bar throws a wide flat beam down the bay
    {
      const pos: number[] = [], tt: number[] = []
      const near = [[0.99, 1.02], [-0.96, 0.96]], far = [[-0.35, 1.35], [-2.8, 2.8]]
      const X0 = TR.xF + 0.01, X1 = TR.xF + 7.5
      const v = (t: number, y: number, z: number) => { pos.push(t ? X1 : X0, y, z); tt.push(t) }
      const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) => {
        for (const p of [a, b, c, a, c, d]) v(p[0], p[1], p[2])
      }
      const N = (yi: number, zi: number): [number, number, number] => [0, near[0][yi], near[1][zi]]
      const F = (yi: number, zi: number): [number, number, number] => [1, far[0][yi], far[1][zi]]
      quad(N(1, 0), N(1, 1), F(1, 1), F(1, 0))
      quad(N(0, 0), F(0, 0), F(0, 1), N(0, 1))
      quad(N(0, 0), N(1, 0), F(1, 0), F(0, 0))
      quad(N(0, 1), F(0, 1), F(1, 1), N(1, 1))
      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      bg.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1))
      this.beamMat = new THREE.ShaderMaterial({
        vertexShader: 'attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uK; varying float vT; void main(){ float f = pow(1.0 - vT, 1.8); gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * f * 0.075 * uK, 1.0); }',
        uniforms: { uK: { value: 1 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
      this.beam = new THREE.Mesh(bg, this.beamMat)
      this.beam.layers.set(LAYER_GLOW)
      this.beam.userData.fluid = 'glow'
      this.beam.frustumCulled = false
      shell.add(this.beam)
    }
    this.shellMats.push(M.steel, M.glass, M.trim, M.tonneau, this.lightbar, this.taillight)
    this.anchors.shell = [shell, new THREE.Vector3(-0.25, 1.82, 0.4)]

    /* ---------------- the x-ray ghost of the same shell ---------------- */
    this.ghostMat = new THREE.ShaderMaterial({
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0.45, 0.82, 1.0) }, uK: { value: 1 } },
      clipping: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.ghostMat.clippingPlanes = [this.ghostPlane]
    const ghostMesh = new THREE.Mesh(shellGeo, this.ghostMat)
    ghostMesh.layers.set(LAYER_GLOW)
    ghostMesh.userData.fluid = 'glow'
    this.ghost.add(ghostMesh)
    this.edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 0.86, 1.0).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    this.edgeMat.clippingPlanes = [this.ghostPlane]
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeo, 12), this.edgeMat)
    edges.layers.set(LAYER_GLOW)
    this.ghost.add(edges)
    shell.add(this.ghost)
    this.scanMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.55, 0.9, 1.0).multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30), 3))
    this.scanLine = new THREE.LineLoop(sg, this.scanMat)
    this.scanLine.layers.set(LAYER_GLOW)
    this.scanLine.frustumCulled = false
    shell.add(this.scanLine)
    for (const m of this.shellMats) {
      m.clippingPlanes = [this.solidPlane]
      m.clipShadows = true
    }

    /* ---------------- interior ---------------- */
    const cabin = part([0, 0.78, 0])
    const floorMat = surf({ color: 0x2c2e32, metalness: 0.1, roughness: 0.55, detail: 3, name: 'cabinfloor' })
    box(1.95, 0.04, 1.8, floorMat, cabin, -0.1, 0.52, 0, 0.01)
    this.shellMats.push(floorMat)
    floorMat.clippingPlanes = [this.solidPlane]
    const seat = (x: number, z: number, w: number) => {
      box(0.5, 0.13, w, M.seat, cabin, x, 0.66, z, 0.05)
      const back = box(0.13, 0.62, w * 0.94, M.seat, cabin, x - 0.26, 0.98, z, 0.05)
      back.rotation.z = 0.2
      box(0.1, 0.16, w * 0.5, M.seat, cabin, x - 0.33, 1.36, z, 0.04)
      box(0.4, 0.14, w * 0.7, M.dark, cabin, x, 0.56, z, 0.01)
    }
    seat(0.22, -0.42, 0.52)
    seat(0.22, 0.42, 0.52)
    seat(-0.8, -0.5, 0.52)
    seat(-0.8, 0, 0.4)
    seat(-0.8, 0.5, 0.52)
    // the dash is a single flat slab with the big screen floating over it
    box(0.3, 0.1, 1.86, M.cabin, cabin, 0.82, 1.03, 0, 0.02)
    {
      const scr = document.createElement('canvas')
      scr.width = 512
      scr.height = 320
      const g = scr.getContext('2d')!
      const bg = g.createLinearGradient(0, 0, 512, 320)
      bg.addColorStop(0, '#0b1422')
      bg.addColorStop(1, '#101a2a')
      g.fillStyle = bg
      g.fillRect(0, 0, 512, 320)
      g.strokeStyle = 'rgba(120,200,255,0.5)'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(40, 280); g.lineTo(180, 150); g.lineTo(260, 170); g.lineTo(470, 40)
      g.stroke()
      g.fillStyle = 'rgba(210,225,240,0.9)'
      g.fillRect(300, 230, 170, 60)
      g.fillStyle = '#0b1422'
      g.font = '600 38px Outfit, sans-serif'
      g.fillText('P  R  N  D', 312, 274)
      const t = new THREE.CanvasTexture(scr)
      t.colorSpace = THREE.SRGBColorSpace
      const screen = glowMesh(new THREE.PlaneGeometry(0.44, 0.27), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.1, 1.1, 1.1) }), cabin)
      screen.position.set(0.66, 1.22, 0.02)
      screen.rotation.y = -Math.PI / 2
      screen.rotation.x = 0
      screen.rotateX(-0.25)
      box(0.02, 0.29, 0.46, M.dark, cabin, 0.672, 1.22, 0.02, 0.01).rotation.z = 0.25
      // yoke
      const yoke = add(new THREE.TorusGeometry(0.15, 0.022, 10, 4), M.seat, cabin)
      yoke.scale.set(1.25, 0.8, 1)
      yoke.position.set(0.58, 1.12, -0.42)
      yoke.rotation.set(0, Math.PI / 2, Math.PI / 4)
      yoke.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), 0.35)
    }
    this.anchors.cabin = [cabin, new THREE.Vector3(0.22, 1.38, -0.42)]

    /* ---------------- battery pack ---------------- */
    const pack = part([0, 0, 0])
    const PX0 = -1.52, PX1 = 1.22, PZ = 0.78, PY0 = 0.29, PY1 = 0.47
    box(PX1 - PX0, 0.03, PZ * 2, M.pack, pack, (PX0 + PX1) / 2, PY0 + 0.015, 0, 0.006)
    for (const s of [-1, 1]) {
      box(PX1 - PX0, PY1 - PY0 - 0.02, 0.04, M.pack, pack, (PX0 + PX1) / 2, (PY0 + PY1) / 2 - 0.01, s * (PZ - 0.02), 0.006)
      box(0.04, PY1 - PY0 - 0.02, PZ * 2, M.pack, pack, s > 0 ? PX1 - 0.02 : PX0 + 0.02, (PY0 + PY1) / 2 - 0.01, 0, 0.006)
    }
    {
      const nx = 48, nz = 28
      const cg = new THREE.CylinderGeometry(0.023, 0.023, 0.08, 14)
      const im = new THREE.InstancedMesh(cg, this.cellMat, nx * nz)
      const m = new THREE.Matrix4()
      let i = 0
      const px = (PX1 - PX0 - 0.1) / nx, pz = (PZ * 2 - 0.1) / nz
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        m.makeTranslation(PX0 + 0.05 + (a + 0.5) * px, PY0 + 0.03 + 0.045, -PZ + 0.05 + (b + 0.5) * pz + (a % 2 ? pz * 0.25 : -pz * 0.25))
        im.setMatrixAt(i++, m)
      }
      im.castShadow = false
      im.receiveShadow = true
      pack.add(im)
      // busbars between the rows of cells
      for (let a = 0; a < 8; a++) box(0.012, 0.004, PZ * 2 - 0.12, M.housing, pack, PX0 + 0.1 + a * ((PX1 - PX0 - 0.2) / 7), PY0 + 0.118, 0, 0)
    }
    const lid = part([0, 0.42, 0])
    const lidMat = surf({ color: 0x2b3038, metalness: 0.75, roughness: 0.38, detail: 3, colorVar: 0.04, clearcoat: 0.3, name: 'packlid' })
    box(PX1 - PX0 + 0.02, 0.018, PZ * 2 + 0.02, lidMat, lid, (PX0 + PX1) / 2, PY1 + 0.004, 0, 0.006)
    // the lid goes with the shell in x-ray so the cells show
    this.shellMats.push(lidMat)
    lidMat.clippingPlanes = [this.solidPlane]
    this.anchors.pack = [pack, new THREE.Vector3(-0.2, PY1 + 0.02, PZ - 0.1)]

    /* ---------------- castings ---------------- */
    const castF = part([0.3, 0.12, 0])
    const castR = part([-0.3, 0.12, 0])
    const casting = (g: THREE.Object3D, x0: number, x1: number) => {
      const cx = (x0 + x1) / 2, len = Math.abs(x1 - x0)
      for (const s of [-1, 1]) {
        box(len, 0.16, 0.1, M.alu, g, cx, 0.52, s * 0.62, 0.02)
        // shock tower
        const ax = x0 > 0 ? TR.axF : TR.axR
        box(0.26, 0.42, 0.16, M.alu, g, ax, 0.82, s * 0.58, 0.03)
        for (let k = 0; k < 4; k++) box(0.012, 0.13, 0.08, M.alu, g, cx - len / 2 + 0.15 + k * ((len - 0.3) / 3), 0.52, s * 0.54, 0)
      }
      for (const x of [x0, x1, cx]) box(0.1, 0.12, 1.2, M.alu, g, x, 0.5, 0, 0.02)
      box(len, 0.03, 1.2, M.alu, g, cx, 0.435, 0, 0.01)
    }
    casting(castF, PX1 + 0.04, 2.55)
    casting(castR, PX0 - 0.04, -2.72)
    this.anchors.castF = [castF, new THREE.Vector3(2.35, 0.62, 0.62)]
    this.anchors.castR = [castR, new THREE.Vector3(-2.55, 0.62, 0.62)]

    /* ---------------- drive units ---------------- */
    const driveUnit = (g: THREE.Object3D, x: number, z: number, flip: number) => {
      const du = new THREE.Group()
      du.position.set(x, TR.wheelR, z)
      g.add(du)
      const motor = add(revolve([[0, -0.2], [0.13, -0.2], [0.14, -0.18], [0.14, 0.14], [0.12, 0.16], [0, 0.16]], 48), M.housing, du)
      motor.rotation.x = Math.PI / 2
      for (let k = 0; k < 7; k++) {
        const fin = add(revolve([[0.14, -0.006], [0.152, -0.004], [0.152, 0.004], [0.14, 0.006]], 48), M.housing, du, false)
        fin.rotation.x = Math.PI / 2
        fin.position.z = -0.15 + k * 0.045
      }
      box(0.3, 0.22, 0.14, M.housing, du, 0.12 * flip, -0.03, 0.21, 0.04) // gearbox
      box(0.26, 0.1, 0.3, M.dark, du, 0, 0.19, -0.02, 0.02) // inverter
      box(0.05, 0.05, 0.08, M.hv, du, 0.1 * flip, 0.25, 0.08, 0.01)
      const rot = new THREE.Group()
      du.add(rot)
      this.rotors.push(rot)
      return du
    }
    const duF = part([0.62, 0, 0])
    driveUnit(duF, TR.axF + 0.02, 0, 1)
    const duR = part([-0.62, 0, 0])
    driveUnit(duR, TR.axR - 0.05, -0.18, -1)
    const du2 = driveUnit(duR, TR.axR - 0.05, 0.18, -1)
    du2.scale.z = -1
    this.anchors.motorF = [duF, new THREE.Vector3(TR.axF + 0.02, TR.wheelR + 0.26, 0)]
    this.anchors.motorR = [duR, new THREE.Vector3(TR.axR - 0.05, TR.wheelR + 0.26, 0)]

    /* ---------------- HV cables and the energy that flows through them ---------------- */
    const flow = glowLineMaterial(this.noCut, { color: 0x5fd0ff, emph: CAR_EMPH.energy, rate: CAR_EMPH.energyRate, speed: 1.2, scale: 0.25, base: 0.25 })
    this.flowMats.push(flow)
    const cable = (pts: [number, number, number][], g: THREE.Object3D) => {
      const c = bentPath(pts, 0.08)
      add(pipe(c, { r: 0.016, tubular: 90, radial: 10 }), M.hv, g, false)
      glowMesh(pipe(c, { r: 0.019, tubular: 90, radial: 8 }), flow, g)
    }
    for (const s of [-1, 1]) {
      cable([[PX1 - 0.05, PY1 + 0.01, s * 0.12], [PX1 + 0.2, PY1 + 0.02, s * 0.12], [TR.axF - 0.12, TR.wheelR + 0.25, s * 0.08], [TR.axF, TR.wheelR + 0.25, s * 0.05]], duF)
      cable([[PX0 + 0.05, PY1 + 0.01, s * 0.14], [PX0 - 0.2, PY1 + 0.02, s * 0.14], [TR.axR + 0.1, TR.wheelR + 0.26, s * 0.18], [TR.axR - 0.02, TR.wheelR + 0.26, s * 0.18]], duR)
    }

    /* ---------------- wheels, suspension and half shafts ---------------- */
    const tyreProfile: P2[] = [[0.27, -0.14], [0.39, -0.155], [0.425, -0.148], [0.442, -0.125], [0.445, -0.08], [0.445, 0.08], [0.442, 0.125], [0.425, 0.148], [0.39, 0.155], [0.27, 0.14]]
    const tyreGeo = revolve(tyreProfile, 72, 50)
    const blockGeo = new RoundedBoxGeometry(0.075, 0.03, 0.085, 1, 0.006)
    const coverTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 512
      const g = c.getContext('2d')!
      g.fillStyle = '#26292d'
      g.fillRect(0, 0, 512, 512)
      g.translate(256, 256)
      for (let k = 0; k < 6; k++) {
        g.save()
        g.rotate((k / 6) * Math.PI * 2)
        g.fillStyle = k % 2 ? '#1a1c1f' : '#202226'
        g.beginPath(); g.moveTo(0, 0); g.lineTo(250, -145); g.lineTo(250, 145); g.closePath(); g.fill()
        g.strokeStyle = '#0c0d0f'
        g.lineWidth = 7
        g.beginPath(); g.moveTo(40, -18); g.lineTo(236, -70); g.stroke()
        g.restore()
      }
      g.fillStyle = '#121315'
      g.beginPath(); g.arc(0, 0, 48, 0, Math.PI * 2); g.fill()
      g.strokeStyle = '#34383d'
      g.lineWidth = 4
      g.beginPath()
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI * 2; const p = [Math.cos(a) * 40, Math.sin(a) * 40]; if (k) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]) }
      g.stroke()
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      return t
    })()
    const coverMat = surf({ color: 0xffffff, map: coverTex, metalness: 0.3, roughness: 0.46, clearcoat: 0.3, name: 'cover-face' })
    const wheelAt = (x: number, side: number) => {
      const g = part([0, 0, side * 0.72])
      g.userData.unsprung = true
      const hub = new THREE.Group()
      hub.position.set(x, TR.wheelR, side * TR.track)
      g.add(hub)
      const spin = new THREE.Group()
      hub.add(spin)
      const w = new THREE.Group()
      w.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2
      spin.add(w)
      add(tyreGeo, M.tyre, w)
      const n = 44
      const im = new THREE.InstancedMesh(blockGeo, M.tyre, n * 2)
      for (let k = 0; k < n * 2; k++) {
        const row = k < n ? -1 : 1
        const a = ((k % n) + (row > 0 ? 0.5 : 0)) / n * Math.PI * 2 + r() * 0.01
        const mb = new THREE.Matrix4().makeBasis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(0, 1, 0))
        mb.setPosition(Math.cos(a) * 0.449, row * 0.062 + ((k % 3) - 1) * 0.01, Math.sin(a) * 0.449)
        im.setMatrixAt(k, mb)
      }
      im.castShadow = true
      w.add(im)
      // aero cover: flat, faceted, dark
      add(revolve([[0, 0.08], [0.272, 0.08], [0.275, 0.13], [0.26, 0.142], [0, 0.146]], 72, 20), M.cover, w)
      const face = add(new THREE.CircleGeometry(0.258, 72), coverMat, w, false)
      face.rotation.x = -Math.PI / 2
      face.position.y = 0.1465
      // brake disc and caliper behind the cover
      add(revolve([[0.09, -0.07], [0.19, -0.07], [0.19, -0.04], [0.09, -0.04]], 64), M.disc, w)
      const cal = box(0.1, 0.05, 0.13, M.dark, hub, -0.12, 0.12, -side * 0.06, 0.015)
      void cal
      this.wheels.push(spin)
      this.hubs.push({ hub, front: x > 0 })
      // knuckle, arms and the air spring
      const inner = side * 0.6
      const knuckle = box(0.1, 0.24, 0.07, M.alu, hub, 0, 0.02, -side * 0.12, 0.02)
      void knuckle
      const arm = (y0: number, y1: number, zin: number) => {
        for (const dx of [-0.16, 0.16]) {
          const a = new THREE.Vector3(x, y0, side * (TR.track - 0.12)), b = new THREE.Vector3(x + dx, y1, zin)
          add(pipe(new THREE.LineCurve3(a, b), { r: 0.018, tubular: 2, radial: 10 }), M.alu, g)
        }
      }
      arm(TR.wheelR - 0.12, TR.wheelR - 0.1, inner)
      arm(TR.wheelR + 0.14, TR.wheelR + 0.2, side * 0.58)
      const sp = add(revolve([[0, 0], [0.065, 0], [0.075, 0.03], [0.06, 0.06], [0.075, 0.09], [0.06, 0.12], [0.075, 0.15], [0.065, 0.18], [0, 0.18]], 32), M.spring, g)
      sp.position.set(x - 0.1, TR.wheelR + 0.22, side * (TR.track - 0.3))
      sp.userData.keep = true
      this.springs.push(sp)
      const damper = add(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 12), M.housing, g)
      damper.position.set(x - 0.1, TR.wheelR + 0.1, side * (TR.track - 0.3))
      // half shaft to the drive unit
      const hs = new THREE.Group()
      hs.position.set(x, TR.wheelR, 0)
      g.add(hs)
      const zIn = x > 0 ? 0.2 : 0.3
      const shaft = add(new THREE.CylinderGeometry(0.022, 0.022, TR.track - 0.12 - zIn, 12), M.housing, hs)
      shaft.rotation.x = Math.PI / 2
      shaft.position.z = side * (zIn + (TR.track - 0.12 - zIn) / 2)
      for (const zz of [zIn + 0.03, TR.track - 0.16]) {
        const boot = add(revolve([[0, -0.045], [0.04, -0.045], [0.05, -0.02], [0.035, 0], [0.05, 0.02], [0.035, 0.045], [0, 0.045]], 20), M.rubber, hs)
        boot.rotation.x = Math.PI / 2
        boot.position.z = side * zz
      }
      this.shafts.push(hs)
      if (x > 0 && side > 0) this.anchors.suspension = [g, new THREE.Vector3(x - 0.1, TR.wheelR + 0.42, side * (TR.track - 0.3))]
      if (x > 0 && side > 0) this.anchors.wheel = [g, new THREE.Vector3(x + 0.1, TR.wheelR + 0.1, side * (TR.track + 0.18))]
    }
    for (const x of [TR.axF, TR.axR]) for (const side of [-1, 1]) wheelAt(x, side)
    // steer by wire rack across the front
    const rack = part([0.15, 0, 0])
    box(0.1, 0.1, 1.1, M.housing, rack, TR.axF - 0.2, TR.wheelR - 0.02, 0, 0.03)
    box(0.12, 0.14, 0.16, M.dark, rack, TR.axF - 0.2, TR.wheelR + 0.06, 0.2, 0.02)
    this.anchors.rack = [rack, new THREE.Vector3(TR.axF - 0.2, TR.wheelR + 0.14, 0.24)]
  }

  /** e 0..1 explode; xray 0..1 scan position; speed km/h for the spinning parts */
  update(dt: number, explode: number, xray: number, wheelAngle: number, motorAngle: number) {
    this.explode = explode
    const e = explode * explode * (3 - 2 * explode)
    for (const p of this.parts) p.group.position.copy(p.explode).multiplyScalar(e)
    for (const w of this.wheels) w.rotation.z = -wheelAngle
    for (const s of this.shafts) s.rotation.z = -wheelAngle
    for (const m of this.rotors) m.rotation.z = -motorAngle
    // scan plane sweeps from the nose (x = +3) to the tail (x = -3)
    const s = 3.05 - 6.1 * xray
    this.root.updateWorldMatrix(true, true)
    const shellObj = this.parts[0].group
    const mw = shellObj.matrixWorld
    this.solidPlane.set(new THREE.Vector3(-1, 0, 0), s).applyMatrix4(mw)
    this.ghostPlane.set(new THREE.Vector3(1, 0, 0), -s).applyMatrix4(mw)
    const on = xray > 0.001
    this.ghost.visible = on
    this.scanLine.visible = xray > 0.002 && xray < 0.998
    if (this.scanLine.visible) {
      const pts = shellSection(s)
      const pa = this.scanLine.geometry.attributes.position as THREE.BufferAttribute
      pts.forEach(([y, z], i) => pa.setXYZ(i, s, y, z))
      pa.needsUpdate = true
    }
    void dt
  }

  /** ride height offset (m), steering angles (rad) front and rear, headlight 0..1 */
  chassis(ride: number, steerF: number, steerR: number, lights: number, brake: number) {
    for (const p of this.parts) if (!p.group.userData.unsprung) p.group.position.y += ride
    for (const s of this.springs) s.scale.y = 1 + ride / 0.2
    for (const h of this.hubs) h.hub.rotation.y = h.front ? steerF : steerR
    this.beamMat.uniforms.uK.value = lights
    this.beam.visible = lights > 0.01
    this.lightbar.color.setRGB(1, 1, 1).multiplyScalar(1.2 + 2.4 * lights)
    this.taillight.color.setRGB(1, 0.1, 0.1).multiplyScalar(1.6 + 3 * brake)
  }

  setDim(k: number) {
    this.ghostMat.uniforms.uK.value = k
    this.edgeMat.color.setRGB(0.5, 0.86, 1.0).multiplyScalar(1.6 * k)
  }

  setRegen(regen: number) {
    for (const m of this.flowMats) m.uniforms.uColor.value.setRGB(lerp(0.37, 0.45, regen), lerp(0.82, 1.0, regen), lerp(1.0, 0.55, regen))
  }
}
