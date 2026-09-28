import { BRAND } from '../brand'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { revolve, ringProfile } from '../core/geometry'
import { LAYER_GLOW } from '../render/pipeline'
import { TR } from './truck'

/** Where the truck stands: the floor point under its middle. It faces +x. */
export const CAR_POS = new THREE.Vector3(21.6, 0, 0.35)
/** Top of the dyno deck the tyres stand on. */
export const DECK = 0.3
/** The drive unit on its own pedestal; y is the top of the pedestal. */
export const DRIVE_POS = new THREE.Vector3(16.7, 1.0, -2.05)
const ROLLER_R = 0.15

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/**
 * The car bay: a chassis dynamometer the truck is strapped to (its wheels turn
 * on rollers so it can drive without moving), a cooling fan in front of it,
 * a blueprint on the wall and a pedestal for the drive unit.
 */
export class CarBay {
  readonly group = new THREE.Group()
  readonly carMount = new THREE.Group()
  readonly driveMount = new THREE.Group()
  readonly ceiling = new THREE.Group()
  readonly lights: THREE.Light[] = []
  key: THREE.SpotLight
  private rollers: THREE.Object3D[] = []
  private fan: THREE.Object3D

  constructor() {
    const G = this.group
    G.add(this.ceiling)
    const C = CAR_POS
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const glow = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation, k: number, p: THREE.Object3D = G) => {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }))
      m.layers.set(LAYER_GLOW)
      p.add(m)
      return m
    }

    /* ---------------- dyno deck ---------------- */
    const plate = canvasTex(512, 512, (g) => {
      g.fillStyle = '#4a4e55'
      g.fillRect(0, 0, 512, 512)
      for (let y = 0; y < 512; y += 32) for (let x = 0; x < 512; x += 32) {
        const o = (y / 32) % 2 ? 16 : 0
        g.save()
        g.translate(x + o + 8, y + 16)
        g.rotate(((y / 32) % 2 ? 1 : -1) * 0.8)
        const gr = g.createLinearGradient(-8, 0, 8, 0)
        gr.addColorStop(0, '#6c717a')
        gr.addColorStop(1, '#2f3237')
        g.fillStyle = gr
        g.fillRect(-9, -2.5, 18, 5)
        g.restore()
      }
    })
    plate.wrapS = plate.wrapT = THREE.RepeatWrapping
    plate.repeat.set(4, 4)
    const deckMat = surf({ color: 0xffffff, map: plate, metalness: 0.85, roughness: 0.42, detail: 3, roughVar: 0.35, colorVar: 0.06 })
    const edgeMat = surf({ color: 0x1b1d21, metalness: 0.6, roughness: 0.4, detail: 3 })
    const hz = canvasTex(1024, 64, (g) => {
      g.fillStyle = '#d8a51c'
      g.fillRect(0, 0, 1024, 64)
      g.fillStyle = '#16181c'
      for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 32, 64); g.lineTo(i * 32 + 16, 64); g.fill() }
    })
    hz.wrapS = THREE.RepeatWrapping
    const x0 = C.x - 3.25, x1 = C.x + 3.0, zw = 1.55
    const slots = [TR.axR, TR.axF].map((ax) => [C.x + ax - 0.42, C.x + ax + 0.42] as const)
    const deckBox = (xa: number, xb: number, za: number, zb: number) => {
      if (xb - xa < 0.01 || zb - za < 0.01) return
      const b = add(new THREE.BoxGeometry(xb - xa, DECK, zb - za), deckMat)
      b.position.set((xa + xb) / 2, DECK / 2, C.z + (za + zb) / 2)
      // map the plate texture in world metres
      const uv = b.geometry.attributes.uv as THREE.BufferAttribute
      const pos = b.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + b.position.x) * 0.5, (pos.getZ(i) + b.position.z) * 0.5 + pos.getY(i) * 0.5)
    }
    let xa = x0
    for (const [sa, sb] of slots) {
      deckBox(xa, sa, -zw, zw)
      deckBox(sa, sb, -zw, -1.22)
      deckBox(sa, sb, 1.22, zw)
      deckBox(sa, sb, -0.5, 0.5)
      xa = sb
    }
    deckBox(xa, x1, -zw, zw)
    // skirt and hazard edge
    for (const s of [-1, 1]) {
      const sk = add(new THREE.BoxGeometry(x1 - x0 + 0.06, DECK - 0.02, 0.04), edgeMat)
      sk.position.set((x0 + x1) / 2, (DECK - 0.02) / 2, C.z + s * (zw + 0.02))
      const strip = add(new THREE.PlaneGeometry(x1 - x0, 0.08), new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6 }), G, false)
      ;(strip.material as THREE.MeshStandardMaterial).map!.repeat.set(16, 1)
      strip.rotation.x = -Math.PI / 2
      strip.position.set((x0 + x1) / 2, DECK + 0.002, C.z + s * (zw - 0.05))
      glow(new THREE.BoxGeometry(x1 - x0, 0.012, 0.012), 0x62b4ff, 2.0).position.set((x0 + x1) / 2, 0.04, C.z + s * (zw + 0.045))
    }
    // pits and rollers
    const rollerMat = surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.26, anisotropy: 0.7, detail: 10, name: 'roller' })
    const knurl = surf({ color: 0x55595f, metalness: 1, roughness: 0.5, detail: 60, bump: 0.002 })
    for (const [sa, sb] of slots) {
      const pit = add(new THREE.BoxGeometry(sb - sa, 0.02, 2.44), matte(0x0d0f12, 0.6), G, false)
      pit.position.set((sa + sb) / 2, 0.01, C.z)
      const ax = (sa + sb) / 2
      for (const dx of [-0.19, 0.19]) {
        const r = new THREE.Group()
        r.position.set(ax + dx, DECK - 0.12, C.z)
        G.add(r)
        const body = add(revolve([[0, -1.2], [ROLLER_R - 0.01, -1.2], [ROLLER_R, -1.18], [ROLLER_R, 1.18], [ROLLER_R - 0.01, 1.2], [0, 1.2]], 48), rollerMat, r)
        body.rotation.x = Math.PI / 2
        // grip bands under each tyre, with a painted index mark so the spin reads
        for (const z of [-TR.track, TR.track]) {
          const band = add(revolve(ringProfile(0.02, ROLLER_R + 0.002, -0.2, 0.2, 0.004), 48), knurl, r)
          band.rotation.x = Math.PI / 2
          band.position.z = z
        }
        const mark = add(new THREE.BoxGeometry(0.03, 0.006, 2.3), matte(0xd8a51c, 0.5), r, false)
        mark.position.y = ROLLER_R + 0.001
        this.rollers.push(r)
      }
      // bearing blocks at the ends
      for (const s of [-1, 1]) {
        const bb = add(new RoundedBoxGeometry(0.62, 0.2, 0.12, 2, 0.02), edgeMat)
        bb.position.set(ax, DECK - 0.12, C.z + s * 1.26)
      }
    }
    // ramp at the back
    {
      const s = new THREE.Shape()
      s.moveTo(0, 0); s.lineTo(1.5, 0); s.lineTo(1.5, DECK); s.lineTo(1.44, DECK); s.closePath()
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.62, bevelEnabled: false })
      for (const z of [-TR.track, TR.track]) {
        const m = add(g, deckMat)
        m.position.set(x0 - 1.5, 0, C.z + z - 0.31)
      }
    }
    this.carMount.position.set(C.x, DECK, C.z)
    G.add(this.carMount)
    // a warm name plate on the deck side
    const np = canvasTex(1024, 192, (g) => {
      g.fillStyle = '#16181c'
      g.fillRect(0, 0, 1024, 192)
      g.fillStyle = '#e8e6e1'
      g.font = '600 78px Outfit, system-ui, sans-serif'
      if (BRAND.shortUrl) g.fillText(BRAND.shortUrl, 40, 108)
      g.fillStyle = '#9aa3ae'
      g.font = '500 38px "DM Mono", ui-monospace, monospace'
      g.fillText('chassis dyno · 4 rollers · 1:1', 40, 164)
    })
    const npm = add(new THREE.PlaneGeometry(0.9, 0.17), surf({ color: 0xffffff, map: np, metalness: 0.4, roughness: 0.4 }), G, false)
    npm.position.set(C.x - 2.0, DECK * 0.5, C.z + zw + 0.045)

    /* ---------------- cooling fan in front of the nose ---------------- */
    {
      const fx = C.x + TR.xF + 1.25
      const f = new THREE.Group()
      f.position.set(fx, 0.95, C.z)
      G.add(f)
      const body = surf({ color: 0x2a3e5c, metalness: 0.55, roughness: 0.42, detail: 3, clearcoat: 0.5 })
      const shroud = add(revolve([[0.56, -0.18], [0.66, -0.18], [0.66, 0.18], [0.56, 0.18]], 96), body, f)
      shroud.rotation.z = Math.PI / 2
      for (const s of [-1, 1]) {
        const leg = add(new THREE.BoxGeometry(0.08, 0.95, 0.08), edgeMat)
        leg.position.set(fx + 0.1, 0.475, C.z + s * 0.5)
        const foot = add(new THREE.BoxGeometry(0.7, 0.04, 0.14), surf({ color: 0xcf9a1c, metalness: 0.3, roughness: 0.5 }))
        foot.position.set(fx + 0.1, 0.02, C.z + s * 0.5)
      }
      const grille = surf({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 })
      for (const rr of [0.18, 0.32, 0.46, 0.6]) {
        const ring = add(new THREE.TorusGeometry(rr, 0.006, 6, 96), grille, f, false)
        ring.rotation.y = Math.PI / 2
        ring.position.x = -0.19
      }
      for (let k = 0; k < 4; k++) {
        const bar = add(new THREE.BoxGeometry(0.01, 1.22, 0.012), grille, f, false)
        bar.position.x = -0.19
        bar.rotation.x = (k / 4) * Math.PI
      }
      const rot = new THREE.Group()
      f.add(rot)
      add(revolve([[0, -0.12], [0.1, -0.12], [0.11, 0.08], [0, 0.12]], 32), edgeMat, rot).rotation.z = Math.PI / 2
      for (let k = 0; k < 7; k++) {
        const bl = add(new THREE.BoxGeometry(0.012, 0.44, 0.15), body, rot)
        const a = (k / 7) * Math.PI * 2
        bl.position.set(0, Math.cos(a) * 0.32, Math.sin(a) * 0.32)
        bl.rotation.set(a + 0.0, 0, 0)
        bl.rotateY(0.45)
      }
      this.fan = rot
    }

    /* ---------------- drive unit pedestal ---------------- */
    {
      const P = DRIVE_POS
      const ped = add(revolve([[0, 0], [0.62, 0], [0.62, 0.04], [0.5, 0.08], [0.44, P.y - 0.07], [0.56, P.y - 0.045], [0.56, P.y - 0.01], [0, P.y - 0.01]], 72), surf({ color: 0x2a2f37, metalness: 0.3, roughness: 0.5, detail: 1.5, roughVar: 0.3, colorVar: 0.05 }))
      ped.position.set(P.x, 0, P.z)
      const ring = glow(new THREE.TorusGeometry(0.562, 0.005, 8, 128), 0x62b4ff, 2.2)
      ring.rotation.x = Math.PI / 2
      ring.position.set(P.x, P.y - 0.02, P.z)
      this.driveMount.position.copy(P)
      G.add(this.driveMount)
    }

    /* ---------------- blueprint of the truck on the back wall ---------------- */
    {
      const W = 2400, H = 1000
      const t = canvasTex(W, H, (g) => {
        g.fillStyle = '#081222'
        g.fillRect(0, 0, W, H)
        g.strokeStyle = 'rgba(80,140,210,0.14)'
        g.lineWidth = 2
        for (let x = 0; x < W; x += 50) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
        for (let y = 0; y < H; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
        const sc = 340, ox = W / 2, oy = H - 170
        const P = (x: number, y: number): [number, number] => [ox + x * sc, oy - y * sc]
        const topAt = (x: number) => (x >= -0.25 ? 1.03 + ((2.84 - x) / 3.09) * 0.76 : 1.79 - ((-0.25 - x) / 2.59) * 0.57)
        g.strokeStyle = 'rgba(140,200,255,0.95)'
        g.lineWidth = 5
        g.beginPath()
        const outline: [number, number][] = [[2.84, 0.94], [2.84, 1.03], [-0.25, 1.79], [-2.84, 1.22], [-2.84, 0.64], [-2.71, 0.48], [-2.49, 1.02], [-1.69, 1.02], [-1.47, 0.48], [1.1, 0.48], [1.32, 1.02], [2.12, 1.02], [2.34, 0.48], [2.7, 0.5]]
        outline.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py) })
        g.closePath()
        g.stroke()
        // windows
        g.strokeStyle = 'rgba(120,220,255,0.55)'
        g.lineWidth = 3
        g.beginPath()
        for (const [x, y] of [[0.975, 1.4], [-0.85, 1.31], [-0.85, topAt(-0.85)], [-0.25, 1.79], [0.975, topAt(0.975)]] as [number, number][]) g.lineTo(...P(x, y))
        g.closePath()
        g.stroke()
        // wheels, pack and motors
        for (const ax of [1.72, -2.09]) {
          g.strokeStyle = 'rgba(140,200,255,0.95)'
          g.lineWidth = 4
          g.beginPath(); g.arc(...P(ax, 0.445), 0.445 * sc, 0, Math.PI * 2); g.stroke()
          g.beginPath(); g.arc(...P(ax, 0.445), 0.27 * sc, 0, Math.PI * 2); g.stroke()
          g.strokeStyle = 'rgba(255,200,120,0.9)'
          g.beginPath(); g.arc(...P(ax, 0.445), 0.14 * sc, 0, Math.PI * 2); g.stroke()
        }
        g.strokeStyle = 'rgba(95,208,255,0.9)'
        g.lineWidth = 4
        const [bx, by] = P(-1.52, 0.47)
        g.strokeRect(bx, by, 2.74 * sc, 0.18 * sc)
        g.setLineDash([12, 10])
        g.strokeStyle = 'rgba(140,200,255,0.55)'
        g.lineWidth = 2
        g.beginPath(); g.moveTo(...P(-3.1, 0)); g.lineTo(...P(3.1, 0)); g.stroke()
        g.setLineDash([])
        g.fillStyle = 'rgba(190,210,240,0.85)'
        g.font = '500 34px "DM Mono", ui-monospace, monospace'
        g.fillText('5.68 m', ...P(-0.3, -0.3))
        g.fillText('3.81 m wheelbase', ...P(-1.2, 2.25))
      })
      const w = 5.4, h = 2.25
      const fr = add(new RoundedBoxGeometry(w + 0.12, h + 0.12, 0.06, 2, 0.012), surf({ color: 0x2a2f37, metalness: 0.7, roughness: 0.35, detail: 4 }), G, false)
      fr.position.set(C.x, 2.85, -4.54)
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1, 1, 1).multiplyScalar(1.05) }))
      pic.position.set(C.x, 2.85, -4.505)
      pic.layers.set(LAYER_GLOW)
      G.add(pic)
    }

    /* ---------------- studio light strips over the truck ---------------- */
    // a honeycomb of light bars, the way detailing studios light a car
    {
      const s = 0.46, hw = 3.6, hd = 2.3, y = 4.9
      const edges = new Map<string, [number, number, number, number]>()
      const key = (a: number, b: number) => `${a.toFixed(3)},${b.toFixed(3)}`
      const dx = Math.sqrt(3) * s, dz = 1.5 * s
      for (let row = -6; row <= 6; row++) for (let col = -8; col <= 8; col++) {
        const cx = col * dx + (row % 2 ? dx / 2 : 0), cz = row * dz
        if (Math.abs(cx) > hw - s || Math.abs(cz) > hd - s) continue
        for (let k = 0; k < 6; k++) {
          const a0 = (Math.PI / 3) * k + Math.PI / 6, a1 = a0 + Math.PI / 3
          const x0 = cx + Math.cos(a0) * s, z0 = cz + Math.sin(a0) * s, x1 = cx + Math.cos(a1) * s, z1 = cz + Math.sin(a1) * s
          const kk = [key(x0, z0), key(x1, z1)].sort().join('|')
          edges.set(kk, [x0, z0, x1, z1])
        }
      }
      const bar = new THREE.BoxGeometry(1, 0.025, 0.035)
      const im = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff8f0).multiplyScalar(2.6) }), edges.size)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
      let i = 0
      for (const [x0, z0, x1, z1] of edges.values()) {
        const len = Math.hypot(x1 - x0, z1 - z0) - 0.04
        p.set(C.x + (x0 + x1) / 2, y, C.z + (z0 + z1) / 2)
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(z1 - z0, x1 - x0))
        sc.set(len, 1, 1)
        im.setMatrixAt(i++, m.compose(p, q, sc))
      }
      im.layers.set(LAYER_GLOW)
      this.ceiling.add(im)
      // the frame around it
      for (const [w, d, x, z] of [[2 * hw + 0.1, 0.08, 0, -hd], [2 * hw + 0.1, 0.08, 0, hd], [0.08, 2 * hd, -hw, 0], [0.08, 2 * hd, hw, 0]] as const) {
        add(new THREE.BoxGeometry(w, 0.06, d), matte(0x15181d, 0.5), this.ceiling, false).position.set(C.x + x, y + 0.01, C.z + z)
        glow(new THREE.BoxGeometry(w, 0.02, d * 0.4), 0xfff8f0, 2.6, this.ceiling).position.set(C.x + x, y - 0.03, C.z + z)
      }
      add(new THREE.BoxGeometry(2 * hw, 0.02, 2 * hd), matte(0x0e1013, 0.6), this.ceiling, false).position.set(C.x, y + 0.04, C.z)
    }

    /* ---------------- long light bars on the walls: they paint the highlights down the steel ---------------- */
    for (const [z, ys, face] of [[7.9, [0.8, 1.3, 1.8, 2.3, 2.8, 3.3], -1], [-4.5, [0.85, 1.35], 1]] as const) {
      for (const y of ys) {
        glow(new THREE.BoxGeometry(8.5, 0.16, 0.03), 0xfff6ec, 3.2).position.set(C.x, y, z)
        add(new THREE.BoxGeometry(8.7, 0.22, 0.05), matte(0x15181d, 0.5), G, false).position.set(C.x, y, z - face * 0.03)
      }
    }
    // tall softboxes either side of the nose and the tail
    for (const x of [C.x + 4.6, C.x - 4.6]) {
      const panel = glow(new THREE.PlaneGeometry(1.1, 2.6), 0xfff4e8, 1.6)
      panel.position.set(x * 0 + (x > C.x ? C.x + 4.3 : C.x - 4.3), 1.9, C.z - 3.3)
      panel.lookAt(C.x, 1.2, C.z)
      const frame = add(new THREE.BoxGeometry(1.2, 2.7, 0.06), matte(0x15181d, 0.5))
      frame.position.copy(panel.position)
      frame.quaternion.copy(panel.quaternion)
      frame.translateZ(-0.04)
      const stand = add(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), matte(0x15181d, 0.5))
      stand.position.set(panel.position.x, 0.3, C.z - 3.3)
    }

    /* ---------------- lights ---------------- */
    const key = new THREE.SpotLight(0xfff0de, 230, 20, 0.62, 0.85, 2)
    key.position.set(C.x - 2.2, 5.0, C.z + 4.6)
    key.target.position.set(C.x, 0.9, C.z)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0001
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 2
    key.shadow.camera.far = 14
    G.add(key, key.target)
    this.key = key
    const rim = new THREE.SpotLight(0x9dc0ff, 200, 16, 0.7, 0.9, 2)
    rim.position.set(C.x + 3.5, 4.2, C.z - 3.8)
    rim.target.position.set(C.x, 1.0, C.z)
    G.add(rim, rim.target)
    const fill = new THREE.SpotLight(0xffe2c4, 90, 16, 0.8, 0.9, 2)
    fill.position.set(C.x + 4.6, 3.2, C.z + 3.4)
    fill.target.position.set(C.x, 1.0, C.z)
    G.add(fill, fill.target)
    const dKey = new THREE.SpotLight(0xfff2e2, 110, 9, 0.45, 0.8, 2)
    dKey.position.set(DRIVE_POS.x + 0.9, 4.6, DRIVE_POS.z + 1.6)
    dKey.target.position.set(DRIVE_POS.x, DRIVE_POS.y + 0.25, DRIVE_POS.z)
    G.add(dKey, dKey.target)
    const dRim = new THREE.SpotLight(0x8fb8ff, 80, 9, 0.5, 0.85, 2)
    dRim.position.set(DRIVE_POS.x - 1.8, 3.0, DRIVE_POS.z - 1.6)
    dRim.target.position.set(DRIVE_POS.x, DRIVE_POS.y + 0.3, DRIVE_POS.z)
    G.add(dRim, dRim.target)
    this.lights.push(key, rim, fill, dKey, dRim)
  }

  /** wheel surface speed in m/s */
  update(dt: number, v: number) {
    for (const r of this.rollers) r.rotation.z += (visualSpin(v / ROLLER_R) * dt)
    this.fan.rotation.x -= (2 + Math.min(1, v / 30) * 22) * dt
  }
}

/** Real spin rates alias into a crawl on screen; keep the look of speed without the strobing. */
export function visualSpin(omega: number) {
  const cap = 19
  return cap * Math.tanh(omega / cap)
}

