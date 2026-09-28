import * as THREE from 'three'

export interface LabelDef {
  id: string
  text: string
  sub?: string | (() => string)
  cls?: string
  /** world position provider; return null to hide */
  at: () => THREE.Vector3 | null
  /** 0..1 visibility wanted right now */
  vis: () => number
}

interface Live extends LabelDef {
  el: HTMLDivElement
  subEl: HTMLElement | null
  op: number
  w: number
  x: number
  y: number
  yAdj: number
  on: boolean
}

/**
 * Screen-space pills anchored to points in the scene. Opacity is smoothed with
 * the simulation clock (so recordings are frame exact) and overlapping pills
 * are nudged apart vertically.
 */
export class Labels {
  private items: Live[] = []
  private v = new THREE.Vector3()
  constructor(private root: HTMLElement, private camera: THREE.PerspectiveCamera) {}

  add(d: LabelDef) {
    const el = document.createElement('div')
    el.className = 'lbl ' + (d.cls ?? '')
    el.innerHTML = `<i></i><span>${d.text}</span>`
    let subEl: HTMLElement | null = null
    if (d.sub) {
      subEl = document.createElement('em')
      el.appendChild(subEl)
    }
    this.root.appendChild(el)
    this.items.push({ ...d, el, subEl, op: 0, w: 0, x: 0, y: 0, yAdj: 0, on: false })
  }

  update(w: number, h: number, dt: number) {
    const cam = this.camera
    const k = 1 - Math.exp(-dt * 9)
    const live: Live[] = []
    for (const it of this.items) {
      const want = it.vis()
      const p = want > 0.01 ? it.at() : null
      let target = 0
      if (p) {
        this.v.copy(p).project(cam)
        const x = (this.v.x * 0.5 + 0.5) * w
        const y = (-this.v.y * 0.5 + 0.5) * h
        const margin = 36
        if (this.v.z < 1 && this.v.z > -1 && x > margin && x < w - margin && y > margin && y < h - margin) {
          target = want
          it.x = x
          it.y = y
        }
      }
      it.op += (target - it.op) * k
      if (it.op < 0.01 && target === 0) it.op = 0
      if (it.op > 0) {
        if (it.subEl && it.sub) {
          const s = typeof it.sub === 'function' ? it.sub() : it.sub
          if (it.subEl.textContent !== s) { it.subEl.textContent = s; it.w = 0 }
        }
        if (!it.w) it.w = it.el.offsetWidth || 120
        live.push(it)
      }
    }
    // relax overlaps: push pairs apart vertically
    for (const it of live) it.yAdj = it.y
    for (let iter = 0; iter < 6; iter++) {
      let moved = false
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j]
          const dx = Math.abs(a.x - b.x), dy = a.yAdj - b.yAdj
          const minX = (a.w + b.w) / 2 + 6, minY = 26
          if (dx < minX && Math.abs(dy) < minY) {
            const push = (minY - Math.abs(dy)) / 2 + 0.5
            const s = dy >= 0 ? 1 : -1
            a.yAdj += s * push
            b.yAdj -= s * push
            moved = true
          }
        }
      if (!moved) break
    }
    for (const it of this.items) {
      const vis = it.op > 0.004
      if (vis !== it.on) { it.el.style.display = vis ? 'flex' : 'none'; it.on = vis }
      if (!vis) continue
      it.el.style.opacity = it.op.toFixed(3)
      it.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.yAdj.toFixed(1)}px) translate(-50%, -50%)`
    }
  }
}
