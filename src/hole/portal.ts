import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { revolve, pipe, P2 } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { HOLE, portalMaterial, fullscreenMaterial } from './spacetime'

/** Portal ring radius and its centre height above the floor. */
export const PORTAL = { R: 1.75, Y: 2.25, depth: 5.2, scale: 5 }

/** Real numbers for a black hole of M suns. */
export function holeNumbers(M: number) {
  const rsKm = 2.953 * M
  const tidalG = 2.11e9 / (M * M) // across a 2 m person at the horizon
  const toSingularity = Math.PI * 4.925e-6 * M // seconds, from the horizon
  return { rsKm, tidalG, toSingularity }
}
export const massOf = (k: number) => Math.pow(10, 1 + k * 8.813)

/**
 * The gate: a heavy stainless ring on a plinth, with a rotating inner ring of
 * glowing chevrons, clamps, two field coil pylons and the cables between
 * them. Behind the ring is the traced spacetime.
 */
export class Portal {
  readonly group = new THREE.Group()
  readonly screen: THREE.Mesh
  readonly fullscreen: THREE.Mesh
  readonly inner = new THREE.Group()
  readonly glowMats: THREE.MeshBasicMaterial[] = []
  readonly light: THREE.PointLight
  private chevrons: THREE.MeshBasicMaterial
  private coils: THREE.MeshBasicMaterial
  private rimGlow: THREE.MeshBasicMaterial

  constructor(at: THREE.Vector3) {
    const G = this.group
    G.position.copy(at)
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const glow = (g: THREE.BufferGeometry, m: THREE.MeshBasicMaterial, p: THREE.Object3D = G) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      p.add(mesh)
      return mesh
    }
    const M = {
      steel: surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.24, detail: 6, anisotropy: 0.6, name: 'gate-steel' }),
      dark: surf({ color: 0x1e2127, metalness: 0.8, roughness: 0.35, detail: 4, clearcoat: 0.4, name: 'gate-dark' }),
      copper: surf({ color: 0xc8793f, metalness: 1, roughness: 0.3, detail: 10, name: 'gate-copper' }),
      plinth: surf({ color: 0x20242b, metalness: 0.35, roughness: 0.4, detail: 1.5, clearcoat: 0.55 }),
      cable: surf({ color: 0x15171a, metalness: 0.1, roughness: 0.6, name: 'gate-cable' }),
    }
    const Y = PORTAL.Y, R = PORTAL.R
    // ring profiles are built around y and turned to face +z
    const ringAt = (prof: P2[], m: THREE.Material, p: THREE.Object3D = G, seg = 160) => {
      const g = revolve(prof, seg, 40)
      g.rotateX(Math.PI / 2)
      const mesh = add(g, m, p)
      return mesh
    }
    const outer = new THREE.Group()
    outer.position.y = Y
    G.add(outer)
    ringAt([[R + 0.04, -0.2], [R + 0.36, -0.2], [R + 0.42, -0.14], [R + 0.42, 0.14], [R + 0.36, 0.2], [R + 0.04, 0.2], [R + 0.04, 0.12], [R + 0.3, 0.12], [R + 0.3, -0.12], [R + 0.04, -0.12]], M.steel, outer)
    ringAt([[R + 0.3, -0.12], [R + 0.36, -0.12], [R + 0.36, 0.12], [R + 0.3, 0.12]], M.dark, outer)
    // nine clamps around the ring with lit tips
    this.chevrons = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1).multiplyScalar(2.5) })
    this.glowMats.push(this.chevrons)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.PI / 2
      const c = new THREE.Group()
      c.rotation.z = a - Math.PI / 2
      outer.add(c)
      add(new RoundedBoxGeometry(0.26, 0.36, 0.5, 2, 0.03), M.dark, c).position.set(0, R + 0.38, 0)
      add(new RoundedBoxGeometry(0.2, 0.12, 0.54, 2, 0.02), M.steel, c).position.set(0, R + 0.24, 0)
      glow(new THREE.BoxGeometry(0.1, 0.05, 0.02), this.chevrons, c).position.set(0, R + 0.2, 0.28)
    }
    // the inner ring turns: 36 segments that light in sequence
    this.inner.position.y = Y
    G.add(this.inner)
    ringAt([[R - 0.02, -0.08], [R + 0.05, -0.08], [R + 0.05, 0.08], [R - 0.02, 0.08]], M.dark, this.inner)
    const segG = new THREE.BoxGeometry(0.1, 0.035, 0.012)
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1) })
      this.glowMats.push(m)
      const s = glow(segG, m, this.inner)
      s.position.set(Math.cos(a) * (R + 0.015), Math.sin(a) * (R + 0.015), 0.085)
      s.rotation.z = a + Math.PI / 2
    }
    this.rimGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.85, 1).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const rim = glow(new THREE.TorusGeometry(R - 0.03, 0.02, 12, 192), this.rimGlow)
    rim.position.y = Y
    // legs and plinth
    add(revolve([[0, 0], [3.2, 0], [3.2, 0.12], [3.14, 0.18], [0, 0.18]], 128), M.plinth)
    const floorRing = new THREE.Mesh(new THREE.TorusGeometry(3.18, 0.006, 8, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x62b4ff).multiplyScalar(2.2) }))
    floorRing.rotation.x = Math.PI / 2
    floorRing.position.y = 0.15
    floorRing.layers.set(LAYER_GLOW)
    G.add(floorRing)
    for (const s of [-1, 1]) {
      const leg = new THREE.Shape()
      leg.moveTo(-0.3, 0); leg.lineTo(0.3, 0); leg.lineTo(0.16, Y - R * 0.55); leg.lineTo(-0.16, Y - R * 0.55); leg.closePath()
      const lg = new THREE.ExtrudeGeometry(leg, { depth: 0.5, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 })
      lg.translate(0, 0, -0.25)
      const m = add(lg, M.dark)
      m.position.set(s * R * 0.72, 0.18, 0)
      m.rotation.z = s * 0.28
    }
    // field coil pylons either side
    this.coils = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1).multiplyScalar(2) })
    this.glowMats.push(this.coils)
    for (const s of [-1, 1]) {
      const p = new THREE.Group()
      p.position.set(s * 3.6, 0, -0.6)
      G.add(p)
      add(revolve([[0, 0], [0.42, 0], [0.42, 0.2], [0.3, 0.28], [0.26, 3.3], [0.34, 3.4], [0.34, 3.55], [0, 3.6]], 48), M.dark, p)
      for (let k = 0; k < 7; k++) {
        add(revolve([[0.27, -0.09], [0.4, -0.09], [0.4, 0.09], [0.27, 0.09]], 48), M.copper, p).position.y = 0.7 + k * 0.36
        glow(new THREE.TorusGeometry(0.405, 0.008, 6, 64).rotateX(Math.PI / 2), this.coils, p).position.y = 0.7 + k * 0.36
      }
      // two thick cables to the ring
      for (const dy of [0.9, 1.5]) {
        const c = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 3.3, dy, -0.6), new THREE.Vector3(s * 2.9, 0.25, -0.2), new THREE.Vector3(s * 2.3, 0.3, 0), new THREE.Vector3(s * (R * 0.95), Y - R * 0.6 + dy * 0.2, -0.15)])
        add(pipe(c, { r: 0.05, tubular: 60, radial: 12 }), M.cable)
      }
    }
    // the window into spacetime
    this.screen = new THREE.Mesh(new THREE.CircleGeometry(R, 128), portalMaterial())
    this.screen.position.y = Y
    this.screen.userData.keep = true
    G.add(this.screen)
    this.fullscreen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fullscreenMaterial())
    this.fullscreen.frustumCulled = false
    this.fullscreen.layers.set(LAYER_GLOW)
    this.fullscreen.renderOrder = 999
    this.fullscreen.visible = false
    this.fullscreen.userData.keep = true
    G.add(this.fullscreen)
    this.light = new THREE.PointLight(0x9fcfff, 18, 9, 2)
    this.light.position.set(0, Y, 0.8)
    G.add(this.light)
    void matte
  }

  /** World position of the traced spacetime's centre. */
  centre() {
    return new THREE.Vector3(0, PORTAL.Y, -PORTAL.depth).add(this.group.position)
  }

  update(t: number, spin: number, power: number) {
    this.inner.rotation.z = spin
    this.glowMats.forEach((m, i) => {
      if (m === this.chevrons) m.color.setRGB(0.4, 0.8, 1).multiplyScalar(0.6 + 2.2 * power)
      else if (m === this.coils) m.color.setRGB(0.4, 0.8, 1).multiplyScalar((0.3 + 1.8 * power) * (0.8 + 0.2 * Math.sin(t * 6)))
      else {
        const k = 0.5 + 0.5 * Math.sin(t * 3 - i * 0.6)
        m.color.setRGB(0.4, 0.8, 1).multiplyScalar(0.3 + 2.6 * power * k)
      }
    })
    this.rimGlow.color.setRGB(0.5, 0.85, 1).multiplyScalar(0.4 + 1.8 * power)
    this.light.intensity = 6 + 16 * power
  }
}

export { HOLE }
