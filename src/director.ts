import { BRAND } from './brand'
import { CameraRig, SHOTS, Shot } from './camera'
import { PUMP_POS } from './scene/room'
import type { Exhibit } from './state'

export type TourName = 'main' | 'pump' | 'fusion' | 'line' | 'hall' | 'car' | 'motor' | 'robot' | 'hole' | 'jet' | 'f1' | 'drone' | 'grand'

type Step =
  | { t: number; shot: string | Shot; dur: number; lift?: number }
  | { t: number; move: string; dur: number; dx?: number; dy?: number }
  | { t: number; click: string }
  | { t: number; drag: string; from: number; to: number; dur: number }
  | { t: number; run: () => void }
  | { t: number; cursor: 'show' | 'hide' }
  | { t: number; end: true }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** A scripted tour: camera moves plus a visible cursor that really clicks the controls. */
export class Director {
  private steps: Step[] = []
  private idx = 0
  private t0 = 0
  active = false
  readonly cursor: HTMLDivElement
  private cx = -100
  private cy = -100
  private move: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number } | null = null
  private drag: { el: HTMLInputElement; from: number; to: number; t: number; dur: number } | null = null
  private clickT = -10
  private endAt = -1
  private ring!: SVGElement
  private ripple!: HTMLElement
  duration = 0
  onEnd: (() => void) | null = null

  constructor(private rig: CameraRig) {
    const c = document.createElement('div')
    c.id = 'cursor'
    c.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="11" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.9)" stroke-width="1.6"/></svg>
      <svg class="arrow" width="18" height="22" viewBox="0 0 18 22"><path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6.1z" fill="#fff" stroke="#0b0f17" stroke-width="1.3" stroke-linejoin="round"/></svg>
      <span class="ripple"></span>`
    document.getElementById('app')!.appendChild(c)
    this.cursor = c
    this.ring = c.querySelector('svg') as SVGElement
    this.ripple = c.querySelector('.ripple') as HTMLElement
    const st = document.createElement('style')
    st.textContent = `#cursor{position:absolute;left:0;top:0;z-index:50;pointer-events:none;opacity:0;transition:opacity .3s;will-change:transform}
#cursor>svg:first-child{position:absolute;left:-15px;top:-15px}
#cursor .arrow{position:absolute;left:3px;top:3px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
#cursor .ripple{position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,.85);opacity:0;transform:scale(.3)}
`
    document.head.appendChild(st)
  }

  private center(sel: string, dx = 0, dy = 0) {
    const el = document.querySelector<HTMLElement>(sel)
    if (!el) return { x: this.cx, y: this.cy }
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2 + dx, y: r.top + r.height / 2 + dy }
  }

  private thumb(el: HTMLInputElement, v: number) {
    const r = el.getBoundingClientRect()
    const min = Number(el.min), max = Number(el.max)
    const half = 8
    return { x: r.left + half + ((r.width - 2 * half) * (v - min)) / (max - min), y: r.top + r.height / 2 }
  }

  load(steps: Step[], startShot?: string) {
    this.steps = steps.slice().sort((a, b) => a.t - b.t)
    this.duration = Math.max(...this.steps.map((s) => s.t + ('dur' in s ? s.dur : 0))) + 1.5
    this.idx = 0
    this.active = true
    this.endAt = -1
    endCard(0)
    this.move = null
    this.drag = null
    this.cx = window.innerWidth * 0.82
    this.cy = window.innerHeight * 1.05
    if (startShot) this.rig.set(SHOTS[startShot])
  }

  start(now: number) {
    this.t0 = now
  }

  stop() {
    this.active = false
    endCard(0)
    this.cursor.style.opacity = '0'
    this.move = null
    this.drag = null
  }

  /** Advance to absolute sim time `now`. Deterministic for a fixed step. */
  update(now: number) {
    if (!this.active) return
    const t = now - this.t0
    while (this.idx < this.steps.length && this.steps[this.idx].t <= t) {
      const s = this.steps[this.idx++]
      if ('shot' in s) this.rig.fly(s.shot, s.dur, s.lift ?? 0)
      else if ('move' in s) {
        const p = this.center(s.move, s.dx, s.dy)
        this.move = { x0: this.cx, y0: this.cy, x1: p.x, y1: p.y, t: s.t, dur: s.dur }
      } else if ('click' in s) {
        const el = document.querySelector<HTMLElement>(s.click)
        this.clickT = s.t
        el?.click()
      } else if ('drag' in s) {
        const el = document.querySelector<HTMLInputElement>(s.drag)
        if (el) this.drag = { el, from: s.from, to: s.to, t: s.t, dur: s.dur }
      } else if ('run' in s) s.run()
      else if ('cursor' in s) this.cursor.style.opacity = s.cursor === 'show' ? '1' : '0'
      else if ('end' in s) this.endAt = s.t
    }
    if (this.move) {
      const k = Math.min(1, (t - this.move.t) / this.move.dur)
      const e = ease(k)
      const m = this.move
      const bow = Math.sin(Math.PI * e) * Math.min(60, Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * 0.12)
      const nx = -(m.y1 - m.y0), ny = m.x1 - m.x0
      const nl = Math.hypot(nx, ny) || 1
      this.cx = m.x0 + (m.x1 - m.x0) * e + (nx / nl) * bow
      this.cy = m.y0 + (m.y1 - m.y0) * e + (ny / nl) * bow
      if (k >= 1) this.move = null
    }
    if (this.drag) {
      const d = this.drag
      const k = Math.min(1, (t - d.t) / d.dur)
      const v = d.from + (d.to - d.from) * ease(k)
      d.el.value = String(Math.round(v))
      d.el.dispatchEvent(new Event('input', { bubbles: true }))
      const p = this.thumb(d.el, v)
      this.cx = p.x
      this.cy = p.y
      if (k >= 1) this.drag = null
    }
    const rk = (t - this.clickT) / 0.55
    if (rk >= 0 && rk <= 1) {
      this.ripple.style.opacity = (0.9 * (1 - rk)).toFixed(3)
      this.ripple.style.transform = `scale(${(0.3 + 1.1 * rk).toFixed(3)})`
    } else this.ripple.style.opacity = '0'
    const pressed = (t - this.clickT >= 0 && t - this.clickT < 0.14) || !!this.drag
    this.ring.style.transform = pressed ? 'scale(0.8)' : 'scale(1)'
    this.cursor.style.transform = `translate(${this.cx.toFixed(1)}px, ${this.cy.toFixed(1)}px)`
    if (this.endAt >= 0) endCard(Math.min(1, (t - this.endAt) / 0.9))
    if (t > this.duration) {
      this.stop()
      this.onEnd?.()
    }
  }
}

const seg = (key: string, v: string) => `.seg[data-key="${key}"] button[data-v="${v}"]`

/** Main film: ~33 s through every control. */
export function mainTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'estab', dur: 0.01 },
    { t: 0.05, shot: 'hero', dur: 3.6 },
    { t: 2.9, cursor: 'show' },
    { t: 3.0, move: seg('view', 'cut'), dur: 0.9 },
    { t: 4.0, click: seg('view', 'cut') },
    { t: 4.1, shot: 'cut', dur: 2.6 },
    { t: 6.8, move: seg('follow', 'oxygen'), dur: 0.7 },
    { t: 7.6, click: seg('follow', 'oxygen') },
    { t: 7.7, shot: 'ox', dur: 2.5 },
    { t: 10.3, move: seg('follow', 'methane'), dur: 0.5 },
    { t: 10.9, click: seg('follow', 'methane') },
    { t: 11.0, shot: 'ch4', dur: 2.5 },
    { t: 13.6, move: seg('follow', 'fire'), dur: 0.5 },
    { t: 14.2, click: seg('follow', 'fire') },
    { t: 14.3, shot: 'fire', dur: 2.4 },
    { t: 16.8, move: seg('follow', 'all'), dur: 0.55 },
    { t: 17.4, click: seg('follow', 'all') },
    { t: 17.6, move: seg('view', 'whole'), dur: 0.5 },
    { t: 18.15, click: seg('view', 'whole') },
    { t: 18.2, shot: 'hero', dur: 1.8 },
    { t: 20.0, shot: 'plume', dur: 2.4 },
    { t: 18.9, move: '#throttle', dur: 0.7, dx: 60 },
    { t: 19.7, drag: '#throttle', from: 100, to: 40, dur: 1.5 },
    { t: 21.9, drag: '#throttle', from: 40, to: 100, dur: 0.9 },
    { t: 23.0, move: seg('alt', '14'), dur: 0.6 },
    { t: 23.7, click: seg('alt', '14') },
    { t: 23.8, shot: 'vacuum', dur: 2.6 },
    { t: 24.9, move: seg('alt', '90'), dur: 0.35 },
    { t: 25.35, click: seg('alt', '90') },
    { t: 26.1, move: seg('alt', '0'), dur: 0.45 },
    { t: 26.6, click: seg('alt', '0') },
    { t: 26.8, move: seg('view', 'exploded'), dur: 0.5 },
    { t: 27.4, click: seg('view', 'exploded') },
    { t: 27.5, shot: 'exploded', dur: 2.0 },
    { t: 29.6, move: '#exhibits button[data-ex="pump"]', dur: 0.7 },
    { t: 30.4, click: '#exhibits button[data-ex="pump"]' },
    { t: 30.5, shot: 'pump', dur: 1.9, lift: 0.3 },
    { t: 31.4, cursor: 'hide' },
    { t: 32.2, end: true },
    { t: 33.2, run: () => {} },
  ]
}

/** Turbopump film: ~25 s. */
export function pumpTour(reset: () => void): Step[] {
  const P = PUMP_POS
  const at = (dx: number, dy: number, dz: number, tx: number, ty: number, tz = 0): Shot => ({ pos: [P.x + dx, P.y + dy, P.z + dz], target: [P.x + tx, P.y + ty, P.z + tz], fov: 30 })
  return [
    { t: 0, run: reset },
    { t: 0, shot: at(1.1, 0.7, 2.3, 0.04, 0.26), dur: 0.01 },
    { t: 0.05, shot: 'pump', dur: 3.2 },
    { t: 2.2, cursor: 'show' },
    { t: 2.3, move: seg('pfollow', 'oxygen'), dur: 0.9 },
    { t: 3.3, click: seg('pfollow', 'oxygen') },
    { t: 3.4, shot: at(0.52, 0.42, 1.3, 0.18, 0.27), dur: 2.8 },
    { t: 6.5, move: seg('pfollow', 'gas'), dur: 0.6 },
    { t: 7.2, click: seg('pfollow', 'gas') },
    { t: 7.3, shot: at(-0.32, 0.42, 1.28, -0.12, 0.27), dur: 2.6 },
    { t: 10.2, move: '#strobe', dur: 0.6 },
    { t: 10.9, click: '#strobe' },
    { t: 11.0, shot: at(-0.1, 0.36, 1.12, -0.08, 0.27), dur: 2.0 },
    { t: 13.2, click: '#strobe' },
    { t: 13.5, move: seg('pmode', 'cav'), dur: 0.6 },
    { t: 14.2, click: seg('pmode', 'cav') },
    { t: 14.3, shot: at(0.46, 0.38, 1.12, 0.22, 0.27), dur: 2.4 },
    { t: 17.4, move: seg('pmode', 'start'), dur: 0.6 },
    { t: 18.1, click: seg('pmode', 'start') },
    { t: 18.2, shot: 'pump', dur: 2.6 },
    { t: 21.3, move: seg('pview', 'exploded'), dur: 0.6 },
    { t: 22.0, click: seg('pview', 'exploded') },
    { t: 22.1, shot: at(0.9, 0.62, 2.0, 0.0, 0.26), dur: 2.0 },
    { t: 23.2, cursor: 'hide' },
    { t: 23.6, end: true },
    { t: 24.8, run: () => {} },
  ]
}

/** Closing card for the films: the link, calm and small. Opacity driven by the sim clock. */
export function endCard(opacity: number) {
  let el = document.getElementById('endcard')
  if (!el) {
    el = document.createElement('div')
    el.id = 'endcard'
    el.innerHTML = `<div class="ec-in"><span class="ec-k">Take it apart yourself</span>${BRAND.shortUrl ? `<span class="ec-u">${BRAND.shortUrl}</span>` : ''}</div>`
    document.getElementById('app')!.appendChild(el)
  }
  el.style.opacity = opacity.toFixed(3)
  el.style.display = opacity > 0.001 ? 'grid' : 'none'
}

const nav = (ex: string) => `#exhibits button[data-ex="${ex}"]`

/** Fusion film (the main post): ~46 s. */
export function fusionTour(reset: () => void, go: (ex: Exhibit) => () => void): Step[] {
  void go
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'fusionEstab', dur: 0.01 },
    { t: 0.05, shot: 'fusion', dur: 3.4 },
    { t: 2.6, cursor: 'show' },
    { t: 2.7, move: seg('fview', 'cut'), dur: 0.9 },
    { t: 3.7, click: seg('fview', 'cut') },
    { t: 6.0, move: seg('ffollow', 'plasma'), dur: 0.7 },
    { t: 6.8, click: seg('ffollow', 'plasma') },
    { t: 6.9, shot: 'fusionPlasma', dur: 2.6 },
    { t: 10.0, move: seg('ffollow', 'magnets'), dur: 0.6 },
    { t: 10.7, click: seg('ffollow', 'magnets') },
    { t: 10.8, shot: 'fusionField', dur: 2.4 },
    { t: 13.8, move: seg('ffollow', 'neutrons'), dur: 0.5 },
    { t: 14.4, click: seg('ffollow', 'neutrons') },
    { t: 14.5, shot: 'fusionNeutron', dur: 2.3 },
    { t: 17.4, move: seg('ffollow', 'power'), dur: 0.5 },
    { t: 18.0, click: seg('ffollow', 'power') },
    { t: 18.1, shot: 'fusionPower', dur: 2.6, lift: 0.2 },
    { t: 21.0, move: '#temp', dur: 0.6, dx: 50 },
    { t: 21.7, drag: '#temp', from: 150, to: 15, dur: 1.8 },
    { t: 24.6, drag: '#temp', from: 15, to: 180, dur: 2.2 },
    { t: 25.0, shot: 'fusionPowerWide', dur: 3.2 },
    { t: 28.6, drag: '#temp', from: 180, to: 150, dur: 0.6 },
    { t: 29.4, move: seg('ffollow', 'all'), dur: 0.5 },
    { t: 30.0, click: seg('ffollow', 'all') },
    { t: 30.2, move: seg('fview', 'exploded'), dur: 0.45 },
    { t: 30.7, click: seg('fview', 'exploded') },
    { t: 30.8, shot: 'fusionExploded', dur: 2.0 },
    { t: 32.8, move: seg('fview', 'cut'), dur: 0.45 },
    { t: 33.3, click: seg('fview', 'cut') },
    { t: 33.4, shot: 'fusion', dur: 1.8 },
    { t: 34.0, move: seg('fmode', 'disrupt'), dur: 0.5 },
    { t: 34.6, click: seg('fmode', 'disrupt') },
    { t: 37.2, move: seg('fmode', 'start'), dur: 0.5 },
    { t: 37.8, click: seg('fmode', 'start') },
    { t: 39.6, move: nav('hall'), dur: 0.7 },
    { t: 40.4, click: nav('hall') },
    { t: 40.5, shot: 'hall', dur: 3.0 },
    { t: 41.2, cursor: 'hide' },
    { t: 43.2, end: true },
    { t: 44.4, run: () => {} },
  ]
}

/** Production line film: ~30 s. */
export function lineTour(reset: () => void, go: (ex: Exhibit) => () => void): Step[] {
  void go
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'lineWide', dur: 0.01 },
    { t: 0.05, shot: 'line', dur: 3.0 },
    { t: 2.4, cursor: 'show' },
    { t: 2.5, move: '#framespeed', dur: 0.8, dx: -40 },
    { t: 3.4, drag: '#framespeed', from: 100, to: 200, dur: 1.4 },
    { t: 3.5, shot: 'lineClose', dur: 2.6 },
    { t: 8.4, move: seg('robots', '2'), dur: 0.6 },
    { t: 9.1, click: seg('robots', '2') },
    { t: 9.2, shot: 'lineBottleneck', dur: 2.2 },
    { t: 12.2, shot: 'lineScreen', dur: 2.4 },
    { t: 15.2, move: '#framespeed', dur: 0.5, dx: 40 },
    { t: 15.8, drag: '#framespeed', from: 200, to: 100, dur: 0.8 },
    { t: 16.8, move: seg('breakdowns', 'on'), dur: 0.6 },
    { t: 17.5, click: seg('breakdowns', 'on') },
    { t: 17.6, shot: 'line', dur: 2.4 },
    { t: 20.6, move: seg('buffer', '0'), dur: 0.5 },
    { t: 21.2, click: seg('buffer', '0') },
    { t: 24.4, move: seg('buffer', '6'), dur: 0.5 },
    { t: 25.0, click: seg('buffer', '6') },
    { t: 27.6, move: nav('hall'), dur: 0.7 },
    { t: 28.4, click: nav('hall') },
    { t: 28.5, shot: 'hall', dur: 2.8 },
    { t: 29.2, cursor: 'hide' },
    { t: 31.0, end: true },
    { t: 32.2, run: () => {} },
  ]
}

/** A walk through the whole lab: ~31 s. */
export function hallTour(go: (ex: Exhibit) => () => void, r: { resetFusion: () => void; resetEngine: () => void; resetLine: () => void }): Step[] {
  return [
    { t: 0, run: () => { r.resetFusion(); r.resetLine(); r.resetEngine(); go('hall')() } },
    { t: 0, shot: { pos: [15.2, 4.2, 7.0], target: [-2.0, 1.0, -1.2], fov: 42 }, dur: 0.01 },
    { t: 0.05, shot: 'hall', dur: 3.0 },
    { t: 1.8, cursor: 'show' },
    { t: 1.9, move: '.spot[data-ex="engine"] b', dur: 0.9 },
    { t: 2.9, click: '.spot[data-ex="engine"]' },
    { t: 3.0, shot: 'hero', dur: 2.8, lift: 0.3 },
    { t: 6.0, move: seg('view', 'cut'), dur: 0.7 },
    { t: 6.8, click: seg('view', 'cut') },
    { t: 6.9, shot: 'cut', dur: 2.2 },
    { t: 9.3, move: seg('follow', 'fire'), dur: 0.5 },
    { t: 9.9, click: seg('follow', 'fire') },
    { t: 10.0, shot: 'fire', dur: 2.0 },
    { t: 12.3, move: seg('view', 'whole'), dur: 0.5 },
    { t: 12.9, click: seg('view', 'whole') },
    { t: 13.0, shot: 'plume', dur: 2.0 },
    { t: 13.6, move: '#throttle', dur: 0.6, dx: 60 },
    { t: 14.3, drag: '#throttle', from: 100, to: 40, dur: 1.2 },
    { t: 15.9, drag: '#throttle', from: 40, to: 100, dur: 0.8 },
    { t: 17.0, move: nav('pump'), dur: 0.7 },
    { t: 17.8, click: nav('pump') },
    { t: 17.9, shot: 'pump', dur: 2.4, lift: 0.3 },
    { t: 20.5, move: '#strobe', dur: 0.6 },
    { t: 21.2, click: '#strobe' },
    { t: 21.3, shot: 'pumpClose', dur: 1.8 },
    { t: 23.4, click: '#strobe' },
    { t: 23.6, move: nav('line'), dur: 0.7 },
    { t: 24.4, click: nav('line') },
    { t: 24.5, shot: 'line', dur: 2.8, lift: 0.4 },
    { t: 27.8, move: nav('fusion'), dur: 0.7 },
    { t: 28.6, click: nav('fusion') },
    { t: 28.7, shot: 'fusion', dur: 3.2, lift: 0.8 },
    { t: 30.4, cursor: 'hide' },
    { t: 32.4, end: true },
    { t: 33.6, run: () => {} },
  ]
}

/** Truck film: ~34 s. */
export function carTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'carEstab', dur: 0.01 },
    { t: 0.05, shot: 'car', dur: 3.2 },
    { t: 2.4, cursor: 'show' },
    { t: 2.5, move: '#cspeed', dur: 0.8, dx: -30 },
    { t: 3.4, drag: '#cspeed', from: 0, to: 120, dur: 1.8 },
    { t: 3.5, shot: 'carRear', dur: 3.2, lift: 0.3 },
    { t: 7.2, move: seg('cview', 'xray'), dur: 0.7 },
    { t: 8.0, click: seg('cview', 'xray') },
    { t: 8.1, shot: 'carXray', dur: 2.6 },
    { t: 11.0, move: seg('cfollow', 'energy'), dur: 0.6 },
    { t: 11.7, click: seg('cfollow', 'energy') },
    { t: 11.8, shot: 'carEnergy', dur: 2.4 },
    { t: 14.6, move: seg('cfollow', 'motors'), dur: 0.5 },
    { t: 15.2, click: seg('cfollow', 'motors') },
    { t: 15.3, shot: 'carMotors', dur: 2.4 },
    { t: 18.2, move: seg('cmode', 'regen'), dur: 0.5 },
    { t: 18.8, click: seg('cmode', 'regen') },
    { t: 21.4, move: seg('cfollow', 'all'), dur: 0.5 },
    { t: 21.9, click: seg('cfollow', 'all') },
    { t: 22.2, move: seg('cview', 'whole'), dur: 0.4 },
    { t: 22.7, click: seg('cview', 'whole') },
    { t: 22.8, shot: 'car', dur: 2.0 },
    { t: 23.2, move: seg('cheight', 'high'), dur: 0.5 },
    { t: 23.8, click: seg('cheight', 'high') },
    { t: 25.4, move: seg('cheight', 'low'), dur: 0.4 },
    { t: 25.9, click: seg('cheight', 'low') },
    { t: 27.4, move: seg('cheight', 'normal'), dur: 0.4 },
    { t: 27.9, click: seg('cheight', 'normal') },
    { t: 28.3, move: seg('cmode', 'steer'), dur: 0.5 },
    { t: 28.9, click: seg('cmode', 'steer') },
    { t: 29.0, shot: 'carSteer', dur: 2.4, lift: 0.2 },
    { t: 32.4, move: seg('cview', 'exploded'), dur: 0.5 },
    { t: 33.0, click: seg('cview', 'exploded') },
    { t: 33.1, shot: 'carExploded', dur: 2.4 },
    { t: 36.0, move: seg('cview', 'whole'), dur: 0.5 },
    { t: 36.6, click: seg('cview', 'whole') },
    { t: 36.7, shot: 'car', dur: 2.2 },
    { t: 37.2, move: seg('cmode', 'launch'), dur: 0.5 },
    { t: 37.8, click: seg('cmode', 'launch') },
    { t: 39.8, cursor: 'hide' },
    { t: 41.4, end: true },
    { t: 42.6, run: () => {} },
  ]
}

/** Drive unit film: ~28 s. */
export function motorTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'motorExploded', dur: 0.01 },
    { t: 0.05, shot: 'motor', dur: 3.0 },
    { t: 2.2, cursor: 'show' },
    { t: 2.3, move: seg('mview', 'cut'), dur: 0.8 },
    { t: 3.2, click: seg('mview', 'cut') },
    { t: 5.2, move: seg('mfollow', 'current'), dur: 0.6 },
    { t: 5.9, click: seg('mfollow', 'current') },
    { t: 6.0, shot: 'motorFace', dur: 2.4 },
    { t: 9.4, move: seg('mfollow', 'field'), dur: 0.5 },
    { t: 10.0, click: seg('mfollow', 'field') },
    { t: 12.6, move: '#rpm', dur: 0.6, dx: 40 },
    { t: 13.3, drag: '#rpm', from: 7000, to: 16000, dur: 1.4 },
    { t: 15.2, move: seg('mmode', 'regen'), dur: 0.5 },
    { t: 15.8, click: seg('mmode', 'regen') },
    { t: 18.0, move: seg('mfollow', 'gears'), dur: 0.5 },
    { t: 18.6, click: seg('mfollow', 'gears') },
    { t: 18.7, shot: 'motorGears', dur: 2.6, lift: 0.2 },
    { t: 21.8, move: seg('mview', 'exploded'), dur: 0.5 },
    { t: 22.4, click: seg('mview', 'exploded') },
    { t: 22.5, shot: 'motorExploded', dur: 2.2 },
    { t: 24.6, cursor: 'hide' },
    { t: 26.2, end: true },
    { t: 27.4, run: () => {} },
  ]
}

/** Humanoid film: ~33 s. */
export function robotTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'robotEstab', dur: 0.01 },
    { t: 0.05, shot: 'robot', dur: 3.2 },
    { t: 2.4, cursor: 'show' },
    { t: 2.5, move: '#payload', dur: 0.8, dx: -40 },
    { t: 3.4, drag: '#payload', from: 0, to: 20, dur: 1.6 },
    { t: 5.8, move: seg('rfollow', 'actuators'), dur: 0.6 },
    { t: 6.5, click: seg('rfollow', 'actuators') },
    { t: 6.6, shot: 'robotLegs', dur: 2.6 },
    { t: 9.8, move: seg('rview', 'xray'), dur: 0.6 },
    { t: 10.5, click: seg('rview', 'xray') },
    { t: 10.6, shot: 'robotXray', dur: 2.8 },
    { t: 13.8, move: seg('rfollow', 'power'), dur: 0.5 },
    { t: 14.4, click: seg('rfollow', 'power') },
    { t: 14.5, shot: 'robotPower', dur: 2.4 },
    { t: 17.4, move: seg('rfollow', 'hands'), dur: 0.5 },
    { t: 18.0, click: seg('rfollow', 'hands') },
    { t: 18.1, shot: 'robotHands', dur: 2.2 },
    { t: 21.0, move: seg('rmode', 'squat'), dur: 0.5 },
    { t: 21.6, click: seg('rmode', 'squat') },
    { t: 21.7, shot: 'robot', dur: 2.4 },
    { t: 22.3, move: seg('rfollow', 'actuators'), dur: 0.5 },
    { t: 22.9, click: seg('rfollow', 'actuators') },
    { t: 25.6, move: seg('rview', 'exploded'), dur: 0.5 },
    { t: 26.2, click: seg('rview', 'exploded') },
    { t: 26.3, shot: 'robotExploded', dur: 2.2 },
    { t: 29.0, move: seg('rview', 'actuator'), dur: 0.5 },
    { t: 29.6, click: seg('rview', 'actuator') },
    { t: 29.7, shot: 'robotActuator', dur: 2.4, lift: 0.1 },
    { t: 34.6, move: seg('rview', 'whole'), dur: 0.5 },
    { t: 35.2, click: seg('rview', 'whole') },
    { t: 35.5, move: seg('rmode', 'walk'), dur: 0.4 },
    { t: 36.0, click: seg('rmode', 'walk') },
    { t: 36.1, shot: 'robot', dur: 2.2 },
    { t: 36.8, cursor: 'hide' },
    { t: 38.6, end: true },
    { t: 39.8, run: () => {} },
  ]
}

/** Black hole film: ~49 s, ending with the dive. */
export function holeTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'holeEstab', dur: 0.01 },
    { t: 0.05, shot: 'hole', dur: 4.0 },
    { t: 3.6, cursor: 'show' },
    { t: 3.7, move: '#hmass', dur: 0.8, dx: 20 },
    { t: 4.6, drag: '#hmass', from: 64, to: 1, dur: 1.8 },
    { t: 7.0, drag: '#hmass', from: 1, to: 100, dur: 1.6 },
    { t: 9.2, drag: '#hmass', from: 100, to: 64, dur: 0.9 },
    { t: 10.4, move: seg('hmode', 'probe'), dur: 0.6 },
    { t: 11.1, click: seg('hmode', 'probe') },
    { t: 11.2, shot: 'holeClose', dur: 2.6 },
    { t: 19.6, move: seg('hview', 'wh'), dur: 0.6 },
    { t: 20.3, click: seg('hview', 'wh') },
    { t: 20.4, shot: 'hole', dur: 2.2 },
    { t: 24.6, move: seg('hview', 'bh'), dur: 0.5 },
    { t: 25.2, click: seg('hview', 'bh') },
    { t: 26.0, move: seg('hmode', 'dive'), dur: 0.5 },
    { t: 26.6, click: seg('hmode', 'dive') },
    { t: 27.2, cursor: 'hide' },
    { t: 49.0, end: true },
    { t: 50.2, run: () => {} },
  ]
}

/** Jet engine film: ~41 s, opening on the lit afterburner and going straight into the cutaway. */
export function jetTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'jetOpen', dur: 0.01 },
    { t: 0.05, shot: 'jetNozzle', dur: 3.8 },
    { t: 3.5, cursor: 'show' },
    { t: 3.6, move: seg('jview', 'cut'), dur: 0.7 },
    { t: 4.4, click: seg('jview', 'cut') },
    { t: 4.5, shot: 'jetBlaze', dur: 3.0 },
    { t: 8.6, move: seg('jab', 'off'), dur: 0.6 },
    { t: 9.3, click: seg('jab', 'off') },
    { t: 9.4, shot: 'jetCut', dur: 2.0 },
    { t: 11.2, move: seg('jfollow', 'air'), dur: 0.6 },
    { t: 11.9, click: seg('jfollow', 'air') },
    { t: 12.0, shot: 'jetFan', dur: 2.2 },
    { t: 14.8, move: seg('jfollow', 'core'), dur: 0.5 },
    { t: 15.4, click: seg('jfollow', 'core') },
    { t: 15.5, shot: 'jetCut', dur: 2.0 },
    { t: 18.2, move: seg('jfollow', 'fire'), dur: 0.5 },
    { t: 18.8, click: seg('jfollow', 'fire') },
    { t: 18.9, shot: 'jetHot', dur: 2.0 },
    { t: 21.6, move: seg('jfollow', 'heat'), dur: 0.5 },
    { t: 22.2, click: seg('jfollow', 'heat') },
    { t: 22.3, shot: 'jetCut', dur: 1.8 },
    { t: 25.2, move: seg('jfollow', 'all'), dur: 0.5 },
    { t: 25.7, click: seg('jfollow', 'all') },
    { t: 26.0, move: seg('jview', 'exploded'), dur: 0.5 },
    { t: 26.6, click: seg('jview', 'exploded') },
    { t: 26.7, shot: 'jetExploded', dur: 2.4 },
    { t: 29.8, move: seg('jview', 'whole'), dur: 0.5 },
    { t: 30.4, click: seg('jview', 'whole') },
    { t: 30.5, shot: 'jetHero', dur: 2.2 },
    { t: 32.8, move: seg('jab', 'on'), dur: 0.5 },
    { t: 33.4, click: seg('jab', 'on') },
    { t: 33.5, shot: 'jetNozzle', dur: 1.6 },
    { t: 35.4, shot: 'jetPlume', dur: 2.2 },
    { t: 37.2, cursor: 'hide' },
    { t: 41.2, end: true },
    { t: 42.4, run: () => {} },
  ]
}

/** F1 film: ~41 s, wind tunnel at 300 km/h, air, pressure, active aero, brakes, the power unit. */
export function f1Tour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'f1Low', dur: 0.01 },
    { t: 0.05, shot: 'f1', dur: 3.4 },
    { t: 3.1, cursor: 'show' },
    { t: 3.3, move: seg('f1follow', 'air'), dur: 0.7 },
    { t: 4.1, click: seg('f1follow', 'air') },
    { t: 4.2, shot: 'f1Air', dur: 2.2 },
    { t: 7.4, shot: 'f1Under', dur: 2.0 },
    { t: 10.0, move: seg('f1follow', 'pressure'), dur: 0.5 },
    { t: 10.6, click: seg('f1follow', 'pressure') },
    { t: 10.7, shot: 'f1', dur: 2.0 },
    { t: 13.4, shot: 'f1Rear', dur: 2.0 },
    { t: 15.8, move: seg('f1mode', 'straight'), dur: 0.5 },
    { t: 16.4, click: seg('f1mode', 'straight') },
    { t: 16.5, shot: 'f1Wing', dur: 1.6 },
    { t: 19.0, move: seg('f1mode', 'corner'), dur: 0.5 },
    { t: 19.5, click: seg('f1mode', 'corner') },
    { t: 20.3, move: seg('f1follow', 'all'), dur: 0.5 },
    { t: 20.8, click: seg('f1follow', 'all') },
    { t: 21.2, move: seg('f1mode', 'brake'), dur: 0.5 },
    { t: 21.8, click: seg('f1mode', 'brake') },
    { t: 21.9, shot: 'f1Brake', dur: 1.8 },
    { t: 24.4, move: seg('f1view', 'cut'), dur: 0.5 },
    { t: 25.0, click: seg('f1view', 'cut') },
    { t: 25.1, shot: 'f1Cut', dur: 1.6 },
    { t: 26.7, shot: 'f1Engine', dur: 1.8 },
    { t: 27.2, move: seg('f1follow', 'power'), dur: 0.5 },
    { t: 27.8, click: seg('f1follow', 'power') },
    { t: 29.2, shot: 'f1Cut', dur: 1.4 },
    { t: 29.3, move: seg('f1mode', 'corner'), dur: 0.5 },
    { t: 29.9, click: seg('f1mode', 'corner') },
    { t: 31.3, move: seg('f1view', 'exploded'), dur: 0.5 },
    { t: 31.9, click: seg('f1view', 'exploded') },
    { t: 32.0, shot: 'f1Exploded', dur: 2.4 },
    { t: 34.9, move: seg('f1follow', 'all'), dur: 0.5 },
    { t: 35.4, click: seg('f1follow', 'all') },
    { t: 35.8, move: seg('f1view', 'whole'), dur: 0.5 },
    { t: 36.3, click: seg('f1view', 'whole') },
    { t: 36.4, shot: 'f1Low', dur: 2.6 },
    { t: 38.0, cursor: 'hide' },
    { t: 41.0, end: true },
    { t: 42.2, run: () => {} },
  ]
}

/** The whole lab in one run: every machine, flown to, opened up, then on to the next. ~53 s. */
export function grandTour(go: (ex: Exhibit) => () => void, a: Record<string, () => void>): Step[] {
  const steps: Step[] = [
    { t: 0, run: () => { go('hall')(); a.start() } },
    { t: 0, shot: 'hallTall', dur: 0.01 },
    { t: 0.05, shot: 'hall', dur: 2.6 },
  ]
  const blocks: [Exhibit, string, string, string][] = [
    ['fusion', 'fusion', 'fusion', 'fusionPlasma'],
    ['engine', 'hero', 'engine', 'fire'],
    ['pump', 'pump', 'pump', 'pumpClose'],
    ['line', 'lineWide', 'line', 'lineClose'],
    ['motor', 'motor', 'motor', 'motorFace'],
    ['car', 'car', 'car', 'carXray'],
    ['robot', 'robot', 'robot', 'robotXray'],
    ['hole', 'hole', 'hole', 'holeClose'],
    ['jet', 'jetOpen', 'jet', 'jetBlaze'],
    ['f1', 'f1Low', 'f1', 'f1Air'],
    ['drone', 'drone', 'drone', 'droneAir'],
  ]
  let t = 2.8
  for (const [ex, s1, key, s2] of blocks) {
    steps.push({ t, run: () => { go(ex)(); a[key + 'Base']() } })
    steps.push({ t: t + 0.01, shot: s1, dur: 1.6 })
    steps.push({ t: t + 2.0, run: a[key] })
    steps.push({ t: t + 2.1, shot: s2, dur: 2.0 })
    t += 4.6
  }
  steps.push({ t, run: a.droneGust })
  steps.push({ t: t + 0.01, shot: 'droneWind', dur: 2.2 })
  steps.push({ t: t + 3.6, end: true })
  steps.push({ t: t + 4.8, run: () => {} })
  return steps
}

/** Drone film: ~42 s. Hover, the air, a headwind from the fan wall, gusts, a payload, sensors, the insides. */
export function droneTour(reset: () => void): Step[] {
  return [
    { t: 0, run: reset },
    { t: 0, shot: 'droneLow', dur: 0.01 },
    { t: 0.05, shot: 'drone', dur: 3.4 },
    { t: 3.2, cursor: 'show' },
    { t: 3.3, move: seg('dfollow', 'air'), dur: 0.7 },
    { t: 4.0, click: seg('dfollow', 'air') },
    { t: 4.1, shot: 'droneAir', dur: 2.2 },
    { t: 7.2, shot: 'droneRotor', dur: 1.8 },
    { t: 9.8, move: seg('dmode', 'wind'), dur: 0.5 },
    { t: 10.4, click: seg('dmode', 'wind') },
    { t: 10.5, shot: 'droneWind', dur: 2.2 },
    { t: 13.6, move: seg('dfollow', 'control'), dur: 0.5 },
    { t: 14.2, click: seg('dfollow', 'control') },
    { t: 14.3, shot: 'drone', dur: 1.8 },
    { t: 16.4, move: seg('dmode', 'gust'), dur: 0.5 },
    { t: 17.0, click: seg('dmode', 'gust') },
    { t: 17.1, shot: 'droneGimbal', dur: 2.0 },
    { t: 19.8, move: seg('dpayload', 'on'), dur: 0.5 },
    { t: 20.4, click: seg('dpayload', 'on') },
    { t: 20.5, shot: 'drone', dur: 1.6 },
    { t: 22.4, move: seg('dmode', 'hover'), dur: 0.5 },
    { t: 23.0, click: seg('dmode', 'hover') },
    { t: 23.6, move: seg('dfollow', 'sensors'), dur: 0.5 },
    { t: 24.2, click: seg('dfollow', 'sensors') },
    { t: 24.3, shot: 'droneTop', dur: 2.0 },
    { t: 26.8, move: seg('dview', 'cut'), dur: 0.5 },
    { t: 27.4, click: seg('dview', 'cut') },
    { t: 27.5, shot: 'droneCut', dur: 2.0 },
    { t: 29.6, move: seg('dfollow', 'power'), dur: 0.5 },
    { t: 30.2, click: seg('dfollow', 'power') },
    { t: 32.0, move: seg('dview', 'exploded'), dur: 0.5 },
    { t: 32.6, click: seg('dview', 'exploded') },
    { t: 32.7, shot: 'droneExploded', dur: 2.2 },
    { t: 35.4, move: seg('dview', 'whole'), dur: 0.5 },
    { t: 36.0, click: seg('dview', 'whole') },
    { t: 36.4, move: seg('dfollow', 'all'), dur: 0.5 },
    { t: 36.9, click: seg('dfollow', 'all') },
    { t: 37.0, shot: 'droneLow', dur: 2.4 },
    { t: 38.5, cursor: 'hide' },
    { t: 41.0, end: true },
    { t: 42.2, run: () => {} },
  ]
}
