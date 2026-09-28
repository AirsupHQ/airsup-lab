import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { revolve, pipe, ringProfile, P2 } from '../core/geometry'
import { CutState } from '../core/cut'
import { LAYER_GLOW } from '../render/pipeline'
import { glowLineMaterial } from './plasma'

/** How the heat becomes electricity: emphasis and rate of each stage, animated by main. */
export const PLANT = {
  heat: { value: 0.3 },
  steam: { value: 0.3 },
  power: { value: 0.3 },
  rate: { value: 1 },
}

/**
 * The rest of a power station, as a bench model beside the reactor: the hot
 * water loop into a steam generator, a turbine cut open, the generator and a
 * small city whose lights follow the output.
 */
export class PowerPlant {
  readonly group = new THREE.Group()
  readonly anchors: Record<string, THREE.Vector3> = {}
  private rotor = new THREE.Group()
  private genRotor = new THREE.Group()
  private windows: THREE.MeshBasicMaterial
  private angle = 0

  constructor(fusion: THREE.Vector3, platformTop: number) {
    const G = this.group
    const noCut = new CutState(new THREE.Object3D(), 1e4)
    noCut.update()
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const glowMesh = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      p.add(mesh)
      return mesh
    }
    const M = {
      plinth: surf({ color: 0x23272e, metalness: 0.35, roughness: 0.4, detail: 1.5, clearcoat: 0.5 }),
      steel: surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.3, detail: 3, anisotropy: 0.4 }),
      white: surf({ color: 0xe6e4df, metalness: 0.1, roughness: 0.35, clearcoat: 0.6, detail: 2 }),
      green: surf({ color: 0x2f6e5a, metalness: 0.5, roughness: 0.35, clearcoat: 0.6, detail: 2 }),
      dark: surf({ color: 0x1c1f24, metalness: 0.6, roughness: 0.45, detail: 3 }),
      blade: surf({ color: 0xd8c38a, metalness: 1, roughness: 0.25, detail: 6, side: THREE.DoubleSide }),
      copper: surf({ color: 0xc8793f, metalness: 1, roughness: 0.3, detail: 6 }),
      city: matte(0x3a3f48, 0.6, { detail: 6, colorVar: 0.1 }),
    }

    // the plinth runs along the left wall, beside the reactor
    const X = fusion.x - 3.75, Z0 = -0.35, Z1 = 2.75
    const TOP = 0.72
    add(new RoundedBoxGeometry(1.5, TOP, Z1 - Z0, 3, 0.02), M.plinth).position.set(X, TOP / 2, (Z0 + Z1) / 2)
    glowMesh(new THREE.BoxGeometry(1.52, 0.012, Z1 - Z0 + 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x62b4ff).multiplyScalar(1.8) })).position.set(X, TOP - 0.03, (Z0 + Z1) / 2)

    // steam generator: hot water in, steam out
    const sgZ = 0.05
    const sg: P2[] = [[0, 0], [0.17, 0], [0.2, 0.06], [0.2, 0.62], [0.24, 0.72], [0.24, 0.98], [0.14, 1.08], [0, 1.1]]
    add(revolve(sg, 48), M.white).position.set(X, TOP, sgZ)
    for (const y of [0.2, 0.5, 0.8]) add(revolve(ringProfile(0.2, 0.215, y, y + 0.03, 0.004), 48), M.dark).position.set(X, TOP, sgZ)
    this.anchors.sg = new THREE.Vector3(X, TOP + 1.18, sgZ)

    // turbine: a cut open casing with three blade rows on one shaft
    const tz0 = 0.55, tz1 = 1.55
    const casing = new THREE.CylinderGeometry(0.2, 0.26, tz1 - tz0, 48, 1, true, Math.PI * 0.5, Math.PI)
    casing.rotateX(Math.PI / 2)
    const cm = add(casing, surf({ color: 0x9aa0a8, metalness: 1, roughness: 0.32, detail: 3, side: THREE.DoubleSide }))
    cm.position.set(X, TOP + 0.34, (tz0 + tz1) / 2)
    cm.rotation.z = Math.PI
    add(new RoundedBoxGeometry(0.62, 0.08, tz1 - tz0 + 0.1, 2, 0.01), M.dark).position.set(X, TOP + 0.04, (tz0 + tz1) / 2)
    for (const z of [tz0 + 0.05, tz1 - 0.05]) add(new THREE.BoxGeometry(0.1, 0.3, 0.08), M.dark).position.set(X, TOP + 0.15, z)
    this.rotor.position.set(X, TOP + 0.34, 0)
    G.add(this.rotor)
    const shaft = add(new THREE.CylinderGeometry(0.03, 0.03, 2.2 - 0.4, 16), M.steel, this.rotor)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = 1.2
    const rows = 5
    for (let r = 0; r < rows; r++) {
      const z = tz0 + 0.12 + r * ((tz1 - tz0 - 0.24) / (rows - 1))
      const rad = 0.1 + r * 0.025
      const disc = add(new THREE.CylinderGeometry(0.052, 0.052, 0.035, 32), M.steel, this.rotor)
      disc.rotation.x = Math.PI / 2
      disc.position.z = z
      const nb = 30
      const bladeG = new THREE.BoxGeometry(0.011, rad, 0.0025)
      bladeG.translate(0, 0.05 + rad / 2, 0)
      for (let b = 0; b < nb; b++) {
        const bl = add(bladeG, M.blade, this.rotor)
        bl.position.z = z
        bl.rotation.z = (b / nb) * Math.PI * 2
        bl.rotateY(0.5)
      }
    }
    this.anchors.turbine = new THREE.Vector3(X, TOP + 0.62, (tz0 + tz1) / 2)

    // generator
    const gz0 = 1.62, gz1 = 2.1
    const gen = add(new THREE.CylinderGeometry(0.22, 0.22, gz1 - gz0, 48), M.green)
    gen.rotation.x = Math.PI / 2
    gen.position.set(X, TOP + 0.34, (gz0 + gz1) / 2)
    for (const z of [gz0, gz1]) {
      const rim = add(new THREE.TorusGeometry(0.22, 0.015, 8, 48), M.steel)
      rim.position.set(X, TOP + 0.34, z)
    }
    add(new RoundedBoxGeometry(0.5, 0.12, gz1 - gz0 + 0.1, 2, 0.01), M.dark).position.set(X, TOP + 0.06, (gz0 + gz1) / 2)
    this.genRotor.position.set(X, TOP + 0.34, gz1 + 0.01)
    G.add(this.genRotor)
    for (let i = 0; i < 6; i++) {
      const c = add(new THREE.BoxGeometry(0.03, 0.14, 0.01), M.copper, this.genRotor)
      c.rotation.z = (i / 6) * Math.PI * 2
      c.translateY(0.08)
    }
    this.anchors.gen = new THREE.Vector3(X, TOP + 0.62, (gz0 + gz1) / 2)

    // a small city at the end of the line
    this.windows = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5) })
    const winTex = (() => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 128
      const g = c.getContext('2d')!
      g.fillStyle = '#000'
      g.fillRect(0, 0, 64, 128)
      let sd = 3
      const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647)
      for (let y = 8; y < 128; y += 16) for (let x = 8; x < 64; x += 16) if (rr() > 0.45) { g.fillStyle = '#fff'; g.fillRect(x, y, 6, 5) }
      const t = new THREE.CanvasTexture(c)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      return t
    })()
    this.windows.map = winTex
    let seed = 9
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 14; i++) {
      const w = 0.08 + rnd() * 0.06, h = 0.1 + rnd() * 0.35
      const bx = X - 0.5 + (i % 5) * 0.23 + rnd() * 0.04, bz = 2.25 + Math.floor(i / 5) * 0.17
      add(new THREE.BoxGeometry(w, h, w), M.city).position.set(bx, TOP + h / 2, bz)
      const lit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.002, h * 0.9, w + 0.002), this.windows)
      lit.position.set(bx, TOP + h / 2, bz)
      lit.layers.set(LAYER_GLOW)
      G.add(lit)
    }
    this.anchors.city = new THREE.Vector3(X, TOP + 0.55, 2.45)

    // pipes and cables
    const F = fusion
    const hotPts = [
      [F.x - 1.89, platformTop + 0.03, F.z - 1.14], [F.x - 2.3, platformTop + 0.08, F.z - 1.0], [F.x - 2.75, 0.3, F.z - 0.6], [X + 0.02, 0.3, -0.35], [X, TOP + 0.02, sgZ],
    ].map((p) => new THREE.Vector3(...(p as [number, number, number])))
    const hot = new THREE.CatmullRomCurve3(hotPts, false, 'catmullrom', 0.3)
    add(pipe(hot, { r: 0.038, tubular: 120, radial: 16 }), M.steel)
    glowMesh(pipe(hot, { r: 0.041, tubular: 120, radial: 12 }), glowLineMaterial(noCut, { color: 0xff8a3a, emph: PLANT.heat, rate: PLANT.rate, speed: 1.2, scale: 0.25, base: 0.25 }))
    const steam = new THREE.CatmullRomCurve3([new THREE.Vector3(X, TOP + 1.1, sgZ), new THREE.Vector3(X, TOP + 1.2, sgZ + 0.2), new THREE.Vector3(X, TOP + 0.75, tz0 + 0.1), new THREE.Vector3(X, TOP + 0.56, tz0 + 0.12)], false, 'catmullrom', 0.2)
    add(pipe(steam, { r: 0.03, tubular: 80, radial: 14 }), M.steel)
    glowMesh(pipe(steam, { r: 0.033, tubular: 80, radial: 10 }), glowLineMaterial(noCut, { color: 0xdfe8ff, emph: PLANT.steam, rate: PLANT.rate, speed: 1.6, scale: 0.15, base: 0.3 }))
    const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(X + 0.23, TOP + 0.34, gz1 - 0.1), new THREE.Vector3(X + 0.4, TOP + 0.2, gz1 + 0.1), new THREE.Vector3(X + 0.3, TOP + 0.02, 2.2), new THREE.Vector3(X, TOP + 0.02, 2.3)], false, 'catmullrom', 0.2)
    glowMesh(pipe(cable, { r: 0.012, tubular: 60, radial: 8 }), glowLineMaterial(noCut, { color: 0x7fd8ff, emph: PLANT.power, rate: PLANT.rate, speed: 3, scale: 0.08, base: 0.35 }))
  }

  /** power: 0..1.5 of the design output */
  update(dt: number, power: number) {
    this.angle += dt * power * 9
    this.rotor.rotation.z = this.angle
    this.genRotor.rotation.z = this.angle
    const k = Math.min(1.4, power)
    this.windows.color.setRGB(1.0, 0.78, 0.48).multiplyScalar(0.1 + 1.7 * k * k)
  }
}
