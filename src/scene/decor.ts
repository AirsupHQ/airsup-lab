import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { surf, matte } from '../core/materials'
import { revolve, P2 } from '../core/geometry'
import { rng } from '../core/noise'
import { LAYER_GLOW } from '../render/pipeline'

/**
 * The lived in part of the lab: warm bulbs, wood, workbenches, plants, small
 * models and a hologram or two. Everything here is decoration that sits along
 * the walls, behind the machines, where the cameras see it out of focus.
 */
export class Decor {
  readonly group = new THREE.Group()
  private spinners: { o: THREE.Object3D; speed: number }[] = []
  private flickers: { m: THREE.MeshBasicMaterial; base: THREE.Color; ph: number }[] = []

  constructor(hall: { x0: number; x1: number; z0: number; z1: number }, fusion: THREE.Vector3, line: THREE.Vector3) {
    const G = this.group
    const r = rng(23)
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G, cast = true) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      p.add(mesh)
      return mesh
    }
    const glowMat = (c: THREE.ColorRepresentation, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) })
    const glow = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = G) => {
      const mesh = new THREE.Mesh(g, m)
      mesh.layers.set(LAYER_GLOW)
      p.add(mesh)
      return mesh
    }
    const tex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      draw(c.getContext('2d')!)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      return t
    }

    /* ---------------- materials ---------------- */
    const woodTex = tex(512, 512, (g) => {
      g.fillStyle = '#8a5a35'
      g.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 260; i++) {
        const y = r() * 512
        g.strokeStyle = `rgba(${60 + r() * 40},${30 + r() * 20},${15},${0.08 + r() * 0.12})`
        g.lineWidth = 1 + r() * 3
        g.beginPath()
        g.moveTo(0, y)
        for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4)
        g.stroke()
      }
    })
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping
    const wood = surf({ color: 0xffffff, map: woodTex, metalness: 0, roughness: 0.5, detail: 2, roughVar: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.35 })
    const darkMetal = surf({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4, detail: 3 })
    const steel = surf({ color: 0xb9bdc3, metalness: 1, roughness: 0.3, detail: 4, anisotropy: 0.4 })
    const white = surf({ color: 0xe8e6e1, metalness: 0.05, roughness: 0.45, detail: 2 })
    const red = surf({ color: 0xa32622, metalness: 0.5, roughness: 0.35, clearcoat: 0.7, detail: 3 })
    const gold = surf({ color: 0xc9a045, metalness: 1, roughness: 0.28, detail: 6 })
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.6, flatShading: true })
    const leaf2 = new THREE.MeshStandardMaterial({ color: 0x57924a, roughness: 0.6, flatShading: true })
    const pot = surf({ color: 0xd9d2c5, metalness: 0, roughness: 0.55, detail: 8, colorVar: 0.08 })
    const warm = (k: number) => glowMat(0xffc98a, k)

    /* ---------------- plants ---------------- */
    const plant = (x: number, z: number, s = 1, y = 0) => {
      const g = new THREE.Group()
      g.position.set(x, y, z)
      g.scale.setScalar(s)
      G.add(g)
      add(revolve([[0, 0], [0.16, 0], [0.2, 0.34], [0.215, 0.36], [0.2, 0.37], [0, 0.37]], 32), pot, g)
      for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2, h = 0.45 + r() * 0.55, rad = 0.05 + r() * 0.12
        const f = add(new THREE.IcosahedronGeometry(0.14 + r() * 0.1, 0), i % 2 ? leaf : leaf2, g)
        f.position.set(Math.cos(a) * rad, h, Math.sin(a) * rad)
        f.scale.set(1, 1.3 + r() * 0.6, 1)
        f.rotation.set(r(), r() * 3, r())
      }
    }

    /* ---------------- small props ---------------- */
    const monitor = (p: THREE.Object3D, x: number, y: number, z: number, rotY: number, hue: 'blue' | 'warm' = 'blue') => {
      const g = new THREE.Group()
      g.position.set(x, y, z)
      g.rotation.y = rotY
      p.add(g)
      add(new THREE.BoxGeometry(0.2, 0.012, 0.14), darkMetal, g).position.y = 0.006
      add(new THREE.BoxGeometry(0.03, 0.26, 0.03), darkMetal, g).position.set(0, 0.14, -0.03)
      add(new RoundedBoxGeometry(0.62, 0.38, 0.025, 2, 0.008), darkMetal, g).position.set(0, 0.37, 0)
      const screen = tex(512, 320, (c) => {
        c.fillStyle = hue === 'blue' ? '#0b1b30' : '#1d140c'
        c.fillRect(0, 0, 512, 320)
        c.strokeStyle = hue === 'blue' ? '#5fd0ff' : '#ffb56b'
        c.lineWidth = 3
        c.beginPath()
        for (let i = 0; i <= 60; i++) { const xx = 30 + i * 7.5; const yy = 220 - Math.sin(i * 0.25) * 50 - i * 1.2; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy) }
        c.stroke()
        c.fillStyle = hue === 'blue' ? 'rgba(95,208,255,0.55)' : 'rgba(255,181,107,0.55)'
        for (let i = 0; i < 7; i++) c.fillRect(30 + i * 62, 262, 40, 18 + (i * 37) % 30)
        c.fillRect(30, 30, 160, 14)
        c.fillRect(30, 56, 90, 10)
      })
      glow(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: screen, color: new THREE.Color(1.3, 1.3, 1.3) }), g).position.set(0, 0.37, 0.0135)
    }
    const deskLamp = (p: THREE.Object3D, x: number, y: number, z: number, rotY: number) => {
      const g = new THREE.Group()
      g.position.set(x, y, z)
      g.rotation.y = rotY
      p.add(g)
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 24), darkMetal, g).position.y = 0.01
      const a1 = add(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 8), darkMetal, g)
      a1.position.set(0.05, 0.17, 0)
      a1.rotation.z = -0.3
      const a2 = add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), darkMetal, g)
      a2.position.set(0.16, 0.38, 0)
      a2.rotation.z = 1.1
      const shade = add(revolve([[0.02, 0], [0.09, -0.08], [0.095, -0.085], [0.025, 0.005]], 24), surf({ color: 0x1f2a24, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }), g)
      shade.position.set(0.3, 0.44, 0)
      shade.rotation.z = 0.35
      const bulb = glow(new THREE.SphereGeometry(0.035, 16, 10), warm(6), g)
      bulb.position.set(0.32, 0.39, 0)
    }
    const orb = (p: THREE.Object3D, x: number, y: number, z: number, c: THREE.ColorRepresentation) => {
      add(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 20), darkMetal, p).position.set(x, y + 0.015, z)
      const m = glowMat(c, 2.2)
      glow(new THREE.SphereGeometry(0.06, 20, 14), m, p).position.set(x, y + 0.09, z)
      this.flickers.push({ m, base: m.color.clone(), ph: r() * 10 })
    }
    const books = (p: THREE.Object3D, x: number, y: number, z: number, n: number) => {
      const cols = [0x8c2f2a, 0x2d4f7c, 0xc9a045, 0x3f6b4a, 0xe3ddd2, 0x4a3b62]
      let xx = x
      for (let i = 0; i < n; i++) {
        const w = 0.03 + r() * 0.03, h = 0.2 + r() * 0.1
        const b = add(new THREE.BoxGeometry(w, h, 0.17), matte(cols[i % cols.length], 0.7), p)
        b.position.set(xx + w / 2, y + h / 2, z)
        if (i === n - 1) b.rotation.z = 0.25
        xx += w + 0.004
      }
    }
    const rocketModel = (p: THREE.Object3D, x: number, y: number, z: number, s = 1) => {
      const prof: P2[] = [[0, 0], [0.05, 0], [0.05, 0.02], [0.045, 0.03], [0.045, 0.42], [0.03, 0.5], [0.012, 0.56], [0, 0.58]]
      const m = add(revolve(prof, 32), steel, p)
      m.position.set(x, y + 0.03 * s, z)
      m.scale.setScalar(s)
      add(new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.03 * s, 24), darkMetal, p).position.set(x, y + 0.015 * s, z)
      for (let i = 0; i < 3; i++) {
        const fin = add(new THREE.BoxGeometry(0.004 * s, 0.08 * s, 0.05 * s), darkMetal, p)
        const a = (i / 3) * Math.PI * 2
        fin.position.set(x + Math.cos(a) * 0.055 * s, y + 0.09 * s, z + Math.sin(a) * 0.055 * s)
        fin.rotation.y = -a
      }
    }
    const holo = (p: THREE.Object3D, x: number, y: number, z: number, s = 1) => {
      const g = new THREE.Group()
      g.position.set(x, y, z)
      g.scale.setScalar(s)
      p.add(g)
      add(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 32), darkMetal, g).position.y = 0.025
      glow(new THREE.TorusGeometry(0.13, 0.006, 8, 64).rotateX(Math.PI / 2), glowMat(0x6fd6ff, 3), g).position.y = 0.052
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.4, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1.0).multiplyScalar(0.18), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      cone.position.y = 0.26
      cone.layers.set(LAYER_GLOW)
      g.add(cone)
      const spin = new THREE.Group()
      spin.position.y = 0.3
      g.add(spin)
      const wire = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.85, 1.0).multiplyScalar(2.2), wireframe: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 2), wire)
      globe.layers.set(LAYER_GLOW)
      spin.add(globe)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.003, 6, 96), wire)
      ring.rotation.x = 1.2
      ring.layers.set(LAYER_GLOW)
      spin.add(ring)
      this.spinners.push({ o: spin, speed: 0.35 })
    }
    const mug = (p: THREE.Object3D, x: number, y: number, z: number) => {
      add(revolve([[0, 0], [0.035, 0], [0.04, 0.09], [0.034, 0.09], [0.03, 0.01], [0, 0.01]], 24), white, p).position.set(x, y, z)
    }
    const toolbox = (p: THREE.Object3D, x: number, y: number, z: number) => {
      add(new RoundedBoxGeometry(0.36, 0.16, 0.2, 2, 0.015), red, p).position.set(x, y + 0.08, z)
      add(new THREE.BoxGeometry(0.2, 0.02, 0.02), steel, p).position.set(x, y + 0.18, z)
    }
    const pegboard = (x: number, y: number, z: number, w: number, h: number) => {
      const pb = tex(512, 320, (g) => {
        g.fillStyle = '#c9b89a'
        g.fillRect(0, 0, 512, 320)
        g.fillStyle = 'rgba(60,45,30,0.55)'
        for (let yy = 12; yy < 320; yy += 22) for (let xx = 12; xx < 512; xx += 22) { g.beginPath(); g.arc(xx, yy, 3, 0, Math.PI * 2); g.fill() }
      })
      add(new THREE.BoxGeometry(w, h, 0.02), surf({ color: 0xffffff, map: pb, metalness: 0, roughness: 0.7 }), G, false).position.set(x, y, z)
      // tools hanging
      for (let i = 0; i < 9; i++) {
        const tx = x - w / 2 + 0.15 + (i / 8) * (w - 0.3)
        const len = 0.14 + r() * 0.16
        const t = add(new THREE.BoxGeometry(0.025, len, 0.015), i % 3 === 0 ? red : i % 3 === 1 ? steel : darkMetal, G)
        t.position.set(tx, y + 0.1 - len / 2 + (r() - 0.5) * 0.1, z + 0.02)
        t.rotation.z = (r() - 0.5) * 0.2
      }
      const wrenchRing = add(new THREE.TorusGeometry(0.06, 0.008, 8, 24), steel, G)
      wrenchRing.position.set(x + w / 2 - 0.2, y - 0.18, z + 0.02)
    }

    /* ---------------- workbench ---------------- */
    const bench = (x: number, z: number, w: number, rotY = 0) => {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      g.rotation.y = rotY
      G.add(g)
      const top = add(new RoundedBoxGeometry(w, 0.05, 0.7, 2, 0.01), wood, g)
      top.position.y = 0.9
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.88, 0.05), darkMetal, g).position.set(sx * (w / 2 - 0.08), 0.44, sz * 0.28)
      add(new THREE.BoxGeometry(w - 0.1, 0.03, 0.6), darkMetal, g).position.y = 0.2
      // drawers
      const dr = add(new RoundedBoxGeometry(0.5, 0.5, 0.6, 2, 0.01), red, g)
      dr.position.set(-w / 2 + 0.35, 0.5, 0)
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.3, 0.012, 0.012), steel, g).position.set(-w / 2 + 0.35, 0.33 + i * 0.16, 0.31)
      // warm strip under the shelf above
      return g
    }

    /* ---------------- behind the fusion reactor: a warm wood slat wall with benches ---------------- */
    {
      const F = fusion
      const wz = hall.z0 + 0.02
      const slatW = 0.07, gap = 0.035
      const x0 = F.x - 3.0, x1 = F.x + 3.0
      const slat = new THREE.BoxGeometry(slatW, 4.2, 0.05)
      const count = Math.floor((x1 - x0) / (slatW + gap))
      const im = new THREE.InstancedMesh(slat, wood, count)
      const m = new THREE.Matrix4()
      for (let i = 0; i < count; i++) {
        m.makeTranslation(x0 + i * (slatW + gap), 2.35, wz + 0.03)
        im.setMatrixAt(i, m)
      }
      im.receiveShadow = true
      G.add(im)
      add(new THREE.BoxGeometry(x1 - x0 + 0.1, 4.2, 0.02), matte(0x1a120c, 0.8), G, false).position.set((x0 + x1) / 2 - 0.035, 2.35, wz)
      // warm grazing light along the top and the bottom of the slats
      glow(new THREE.BoxGeometry(x1 - x0, 0.03, 0.03), warm(3.2), G).position.set((x0 + x1) / 2, 4.47, wz + 0.1)
      glow(new THREE.BoxGeometry(x1 - x0, 0.03, 0.03), warm(2.2), G).position.set((x0 + x1) / 2, 0.24, wz + 0.1)
      const wash = new THREE.PointLight(0xffb870, 14, 5.5, 2)
      wash.position.set(F.x, 3.6, wz + 0.9)
      G.add(wash)

      const bL = bench(F.x - 4.35, hall.z0 + 0.45, 2.0)
      monitor(bL, 0.35, 0.925, -0.12, 0.1)
      deskLamp(bL, -0.55, 0.925, -0.05, 0.5)
      mug(bL, 0.75, 0.925, 0.12)
      holo(bL, -0.1, 0.925, 0.12, 0.9)
      pegboard(F.x - 4.35, 1.75, hall.z0 + 0.03, 1.9, 0.8)
      plant(F.x - 5.3, hall.z0 + 0.5, 1.1)

      const bR = bench(F.x + 4.2, hall.z0 + 0.45, 1.9)
      monitor(bR, -0.4, 0.925, -0.12, -0.12, 'warm')
      rocketModel(bR, 0.45, 0.925, -0.05, 1.1)
      toolbox(bR, 0.1, 0.925, 0.12)
      orb(bR, 0.75, 0.925, 0.15, 0xffb46a)
    }

    /* ---------------- shelves on the left wall ---------------- */
    {
      const x = hall.x0 + 0.2
      for (const zc of [3.4]) {
        for (const y of [0.9, 1.5, 2.1, 2.7]) {
          add(new THREE.BoxGeometry(0.34, 0.035, 2.2), wood, G).position.set(x, y, zc)
          glow(new THREE.BoxGeometry(0.02, 0.01, 2.1), warm(1.6), G).position.set(x + 0.15, y - 0.025, zc)
        }
        for (const dz of [-1.1, 1.1]) add(new THREE.BoxGeometry(0.34, 2.4, 0.035), darkMetal, G).position.set(x, 1.7, zc + dz)
        const shelfObj = new THREE.Group()
        shelfObj.position.set(x, 0, zc)
        shelfObj.rotation.y = Math.PI / 2
        G.add(shelfObj)
        books(shelfObj, -0.9, 0.92, 0, 9)
        orb(shelfObj, 0.4, 0.92, 0, 0x7fd8ff)
        rocketModel(shelfObj, 0.7, 1.52, 0, 0.9)
        holo(shelfObj, -0.5, 1.52, 0, 0.7)
        books(shelfObj, 0.1, 2.12, 0, 7)
        orb(shelfObj, -0.7, 2.12, 0, 0xffc27a)
        plant(0, 0, 0.5, 2.72)
        const pl = G.children[G.children.length - 1]
        pl.position.set(x, 2.72, zc + 0.6)
      }
      plant(hall.x0 + 0.5, hall.z0 + 0.5, 1.4)
      plant(hall.x0 + 0.55, 5.6, 1.2)
    }

    /* ---------------- near the engine window and the line ---------------- */
    plant(3.1, hall.z0 + 0.45, 1.25)
    plant(-1.0, hall.z0 + 0.45, 0.9)
    {
      const L = line
      const b = bench(L.x + 4.6, hall.z0 + 0.45, 1.3)
      monitor(b, 0, 0.925, -0.1, 0)
      deskLamp(b, -0.45, 0.925, 0, 0.4)
      plant(hall.x1 - 0.5, hall.z0 + 0.5, 1.3)
      plant(hall.x1 - 0.55, 1.2, 1.1)
      holo(b, 0.45, 0.925, 0.12, 0.8)
    }

    /* ---------------- hanging Edison bulbs: soft bokeh behind every machine ---------------- */
    {
      const spots: [number, number, number][] = []
      const cluster = (cx: number, cz: number, n: number, sx: number, sz: number) => {
        for (let i = 0; i < n; i++) spots.push([cx + (r() - 0.5) * sx, 2.9 + r() * 1.3, cz + (r() - 0.5) * sz])
      }
      cluster(fusion.x, hall.z0 + 1.4, 16, 7.5, 1.8)
      cluster(-0.5, hall.z0 + 1.2, 10, 6, 1.4)
      cluster(line.x, hall.z0 + 1.6, 12, 7, 1.4)
      cluster(hall.x0 + 1.6, 2.5, 6, 1.5, 5)
      cluster(hall.x1 - 1.6, 1.0, 6, 1.5, 5)
      const bulbG = new THREE.SphereGeometry(0.045, 14, 10)
      bulbG.scale(1, 1.3, 1)
      const cableG = new THREE.CylinderGeometry(0.004, 0.004, 1, 5)
      cableG.translate(0, 0.5, 0)
      const capG = new THREE.CylinderGeometry(0.018, 0.02, 0.05, 12)
      const bulbs = new THREE.InstancedMesh(bulbG, warm(5.5), spots.length)
      const cables = new THREE.InstancedMesh(cableG, darkMetal, spots.length)
      const caps = new THREE.InstancedMesh(capG, gold, spots.length)
      const m = new THREE.Matrix4()
      spots.forEach(([x, y, z], i) => {
        bulbs.setMatrixAt(i, m.makeTranslation(x, y, z))
        caps.setMatrixAt(i, m.makeTranslation(x, y + 0.07, z))
        cables.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y + 0.09, z).multiply(new THREE.Matrix4().makeScale(1, 5.2 - y - 0.09, 1)))
      })
      bulbs.layers.set(LAYER_GLOW)
      G.add(bulbs, cables, caps)
    }

    /* ---------------- warm fill so the hall reads light and friendly ---------------- */
    for (const [x, z, k] of [[fusion.x - 1.5, 1.5, 30], [0.4, 2.6, 20], [line.x, 2.4, 22]] as const) {
      const l = new THREE.PointLight(0xffd7a8, k, 11, 2)
      l.position.set(x, 4.3, z)
      G.add(l)
    }
  }

  update(t: number) {
    for (const s of this.spinners) s.o.rotation.y = t * s.speed
    for (const f of this.flickers) f.m.color.copy(f.base).multiplyScalar(0.85 + 0.15 * Math.sin(t * 1.3 + f.ph))
  }
}
