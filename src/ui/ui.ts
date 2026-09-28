import { BRAND } from '../brand'
import { S, changed, onChange, EngineView, Follow, PumpFollow, PumpMode, Exhibit, FusionFollow, FusionMode, PATHS, CarView, CarFollow, CarMode, MotorFollow, MotorMode, RobotView, RobotFollow, RobotMode, HoleView, HoleMode, JetFollow, F1Follow, F1Mode, DroneFollow, DroneMode } from '../state'
import { DR } from '../drone/drone'
import { f1Physics } from '../f1/f1'
import { JET } from '../jet/jet'
import { holeNumbers, massOf } from '../hole/portal'
import { HUMAN } from '../robot/humanoid'
import { load, TRUCK } from '../car/physics'
import { DU } from '../car/driveunit'
import { PHYS } from '../engine/plume'
import { FUSION } from '../fusion/physics'
import { STATIONS } from '../line/sim'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

/** truck speed for a motor speed, through the 12:1 gearbox and 35 inch tyres */
export const motorKmh = (rpm: number) => (rpm / DU.ratio / 60) * 2 * Math.PI * TRUCK.wheelR * 3.6

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export interface UIHooks {
  onExhibit: (ex: Exhibit, prev: Exhibit) => void
  onView: (view: EngineView, prev: EngineView) => void
  onFusionView: (view: EngineView, prev: EngineView) => void
  onFusionFollow: (f: FusionFollow) => void
  onLine: () => void
  onTour: () => void
  onCarView: (view: CarView, prev: CarView) => void
  onCarFollow: (f: CarFollow) => void
  onMotorView: (view: EngineView, prev: EngineView) => void
  onMotorFollow: (f: MotorFollow) => void
  onRobotView: (view: RobotView, prev: RobotView) => void
  onRobotFollow: (f: RobotFollow) => void
  onHoleView: (v: HoleView) => void
  onJetView: (v: EngineView, prev: EngineView) => void
  onJetFollow: (f: JetFollow) => void
  onHoleMode: (m: HoleMode) => void
  onF1View: (v: EngineView, prev: EngineView) => void
  onF1Follow: (f: F1Follow) => void
  onF1Mode: (m: F1Mode) => void
  onDroneView: (v: EngineView, prev: EngineView) => void
  onDroneFollow: (f: DroneFollow) => void
  onDroneMode: (m: DroneMode) => void
}

export interface Live {
  throttle: number
  alt: number
  pumpSpeed: number
  temp: number
  fusionOn: number
  line: { throughput: number; wip: number; bottleneck: number; settled: boolean; down: boolean; starved: boolean }
  car: { v: number; battery: number; wheel: number; t100: number | null; launching: boolean }
  motor: { rpm: number }
  robot: { power: number; knee: number; runtime: number; depth: number }
  jet: { thrust: number; fuel: number; tit: number; ab: number }
  f1: { kmh: number; open: number }
  drone: { rpm: number[]; watts: number; tiltDeg: number; wind: number; mass: number; thrust: number }
  hole: { stage: string; probeR: number; clock: number; redshift: number; stretch: number }
}

const TITLES: Record<Exhibit, string> = {
  hall: 'The lab',
  fusion: 'A star in a bottle',
  engine: 'Inside the Raptor 3',
  pump: 'Inside a turbopump',
  line: 'Every line has one bottleneck',
  car: 'Inside the Cybertruck',
  motor: 'How an electric motor turns',
  robot: 'Inside a humanoid robot',
  hole: 'A black hole through a portal',
  jet: 'Inside a fighter jet engine',
  f1: 'Inside a Formula 1 car',
  drone: 'How a drone holds still',
}

/** Pump numbers: flow from the engine's published thrust and mixture ratio, power scaled from community estimates. */
export function pumpNumbers(speed: number) {
  const s = Math.max(0, speed)
  const lox = PHYS.state(1, 0).lox * s // flow scales with speed
  const rise = 700 * s * s // pressure rise scales with speed squared (bar)
  const power = 42 * s * s * s // MW, power with speed cubed
  return { lox, rise, power }
}

/** A power plant built like ITER: blanket reactions add about 15% to the heat, a steam cycle turns about 35% of it into electricity. */
export const electricity = (fusionMW: number) => fusionMW * 1.15 * 0.35
/** Average household use of about 1.5 kW. */
export const homes = (mw: number) => (mw * 1000) / 1.5

export class UI {
  private card = $('card-text')
  private v0 = $('v0')
  private v1 = $('v1')
  private v2 = $('v2')
  private k0 = $('k0')
  private k1 = $('k1')
  private k2 = $('k2')
  private lastText = ''
  private toastTimer = 0
  private hintEl = $('hint')
  private interacted = false

  constructor(private hooks: UIHooks) {
    this.bindSeg('follow', (v) => { S.engine.follow = v as Follow })
    this.bindSeg('alt', (v) => { S.engine.alt = Number(v) })
    this.bindSeg('view', (v) => {
      const prev = S.engine.view
      S.engine.view = v as EngineView
      this.hooks.onView(S.engine.view, prev)
    })
    this.bindSeg('pfollow', (v) => { S.pump.follow = v as PumpFollow })
    this.bindSeg('pmode', (v) => { S.pump.mode = v as PumpMode; S.pump.modeT = 0 })
    this.bindSeg('pview', (v) => { S.pump.view = v as EngineView })
    this.bindSeg('ffollow', (v) => { S.fusion.follow = v as FusionFollow; this.hooks.onFusionFollow(S.fusion.follow) })
    this.bindSeg('fmode', (v) => { S.fusion.mode = v as FusionMode; S.fusion.modeT = 0 })
    this.bindSeg('fview', (v) => {
      const prev = S.fusion.view
      S.fusion.view = v as EngineView
      this.hooks.onFusionView(S.fusion.view, prev)
    })
    this.bindSeg('cfollow', (v) => {
      S.car.follow = v as CarFollow
      if (S.car.follow !== 'all' && S.car.view === 'whole') this.setCarView('xray')
      this.hooks.onCarFollow(S.car.follow)
    })
    this.bindSeg('cmode', (v) => { S.car.mode = v as CarMode; S.car.modeT = 0 })
    this.bindSeg('cheight', (v) => { S.car.height = v as typeof S.car.height })
    this.bindSeg('cview', (v) => this.setCarView(v as CarView))
    this.bindSeg('mfollow', (v) => {
      S.motor.follow = v as MotorFollow
      if (S.motor.follow !== 'all' && S.motor.view === 'whole') this.setMotorView('cut')
      this.hooks.onMotorFollow(S.motor.follow)
    })
    this.bindSeg('mmode', (v) => { S.motor.mode = v as MotorMode })
    this.bindSeg('rfollow', (v) => {
      S.robot.follow = v as RobotFollow
      if (S.robot.follow !== 'all' && S.robot.view === 'whole') S.robot.view = 'xray'
      this.hooks.onRobotFollow(S.robot.follow)
    })
    this.bindSeg('rmode', (v) => { S.robot.mode = v as RobotMode })
    this.bindSeg('jfollow', (v) => { S.jet.follow = v as JetFollow; if (S.jet.follow !== 'all' && S.jet.view === 'whole') { S.jet.view = 'cut'; this.hooks.onJetView('cut', 'whole') } this.hooks.onJetFollow(S.jet.follow) })
    this.bindSeg('jab', (v) => { S.jet.ab = v === 'on'; if (S.jet.ab) S.jet.throttle = 1 })
    this.bindSeg('jview', (v) => { const prev = S.jet.view; S.jet.view = v as EngineView; this.hooks.onJetView(S.jet.view, prev) })
    const jt = $<HTMLInputElement>('jthrottle')
    jt.addEventListener('input', () => { S.jet.throttle = Number(jt.value) / 100; if (S.jet.throttle < 0.98) S.jet.ab = false; changed() })
    this.bindSeg('dfollow', (v) => {
      S.drone.follow = v as DroneFollow
      if (S.drone.follow === 'power' && S.drone.view === 'whole') { S.drone.view = 'cut'; this.hooks.onDroneView('cut', 'whole') }
      this.hooks.onDroneFollow(S.drone.follow)
    })
    this.bindSeg('dmode', (v) => { S.drone.mode = v as DroneMode; this.hooks.onDroneMode(S.drone.mode) })
    this.bindSeg('dpayload', (v) => { S.drone.payload = v === 'on' })
    this.bindSeg('dview', (v) => { const prev = S.drone.view; S.drone.view = v as EngineView; this.hooks.onDroneView(S.drone.view, prev) })
    this.bindSeg('f1follow', (v) => {
      S.f1.follow = v as F1Follow
      if (S.f1.follow === 'power' && S.f1.view === 'whole') { S.f1.view = 'cut'; this.hooks.onF1View('cut', 'whole') }
      this.hooks.onF1Follow(S.f1.follow)
    })
    this.bindSeg('f1mode', (v) => { S.f1.mode = v as F1Mode; this.hooks.onF1Mode(S.f1.mode) })
    this.bindSeg('f1view', (v) => { const prev = S.f1.view; S.f1.view = v as EngineView; this.hooks.onF1View(S.f1.view, prev) })
    const fsp = $<HTMLInputElement>('f1speed')
    fsp.addEventListener('input', () => { S.f1.speed = Number(fsp.value); changed() })
    this.bindSeg('hview', (v) => { S.hole.view = v as HoleView; this.hooks.onHoleView(S.hole.view) })
    this.bindSeg('hmode', (v) => { S.hole.mode = v as HoleMode; S.hole.modeT = 0; this.hooks.onHoleMode(S.hole.mode) })
    const hm = $<HTMLInputElement>('hmass')
    hm.addEventListener('input', () => { S.hole.mass = Number(hm.value) / 100; changed() })
    this.bindSeg('rview', (v) => {
      const prev = S.robot.view
      S.robot.view = v as RobotView
      this.hooks.onRobotView(S.robot.view, prev)
    })
    const pay = $<HTMLInputElement>('payload')
    pay.addEventListener('input', () => {
      S.robot.payload = Number(pay.value)
      changed()
    })
    this.bindSeg('mview', (v) => this.setMotorView(v as EngineView))
    const cspd = $<HTMLInputElement>('cspeed')
    cspd.addEventListener('input', () => {
      S.car.speed = Number(cspd.value)
      if (S.car.mode !== 'cruise') { S.car.mode = 'cruise'; S.car.modeT = 0 }
      changed()
    })
    const rpm = $<HTMLInputElement>('rpm')
    rpm.addEventListener('input', () => {
      S.motor.rpm = Number(rpm.value)
      changed()
    })
    this.bindSeg('robots', (v) => { S.line.robots = Number(v) as 1 | 2; this.hooks.onLine() })
    this.bindSeg('buffer', (v) => { S.line.buffer = Number(v); this.hooks.onLine() })
    this.bindSeg('breakdowns', (v) => { S.line.breakdowns = v === 'on'; this.hooks.onLine() })
    const temp = $<HTMLInputElement>('temp')
    temp.addEventListener('input', () => {
      S.fusion.temp = Number(temp.value)
      if (S.fusion.mode !== 'run') { S.fusion.mode = 'run'; S.fusion.modeT = 0 }
      changed()
    })
    const fs = $<HTMLInputElement>('framespeed')
    fs.addEventListener('input', () => {
      S.line.frameSpeed = Number(fs.value) / 100
      this.hooks.onLine()
      changed()
    })

    const thr = $<HTMLInputElement>('throttle')
    thr.addEventListener('input', () => {
      S.engine.throttle = Number(thr.value) / 100
      changed()
    })
    const spd = $<HTMLInputElement>('speed')
    spd.addEventListener('input', () => {
      S.pump.speed = Number(spd.value) / 100
      if (S.pump.mode !== 'run') { S.pump.mode = 'run'; S.pump.modeT = 0 }
      changed()
    })
    const strobe = $('strobe')
    strobe.addEventListener('click', () => {
      S.pump.strobe = !S.pump.strobe
      changed()
    })

    document.querySelectorAll<HTMLButtonElement>('#exhibits button').forEach((b) =>
      b.addEventListener('click', () => this.setExhibit(b.dataset.ex as Exhibit)),
    )
    document.querySelectorAll<HTMLButtonElement>('.icon.tour').forEach((b) => b.addEventListener('click', () => this.hooks.onTour()))
    document.querySelectorAll<HTMLButtonElement>('.icon.helpbtn').forEach((b) => b.addEventListener('click', () => { $('helpbox').hidden = false }))
    $('help-close').addEventListener('click', () => { $('helpbox').hidden = true })
    $('helpbox').addEventListener('click', (e) => { if (e.target === $('helpbox')) $('helpbox').hidden = true })
    $('share').addEventListener('click', () => this.share())

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (S.exhibit === 'fusion') {
        const f: Record<string, FusionFollow> = { '1': 'all', '2': 'plasma', '3': 'magnets', '4': 'neutrons', '5': 'power' }
        if (f[e.key]) { S.fusion.follow = f[e.key]; changed() }
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { S.fusion.temp = Math.min(FUSION.maxT, S.fusion.temp + 5); changed() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { S.fusion.temp = Math.max(FUSION.minT, S.fusion.temp - 5); changed() }
      }
      if (S.exhibit === 'engine') {
        const f: Record<string, Follow> = { '1': 'all', '2': 'oxygen', '3': 'methane', '4': 'fire' }
        if (f[e.key]) { S.engine.follow = f[e.key]; changed() }
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { S.engine.throttle = Math.min(1, S.engine.throttle + 0.05); changed() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { S.engine.throttle = Math.max(0.4, S.engine.throttle - 0.05); changed() }
      }
      if (S.exhibit === 'car') {
        const f: Record<string, CarFollow> = { '1': 'all', '2': 'energy', '3': 'motors', '4': 'structure' }
        if (f[e.key]) { S.car.follow = f[e.key]; if (S.car.follow !== 'all' && S.car.view === 'whole') this.setCarView('xray'); changed() }
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { S.car.speed = Math.min(TRUCK.maxSpeed, S.car.speed + 10); S.car.mode = 'cruise'; changed() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { S.car.speed = Math.max(0, S.car.speed - 10); S.car.mode = 'cruise'; changed() }
      }
      if (S.exhibit === 'motor') {
        const f: Record<string, MotorFollow> = { '1': 'all', '2': 'current', '3': 'field', '4': 'gears' }
        if (f[e.key]) { S.motor.follow = f[e.key]; if (S.motor.follow !== 'all' && S.motor.view === 'whole') this.setMotorView('cut'); changed() }
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { S.motor.rpm = Math.min(16000, S.motor.rpm + 500); changed() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { S.motor.rpm = Math.max(0, S.motor.rpm - 500); changed() }
      }
      if (e.key === 'Escape') $('helpbox').hidden = true
    })
    const firstUse = () => {
      if (this.interacted) return
      this.interacted = true
      this.hintEl.style.opacity = '0'
    }
    window.addEventListener('pointerdown', firstUse, { once: true })
    window.setTimeout(firstUse, 9000)

    onChange(() => this.sync())
    this.sync()
  }

  private bindSeg(key: string, set: (v: string) => void) {
    const seg = document.querySelector<HTMLElement>(`.seg[data-key="${key}"]`)
    if (!seg) return
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        set(b.dataset.v!)
        changed()
      }),
    )
  }

  setCarView(v: CarView) {
    const prev = S.car.view
    S.car.view = v
    this.hooks.onCarView(v, prev)
    changed()
  }

  setMotorView(v: EngineView) {
    const prev = S.motor.view
    S.motor.view = v
    this.hooks.onMotorView(v, prev)
    changed()
  }

  setExhibit(ex: Exhibit) {
    if (S.exhibit === ex) return
    const prev = S.exhibit
    S.exhibit = ex
    this.hooks.onExhibit(ex, prev)
    changed()
    document.title = `${TITLES[ex]} | ${BRAND.name}`
  }

  /** Reflect state into the controls. */
  sync() {
    const mark = (key: string, v: string) => {
      document.querySelectorAll<HTMLButtonElement>(`.seg[data-key="${key}"] button`).forEach((b) => {
        const on = b.dataset.v === v
        b.classList.toggle('on', on)
        b.setAttribute('aria-pressed', String(on))
      })
    }
    mark('follow', S.engine.follow)
    mark('alt', String(S.engine.alt))
    mark('view', S.engine.view)
    mark('pfollow', S.pump.follow)
    mark('pmode', S.pump.mode)
    mark('pview', S.pump.view)
    mark('ffollow', S.fusion.follow)
    mark('fmode', S.fusion.mode)
    mark('fview', S.fusion.view)
    mark('cfollow', S.car.follow)
    mark('cmode', S.car.mode)
    mark('cview', S.car.view)
    mark('cheight', S.car.height)
    mark('jfollow', S.jet.follow)
    mark('jab', S.jet.ab ? 'on' : 'off')
    mark('jview', S.jet.view)
    const jt = $<HTMLInputElement>('jthrottle')
    const jv = Math.round(S.jet.throttle * 100)
    if (Number(jt.value) !== jv) jt.value = String(jv)
    jt.style.setProperty('--p', `${((jv - 20) / 80) * 100}%`)
    $('jthr-val').textContent = S.jet.ab ? 'max + AB' : `${jv}%`
    mark('dfollow', S.drone.follow)
    mark('dmode', S.drone.mode)
    mark('dpayload', S.drone.payload ? 'on' : 'off')
    mark('dview', S.drone.view)
    mark('f1follow', S.f1.follow)
    mark('f1mode', S.f1.mode)
    mark('f1view', S.f1.view)
    const fs = $<HTMLInputElement>('f1speed')
    if (Number(fs.value) !== S.f1.speed) fs.value = String(S.f1.speed)
    fs.style.setProperty('--p', `${((S.f1.speed - 80) / 270) * 100}%`)
    $('f1speed-val').textContent = `${S.f1.speed} km/h`
    mark('hview', S.hole.view)
    mark('hmode', S.hole.mode)
    const hm = $<HTMLInputElement>('hmass')
    const hv = Math.round(S.hole.mass * 100)
    if (Number(hm.value) !== hv) hm.value = String(hv)
    hm.style.setProperty('--p', `${hv}%`)
    $('hmass-val').textContent = massName(massOf(S.hole.mass), true)
    mark('rfollow', S.robot.follow)
    mark('rmode', S.robot.mode)
    mark('rview', S.robot.view)
    const pay = $<HTMLInputElement>('payload')
    const pv = Math.round(S.robot.payload)
    if (Number(pay.value) !== pv) pay.value = String(pv)
    pay.style.setProperty('--p', `${(pv / 20) * 100}%`)
    $('payload-val').textContent = `${pv} kg`
    mark('mfollow', S.motor.follow)
    mark('mmode', S.motor.mode)
    mark('mview', S.motor.view)
    const cspd = $<HTMLInputElement>('cspeed')
    const cv = Math.round(S.car.speed)
    if (Number(cspd.value) !== cv) cspd.value = String(cv)
    cspd.style.setProperty('--p', `${(cv / TRUCK.maxSpeed) * 100}%`)
    $('cspd-val').textContent = `${cv} km/h`
    const rpm = $<HTMLInputElement>('rpm')
    const rv = Math.round(S.motor.rpm / 100) * 100
    if (Number(rpm.value) !== rv) rpm.value = String(rv)
    rpm.style.setProperty('--p', `${(rv / 16000) * 100}%`)
    $('rpm-val').textContent = `${fmt(rv)} rpm`
    mark('robots', String(S.line.robots))
    mark('buffer', String(S.line.buffer))
    mark('breakdowns', S.line.breakdowns ? 'on' : 'off')
    const temp = $<HTMLInputElement>('temp')
    if (Number(temp.value) !== Math.round(S.fusion.temp)) temp.value = String(Math.round(S.fusion.temp))
    temp.style.setProperty('--p', `${((S.fusion.temp - FUSION.minT) / (FUSION.maxT - FUSION.minT)) * 100}%`)
    $('temp-val').textContent = `${Math.round(S.fusion.temp)}M °C`
    const fsl = $<HTMLInputElement>('framespeed')
    const fv = Math.round(S.line.frameSpeed * 100)
    if (Number(fsl.value) !== fv) fsl.value = String(fv)
    fsl.style.setProperty('--p', `${((fv - 50) / 150) * 100}%`)
    $('fs-val').textContent = `${S.line.frameSpeed.toFixed(1)}×`
    const thr = $<HTMLInputElement>('throttle')
    const tv = Math.round(S.engine.throttle * 100)
    if (Number(thr.value) !== tv) thr.value = String(tv)
    thr.style.setProperty('--p', `${((tv - 40) / 60) * 100}%`)
    $('thr-val').textContent = `${tv}%`
    const spd = $<HTMLInputElement>('speed')
    const sv = Math.round(S.pump.speed * 100)
    if (Number(spd.value) !== sv) spd.value = String(sv)
    spd.style.setProperty('--p', `${sv}%`)
    $('spd-val').textContent = `${sv}%`
    $('strobe').setAttribute('aria-pressed', String(S.pump.strobe))
    document.querySelectorAll<HTMLElement>('[data-exhibit]').forEach((el) => { el.hidden = el.dataset.exhibit !== S.exhibit })
    document.querySelectorAll<HTMLElement>('[data-exhibit-not]').forEach((el) => { el.hidden = el.dataset.exhibitNot === S.exhibit })
    $('card').hidden = S.exhibit === 'hall'
    $('readout').hidden = S.exhibit === 'hall'
    document.querySelectorAll<HTMLButtonElement>('#exhibits button').forEach((b) => b.classList.toggle('on', b.dataset.ex === S.exhibit))
  }

  /** Live numbers, from the smoothed simulation values. */
  frame(live: Live) {
    if (S.exhibit === 'fusion') {
      const st = FUSION.state(live.temp)
      const on = live.fusionOn
      this.k0.textContent = 'Plasma'
      this.k1.textContent = 'Fusion power'
      this.k2.textContent = 'Gain'
      this.v0.textContent = on > 0.05 ? `${fmt(live.temp)}M °C` : 'off'
      this.v1.textContent = `${fmt(st.fusion * on)} MW`
      this.v2.textContent = on < 0.05 ? 'Q 0' : st.Q === Infinity ? 'ignited' : `Q ${st.Q < 1 ? fmt(st.Q, 2) : fmt(st.Q, 1)}`
      if (S.fusion.follow === 'power') {
        const e = electricity(st.fusion * on)
        this.k0.textContent = 'Fusion heat'
        this.k1.textContent = 'Electricity'
        this.k2.textContent = 'Homes'
        this.v0.textContent = `${fmt(st.fusion * on)} MW`
        this.v1.textContent = `${fmt(e)} MW`
        this.v2.textContent = e < 1 ? '0' : `${fmt(Math.round(homes(e) / 1000))}k`
      }
    } else if (S.exhibit === 'line') {
      const L = live.line
      this.k0.textContent = 'Output'
      this.k1.textContent = 'In progress'
      this.k2.textContent = 'Lead time'
      this.v0.textContent = `${fmt(L.throughput)} / h`
      this.v1.textContent = `${fmt(L.wip)} drones`
      this.v2.textContent = L.throughput > 1 ? `${fmt((L.wip / L.throughput) * 60, 1)} min` : '...'
    } else if (S.exhibit === 'engine') {
      const st = PHYS.state(live.throttle, live.alt)
      this.k0.textContent = 'Thrust'
      this.k1.textContent = 'Chamber'
      this.k2.textContent = 'Burning'
      this.v0.textContent = `${fmt(st.thrust)} tf`
      this.v1.textContent = `${fmt(st.pc)} bar`
      this.v2.textContent = `${fmt(st.mdot)} kg/s`
    } else if (S.exhibit === 'car') {
      const C = live.car
      this.k0.textContent = 'Speed'
      this.k1.textContent = C.battery < -0.5 ? 'Charging' : 'Battery'
      this.k2.textContent = S.car.mode === 'launch' ? '0 to 100' : 'Range'
      this.v0.textContent = `${fmt(C.v)} km/h`
      this.v1.textContent = `${fmt(Math.abs(C.battery))} kW`
      if (S.car.mode === 'launch') this.v2.textContent = C.t100 !== null ? `${fmt(C.t100, 1)} s` : '...'
      else { const r = load(C.v).range; this.v2.textContent = C.v < 2 ? 'parked' : `${fmt(Math.round(r / 10) * 10)} km` }
    } else if (S.exhibit === 'jet') {
      const J = live.jet
      this.k0.textContent = 'Thrust'; this.v0.textContent = `${fmt(J.thrust)} kN`
      this.k1.textContent = 'Fuel'; this.v1.textContent = `${fmt(J.fuel, 1)} kg/s`
      this.k2.textContent = 'Turbine inlet'; this.v2.textContent = `${fmt(Math.round(J.tit / 10) * 10)} °C`
    } else if (S.exhibit === 'drone') {
      const D = live.drone
      const avg = D.rpm.reduce((s, x) => s + x, 0) / 4
      this.k0.textContent = 'Rotor speed'; this.v0.textContent = `${fmt(Math.round(avg / 10) * 10)} rpm`
      this.k1.textContent = 'Power'; this.v1.textContent = `${fmt(Math.round(D.watts / 10) * 10)} W`
      if (S.drone.mode === 'hover') { this.k2.textContent = 'Flight time'; this.v2.textContent = `${fmt((DR.battery * DR.usable) / D.watts * 60)} min` }
      else { this.k2.textContent = 'Leaning into the wind'; this.v2.textContent = `${fmt(D.tiltDeg, 1)}°` }
    } else if (S.exhibit === 'f1') {
      const P = f1Physics(live.f1.kmh, S.f1.mode, live.f1.open)
      this.k0.textContent = 'Downforce'; this.v0.textContent = `${fmt(Math.round(P.dfKg / 10) * 10)} kg`
      this.k1.textContent = 'Drag'; this.v1.textContent = `${fmt(P.drag / 1000, 1)} kN`
      if (S.f1.mode === 'brake') { this.k2.textContent = 'Braking'; this.v2.textContent = `${fmt(P.brake, 1)} g` }
      else if (S.f1.mode === 'straight') { this.k2.textContent = 'Power into the air'; this.v2.textContent = `${fmt(Math.round(P.airKW / 5) * 5)} kW` }
      else { this.k2.textContent = 'Cornering'; this.v2.textContent = `${fmt(P.lat, 1)} g` }
    } else if (S.exhibit === 'hole') {
      const H = live.hole
      const M = massOf(S.hole.mass)
      const n = holeNumbers(M)
      if (S.hole.view === 'wh' && S.hole.mode !== 'dive') {
        this.k0.textContent = 'Type'; this.v0.textContent = 'Ellis'
        this.k1.textContent = 'Stays open with'; this.v1.textContent = 'negative energy'
        this.k2.textContent = 'Seen so far'; this.v2.textContent = 'none'
      } else if (S.hole.mode === 'probe') {
        this.k0.textContent = 'Probe at'; this.v0.textContent = `${fmt(H.probeR, 2)} × horizon`
        this.k1.textContent = 'Its clock, seen from here'; this.v1.textContent = `${fmt(H.clock, 2)} s`
        this.k2.textContent = 'Redshift'; this.v2.textContent = H.redshift > 50 ? 'fading out' : `${fmt(H.redshift, 1)}×`
      } else {
        this.k0.textContent = 'Mass'; this.v0.textContent = massName(M)
        this.k1.textContent = 'Horizon radius'; this.v1.textContent = distName(n.rsKm)
        this.k2.textContent = 'Stretch on you there'; this.v2.textContent = gName(n.tidalG)
      }
    } else if (S.exhibit === 'robot' && S.robot.view === 'actuator') {
      this.k0.textContent = 'Rotary, up to'
      this.k1.textContent = 'Linear, up to'
      this.k2.textContent = 'In the body'
      this.v0.textContent = '180 Nm'
      this.v1.textContent = '8,000 N'
      this.v2.textContent = '28'
    } else if (S.exhibit === 'robot') {
      const R = live.robot
      this.k0.textContent = 'Power'
      this.k1.textContent = 'Knee torque'
      this.k2.textContent = 'Runtime'
      this.v0.textContent = `${fmt(R.power)} W`
      this.v1.textContent = `${fmt(R.knee)} Nm`
      this.v2.textContent = `${fmt(R.runtime, 1)} h`
    } else if (S.exhibit === 'motor') {
      const rpm = live.motor.rpm
      this.k0.textContent = 'Motor'
      this.k1.textContent = 'Current'
      this.k2.textContent = 'Truck'
      this.v0.textContent = `${fmt(rpm)} rpm`
      this.v1.textContent = S.motor.mode === 'coast' ? 'off' : `${fmt((rpm / 60) * (DU.poles / 2))} Hz`
      this.v2.textContent = `${fmt(motorKmh(rpm))} km/h`
    } else if (S.exhibit === 'pump') {
      const p = pumpNumbers(live.pumpSpeed)
      this.k0.textContent = 'Oxygen'
      this.k1.textContent = 'Pressure rise'
      this.k2.textContent = 'Shaft power'
      this.v0.textContent = `${fmt(p.lox)} kg/s`
      this.v1.textContent = `${fmt(p.rise)} bar`
      this.v2.textContent = `${fmt(p.power)} MW`
    }
    const html =
      S.exhibit === 'engine' ? this.engineText()
      : S.exhibit === 'pump' ? this.pumpText(live.pumpSpeed)
      : S.exhibit === 'fusion' ? this.fusionText(live)
      : S.exhibit === 'line' ? this.lineText(live)
      : S.exhibit === 'car' ? this.carText(live)
      : S.exhibit === 'motor' ? this.motorText(live)
      : S.exhibit === 'robot' ? this.robotText(live)
      : S.exhibit === 'hole' ? this.holeText(live)
      : S.exhibit === 'jet' ? this.jetText(live)
      : S.exhibit === 'f1' ? this.f1Text(live)
      : S.exhibit === 'drone' ? this.droneText(live)
      : ''
    if (html !== this.lastText) {
      this.lastText = html
      this.card.innerHTML = html
    }
  }

  private engineText() {
    const E = S.engine
    const st = PHYS.state(E.throttle, E.alt)
    const bar = (v: number) => (v < 0.1 ? fmt(v, 3) : v < 10 ? fmt(v, 2) : fmt(v))
    if (E.view === 'exploded')
      return 'Pulled apart: the <b>gimbal</b>, the <span class="ox">oxygen turbopump</span> stacked on the axis, its <span class="gas">preburner</span> and turbine, the <span class="ch4">methane turbopump</span> beside them, the <b>injector</b> and the cooled <b>chamber and nozzle</b>.'
    if (E.follow === 'oxygen')
      return '<span class="ox">Liquid oxygen</span> at about −200 °C enters through the gimbal. The pump raises it to hundreds of bar, a <span class="gas">preburner</span> burns it with a trace of methane, and that hot oxygen rich gas spins the turbine before it pours into the injector.'
    if (E.follow === 'methane')
      return '<span class="ch4">Methane</span> takes the long way. Its pump sends it down the outside of the nozzle and back up through <b>channels in the wall</b>, cooling the metal, then into its own preburner. That hot gas spins the methane turbine and flows into the injector.'
    if (E.follow === 'fire')
      return `Both hot gases meet in the chamber at about <span class="fire">3,300 °C</span> and <b>${fmt(st.pc)} bar</b>. The narrow <b>throat</b> chokes the flow at exactly Mach 1, then the bell accelerates it to about <b>Mach 4</b>.`
    if (E.view === 'cut')
      return 'Raptor 3 runs a <b>full flow</b> cycle. Every kilogram of propellant passes through a turbine before it burns, <span class="ox">oxygen</span> through one and <span class="ch4">methane</span> through the other. Nothing is dumped overboard.'
    if (E.alt >= 60)
      return `In vacuum nothing pushes back. The exhaust leaves at <b>${bar(st.pe)} bar</b> into nothing and spreads into a wide, faint plume. The same engine now makes <b>${fmt(st.thrust)} tf</b>, more than at sea level.`
    if (E.alt > 3)
      return `At ${fmt(E.alt)} km the air is down to <b>${bar(st.pa)} bar</b>. The exhaust leaves at higher pressure than the air around it, so the jet swells outward and the <b>shock diamonds</b> stretch apart.`
    if (E.throttle < 0.9)
      return `Throttled to <b>${fmt(E.throttle * 100)}%</b>. Chamber pressure falls to <b>${fmt(st.pc)} bar</b> and the exhaust leaves at only <b>${bar(st.pe)} bar</b>. The air squeezes it harder, so the diamonds crowd toward the nozzle.`
    return `Full power at sea level. The exhaust leaves at <b>${bar(st.pe)} bar</b>, just under the <b>${bar(st.pa)} bar</b> of air around it. The air pinches the jet, and bright <b>shock diamonds</b> glow where it recompresses.`
  }

  private fusionText(live: Live) {
    const F = S.fusion
    const T = F.temp
    const st = FUSION.state(T)
    const q = st.Q < 1 ? fmt(st.Q, 2) : fmt(st.Q, 1)
    if (F.mode === 'disrupt')
      return 'A <span class="warn">disruption</span>. The plasma loses its balance, drifts into the wall and dumps its energy in a few thousandths of a second. Machines are built to survive this, and avoiding it is one of the hardest problems in fusion.'
    if (F.mode === 'start')
      return 'Start up. Gas is puffed in, the <span class="mag">central solenoid</span> ramps its current and the voltage around the ring tears the atoms apart. Heating beams and radio waves then take the plasma from a few thousand degrees to over a hundred million.'
    if (F.view === 'exploded')
      return 'Pulled apart: the <span class="mag">central solenoid</span> lifts out of the middle, the <span class="mag">poloidal field coils</span> rise, and eighteen D shaped <span class="mag">toroidal field coils</span> slide outward. Left behind is the <b>vacuum vessel</b>, with the plasma chamber inside.'
    if (F.follow === 'power') {
      const e = electricity(st.fusion)
      if (T < 45) return `Down at <b>${fmt(T)} million °C</b> almost nothing fuses, so there is no heat to turn into power. The turbine stops and the city goes dark.`
      return `The neutrons heat the <span class="heat">blanket</span>, water carries that heat to a steam generator, and the steam spins a <b>turbine</b>. About a third of the <b>${fmt(st.fusion)} MW</b> of heat becomes <span class="elec">${fmt(e)} MW of electricity</span>, enough for about <b>${fmt(Math.round(homes(e) / 1000) * 1000)} homes</b>. ITER itself has no turbine; this is how a power plant built like it would work.`
    }
    if (F.follow === 'magnets')
      return 'Nothing can touch 150 million degrees, so magnets hold it. Eighteen <span class="mag">D shaped coils</span> make a field that runs the long way round the ring, the current in the plasma adds a twist, and together they wind every particle along <span class="mag">helical field lines</span> that never reach the wall.'
    if (F.follow === 'neutrons')
      return 'Each fusion makes a helium nucleus and a <span class="neu">neutron</span>. With no charge, the neutron ignores the magnets, flies straight out with 80% of the energy and stops in the <span class="heat">blanket</span>. Water carries that heat away to make steam.'
    if (F.follow === 'plasma')
      return `The <span class="plasma">plasma</span> is gas so hot its atoms have come apart. Deuterium and tritium nuclei race round the ring at <b>${fmt(T)} million °C</b>. When two of them hit hard enough they fuse into helium and release energy.`
    if (F.view === 'whole')
      return 'This is a <b>tokamak</b>, a ring shaped magnetic bottle. Inside, a plasma ten times hotter than the Sun&rsquo;s core circles without touching the walls. Open it to look inside.'
    if (T < 45)
      return `At <b>${fmt(T)} million °C</b>, about the Sun&rsquo;s core, almost nothing fuses here. The Sun makes up for it with crushing gravity. A tokamak can&rsquo;t, so it has to run <b>ten times hotter</b>.`
    if (T < 130)
      return `At <b>${fmt(T)} million °C</b> nuclei start to fuse, making <b>${fmt(st.fusion)} MW</b>. The heating still does a lot of the work, so the gain is only <b>Q = ${q}</b>. Keep going.`
    if (T > 165)
      return `Hotter plasma makes more power, <b>${fmt(st.fusion)} MW</b> here, but it also pushes harder on the magnetic field, and that pressure has a limit. Machines like ITER are designed to run near <b>150 million °C</b>.`
    return `At <b>${fmt(T)} million °C</b> the plasma makes <b>${fmt(st.fusion)} MW</b> of fusion power from <b>${fmt(st.heating)} MW</b> of heating, a gain of <b>Q = ${q}</b>. That is roughly ITER&rsquo;s target.`
  }

  private droneText(live: Live) {
    const D = S.drone
    const L = live.drone
    const avg = Math.round(L.rpm.reduce((s, x) => s + x, 0) / 40) * 10
    const vi = Math.sqrt(L.thrust / 4 / (2 * 1.225 * Math.PI * DR.R * DR.R))
    const mins = fmt((DR.battery * DR.usable) / L.watts * 60)
    const spread = Math.round((Math.max(...L.rpm) - Math.min(...L.rpm)) / 10) * 10
    if (D.view === 'exploded')
      return 'Pulled apart: the <b>shell</b>, two hot swap <b>batteries</b>, the <b>RTK</b> antennas, the <b>flight controller</b> and compute board, four <b>arms</b> with their motors and 21 inch props, the <b>landing gear</b> and the stabilised <b>camera</b>.'
    if (D.follow === 'power')
      return `Two 12 cell packs, <b>${DR.battery} Wh</b> together, feed a power board that splits the current to four motor controllers. Right now the drone draws <b>${fmt(Math.round(L.watts / 10) * 10)} W</b>: almost all of it goes into pushing air down.`
    if (D.follow === 'control')
      return `The <span class="gas">flight controller</span> reads its gyros and accelerometers hundreds of times a second and trims each motor on its own. Right now the fastest and slowest props differ by <b>${fmt(spread)} rpm</b>: that difference is what tilts it and holds it level.`
    if (D.follow === 'sensors')
      return 'Stereo cameras on all six sides see obstacles in every direction, a <b>lidar</b> sweeps the space ahead, and <b>RTK GPS</b> fixes its position to about a centimetre. The camera below hangs on a three axis gimbal that cancels every tilt of the body.'
    if (D.follow === 'air')
      return `Each prop pushes air down at about <b>${fmt(vi, 1)} m/s</b> through the disc, and the stream keeps speeding up and narrowing below it. When it hits the floor it spreads out. The spirals are <b>tip vortices</b>, shed by the blade tips on every turn.`
    if (D.mode === 'wind')
      return `A <b>${fmt(L.wind)} m/s</b> headwind from the fan wall. To stay on the spot the drone leans <b>${fmt(L.tiltDeg, 1)}°</b> into it, so part of its thrust pushes back against the air. The back props spin faster than the front ones to hold that lean.`
    if (D.mode === 'gust')
      return 'Gusts. Every change in the wind knocks the drone off its spot, and the controller answers within a fraction of a second: it tilts into the gust, then back. Watch the camera: the <b>gimbal</b> keeps it level the whole time.'
    if (D.view === 'cut')
      return 'Cut down the middle: the <b>flight controller</b> with its IMU in a damped cage, the <b>compute board</b> under a finned heat sink, the battery cells, and in each motor a copper wound stator inside a ring of magnets that spins with the prop.'
    const mass = fmt(L.mass, 1)
    return `Hovering at <b>${mass} kg</b>. Each 21 inch prop turns at about <b>${fmt(avg)} rpm</b> and lifts a quarter of the weight. Holding still takes <b>${fmt(Math.round(L.watts / 10) * 10)} W</b>, about <b>${mins} minutes</b> on a full charge${D.payload ? ', less with the 2.5 kg payload' : ''}.`
  }

  private f1Text(live: Live) {
    const F = S.f1
    const P = f1Physics(live.f1.kmh, F.mode, live.f1.open)
    const kg = fmt(Math.round(P.dfKg / 10) * 10)
    if (F.view === 'exploded')
      return 'Pulled apart: the <b>survival cell</b> with the driver and the halo, the <b>sidepods</b> with their radiators, the <b>floor</b> whose tunnels make most of the grip, both <b>wings</b>, and the <span class="ox">power unit</span>: a 1.6 litre V6, a turbo, the electric motor and the battery, with the gearbox behind.'
    if (F.follow === 'power')
      return F.mode === 'brake'
        ? 'Braking. The electric motor turns into a generator and pulls up to <b>350 kW</b> back out of the rear wheels into the battery, <span class="ox">green</span>. The carbon brake discs do the rest and glow at around <b>1,000 °C</b>.'
        : 'The 2026 power unit is close to half and half: about <b>400 kW</b> from the 1.6 litre V6 burning fully sustainable fuel and <b>350 kW</b> from the electric motor, fed by the battery under the fuel tank. Together that is roughly <b>1,000 horsepower</b>.'
    if (F.follow === 'pressure')
      return `The air pressure on every surface. <span class="fire">Red</span> is where air piles up and pushes, <span class="ox">blue</span> is where it rushes past and pulls. The underside of the floor and the wings is deep blue: that suction holds the car down with <b>${kg} kg</b> at ${fmt(live.f1.kmh)} km/h.`
    if (F.follow === 'air')
      return 'Follow the air. The front wing turns it out around the front tyres, the floor pulls it into two <b>tunnels</b> underneath where it speeds up and drops in pressure, the <b>diffuser</b> lets it slow and rise, and the rear wing throws it up. The spirals are <b>vortices</b> peeling off the wing tips.'
    if (F.mode === 'straight')
      return `<b>Straight mode.</b> New for 2026: on the straights the flaps of both wings lie flat, cutting drag to <b>${fmt(P.drag / 1000, 1)} kN</b> so the car can go faster on the same power. At ${fmt(live.f1.kmh)} km/h it takes about <b>${fmt(Math.round(P.airKW / 5) * 5)} kW</b> just to push the air aside.`
    if (F.mode === 'brake')
      return `<b>Braking</b> from ${fmt(live.f1.kmh)} km/h at about <b>${fmt(P.brake, 1)} g</b>. Downforce presses the tyres into the road, so the faster the car goes, the harder it can stop. The discs glow and the motor charges the battery.`
    if (F.view === 'cut')
      return 'Cut down the middle: the driver lies almost flat, feet up in the nose. Behind the seat is the <b>fuel tank</b>, under it the <b>battery</b>, then the <b>V6</b> with the turbo behind it and the <b>gearbox</b>, which also holds up the rear suspension.'
    const over = live.f1.kmh >= P.ceiling
    return `At ${fmt(live.f1.kmh)} km/h the wings and floor push the car down with <b>${kg} kg</b>, ${fmt(P.ratio, 1)} times its own weight${over ? `. Above about <b>${fmt(Math.round(P.ceiling / 5) * 5)} km/h</b> it makes more downforce than it weighs, so in theory it could drive upside down on a ceiling.` : '.'} That grip lets it corner at <b>${fmt(P.lat, 1)} g</b>.`
  }

  private jetText(live: Live) {
    const J = S.jet
    const L = live.jet
    const lbf = Math.round((L.thrust * 224.8) / 100) * 100
    if (J.view === 'exploded')
      return 'Pulled apart, front to back: the <b>inlet</b> and three stage <b>fan</b>, the six stage <span class="gas">compressor</span>, the ring shaped <span class="fire">combustor</span>, one high and two low pressure <b>turbines</b>, the <span class="fire">afterburner</span> and the <b>nozzle</b> whose petals open and close.'
    if (J.ab && L.ab > 0.5)
      return `<span class="fire">Afterburner.</span> Fuel sprays out of 22 thick curved vanes behind the turbine and burns in their wakes, using the oxygen still left in the exhaust. Thrust jumps to <b>${fmt(L.thrust)} kN</b>, about ${lbf.toLocaleString('en-US')} pounds, but fuel use more than triples to <b>${fmt(L.fuel, 1)} kg a second</b>. The nozzle opens wide to pass the hotter, bigger flow, and <b>shock diamonds</b> stand in the flame.`
    if (J.follow === 'air')
      return 'The fan pulls in up to about <b>150 kg of air a second</b>. Roughly a third of it, the <span class="ox">bypass air</span>, flows around the core in the outer duct: cool, fast, and a big share of the thrust.'
    if (J.follow === 'core')
      return 'The rest goes into the <span class="gas">core</span>. Fan and six compressor stages squeeze it to about <b>28 times</b> the pressure outside, which heats it past 600 °C before any fuel is added.'
    if (J.follow === 'fire')
      return `Fuel burns in the ring shaped combustor, and the gas reaches the turbine at about <b>${fmt(Math.round(L.tit / 10) * 10)} °C</b>, hotter than the melting point of the blades it hits. They survive because cooler air is blown through tiny holes and over their surface.`
    if (J.follow === 'heat')
      return 'The gas path as a heat map. Squeezing alone heats the air to about <b>620 °C</b> at 28 bar. The flame takes it near <b>2,000 °C</b>, the turbines pull it back under 900 °C by taking out the work, and the afterburner heats it all over again.'
    if (J.follow === 'spools')
      return 'Two shafts, one inside the other. The <b>low pressure spool</b> joins the fan to the last two turbine stages; the <b>high pressure spool</b> joins the compressor to the first turbine and turns faster. Each turbine drives what is in front of it.'
    if (J.view === 'cut')
      return 'Air in the front, fire in the middle, thrust out the back. A jet engine is a compressor, a burner and a turbine on the same shafts: the turbine takes just enough energy from the hot gas to spin the compressor, and the rest leaves as a jet.'
    return `The engine of the F-35, at full size: 5.6 m long and about 1,700 kg. At ${fmt(J.throttle * 100)}% it makes <b>${fmt(L.thrust)} kN</b> of thrust, about ${lbf.toLocaleString('en-US')} pounds. Cut it open, or push it to full power and light the afterburner.`
  }

  private holeText(live: Live) {
    const H = S.hole
    const M = massOf(H.mass)
    const n = holeNumbers(M)
    const st = live.hole.stage
    if (H.mode === 'dive') {
      if (st === 'door') return 'Through the portal. From here on everything you see is traced through curved spacetime, one light ray per pixel.'
      if (st === 'approach') return 'Falling in. The stars behind the hole are squeezed into a ring, and the disk wraps over the top and under the bottom: that is light bent around the hole on its way to you.'
      if (st === 'horizon') return 'The event horizon. Nothing, not even light, gets back out from here. Falling freely you feel nothing special as you cross it.'
      if (st === 'inside') return `Inside, every direction leads to the singularity. For a hole of ${massName(M)} you would reach it in about <b>${timeName(n.toSingularity)}</b>.`
      if (st === 'singularity') return 'The singularity, where our physics stops working. Nobody knows what happens here.'
      return 'In the idealised maths of an eternal black hole, the inside connects to another universe through an <b>Einstein Rosen bridge</b>. In reality it would close before anything got through. This is the view if it did: another sky, and our universe shrinking behind us in the throat.'
    }
    if (H.view === 'wh')
      return 'A <b>wormhole</b>, a shortcut through spacetime. Light that passes near the throat comes out on the other side, so the sphere shows another sky, wrapped into rings. It is a real solution of Einstein\'s equations, but holding it open would take <b>negative energy</b>, which nobody knows how to make.'
    if (H.mode === 'probe') {
      if (live.hole.probeR > 1.6) return 'A probe falls in. As it gets close its light is <b>redshifted</b> and dimmed, and its clock, as we see it, runs slow.'
      if (live.hole.stretch > 1.4) return `This hole is small, so the pull on the near end of the probe is far stronger than on the far end. It is <b>stretched</b> apart before it reaches the horizon: about ${gName(n.tidalG)} across a person.`
      return 'From out here the probe never quite gets in. Its clock seems to stop and its light fades away at the horizon. On its own clock, it crosses in a moment and carries on to the singularity.'
    }
    if (M < 1e3)
      return `A black hole of <b>${massName(M)}</b>, the kind a big star leaves behind. The horizon is only <b>${distName(n.rsKm)}</b> across, and the difference in pull between your head and your feet there would be <b>${gName(n.tidalG)}</b>. You would be stretched apart long before reaching it.`
    if (M > 1e9)
      return `<b>${massName(M)}</b>, like M87*, the first black hole ever photographed (2019). Its horizon is <b>${distName(n.rsKm)}</b> across. The tidal pull there is gentle; you could fall for about <b>${timeName(n.toSingularity)}</b> inside before reaching the singularity.`
    return `Light bent by gravity. The dark <b>shadow</b> is about 2.6 times the horizon, the thin bright <b>photon ring</b> is light that circled the hole before escaping, and the disk is brighter on the side coming toward us. The Event Horizon Telescope saw this ring around <b>Sagittarius A*</b>, ${massName(4.3e6)} at the centre of our galaxy, in 2022.`
  }

  private robotText(live: Live) {
    const R = S.robot
    const L = live.robot
    const kg = R.payload
    if (R.view === 'actuator')
      return 'Two of the six actuator designs, pulled apart. Rotary: a <span class="heat">frameless motor</span> spins a <span class="mag">strain wave gear</span> that slows it about 100 to 1, a <b>crossed roller bearing</b> carries the load, and an <b>encoder</b> and <b>torque sensor</b> tell the computer where the joint is and how hard it pushes. Linear: a motor turns a <span class="mag">planetary roller screw</span> that drives the rod in and out.'
    if (R.view === 'exploded')
      return `Shells off. Under the white covers are <b>${HUMAN.actuators} actuators</b>: rotary ones at the hips, shoulders and waist, linear screws along the thighs and shins that pull the knees and ankles, and a <span class="elec">${HUMAN.battery} kWh battery</span> with the computer in the chest.`
    if (R.follow === 'hands')
      return 'The hands have no motors in them. Small actuators in the <b>forearm</b> pull <span class="elec">tendons</span> that run through the wrist to each fingertip, the way ours do. That keeps the hand light and the fingers slim enough to pick up an egg or a box.'
    if (R.follow === 'power')
      return `Everything runs off the <span class="elec">battery in the chest</span>, about <b>${HUMAN.battery} kWh</b>. Right now the robot draws <b>${fmt(L.power)} W</b>, so a full charge lasts about <b>${fmt(L.runtime, 1)} hours</b>. Walking costs about five times as much as standing still.`
    if (R.follow === 'actuators' || R.mode === 'squat')
      return R.mode === 'squat'
        ? `In a deep squat the knees do the heavy lifting: about <b>${fmt(L.knee)} Nm</b> each${kg ? ` with ${kg} kg in its hands` : ''}. The colours show each actuator's share of the load, green to red.`
        : `Every ring is an actuator, coloured by how hard it is working. The knees and hips carry the body, about <b>${fmt(L.knee)} Nm</b> at the knee each step${kg ? `, more with the <b>${kg} kg</b> box` : ''}. The shoulders and elbows take the payload.`
    if (R.view === 'xray')
      return `Under the shell: a metal frame, an actuator at every joint, the battery and the computer in the chest, and cameras behind the black visor. <b>${HUMAN.actuators} actuators</b> move the body, more in the hands.`
    if (kg > 0)
      return `With <b>${kg} kg</b> in its hands the robot leans back a little to keep its balance, and the load runs down through the arms, spine, hips and knees. Power rises to <b>${fmt(L.power)} W</b>.`
    return `A humanoid at human size: <b>1.73 m</b>, about <b>${HUMAN.mass} kg</b>, walking on a treadmill. Standing still it uses about 100 W, walking about 500 W. Give it a box to carry and watch what changes.`
  }

  private carText(live: Live) {
    const C = S.car
    const L = live.car
    const kw = fmt(Math.abs(L.battery))
    if (C.view === 'exploded')
      return 'Pulled apart: the stainless <b>shell</b> lifts off, the seats rise, the pack lid comes up over <span class="elec">1,344 cells</span>, the front and rear <b>castings</b> slide out with their <span class="heat">drive units</span>, and the wheels move out on their air springs.'
    if (C.mode === 'launch')
      return L.t100 !== null
        ? `Zero to 100 km/h in <b>${fmt(L.t100, 1)} seconds</b>. Off the line the tyres are the limit, about one g, then the ${fmt(TRUCK.peak)} kW of the three motors takes over. Three tonnes, faster than most sports cars.`
        : `Launch. All three motors pull at once and the pack gives <b>${kw} kW</b>. For the first moments grip is the limit, not power.`
    if (C.mode === 'steer')
      return 'Steer by wire: there is no steering column, only wires to motors at the wheels. At low speed the <b>rear wheels turn too</b>, up to about 10 degrees the other way, so a 5.7 m truck turns much tighter than its length suggests.'
    if (C.height !== 'normal' && C.view === 'whole')
      return C.height === 'high'
        ? 'Air springs at every corner pump up and lift the body. At its highest the truck clears about <b>44 cm</b> of ground, enough for rocks and deep water.'
        : 'The air springs let out and the body drops to about <b>20 cm</b> off the ground. Lower means less air under the truck, less drag and easier loading.'
    if (C.mode === 'regen')
      return `Lift off and the three motors become generators. The wheels drive them, and <span class="regen">${kw} kW</span> flows back into the battery. Most of the braking an electric truck does happens here, not in the discs.`
    if (C.follow === 'energy')
      return `The floor is the battery: <span class="elec">1,344 cells</span> in one structural pack, <b>123 kWh</b> at about 800 volts. Orange cables carry it to an inverter on each drive unit. Right now the motors draw <b>${kw} kW</b>.`
    if (C.follow === 'motors')
      return `Three drive units: one in front, two at the back so each rear wheel has its own. Each gears its motor down about 12 to 1. At ${fmt(L.v)} km/h they spin at <b>${fmt(load(L.v).rpm)} rpm</b>.`
    if (C.follow === 'structure')
      return 'The body is the structure. A stainless <b>exoskeleton</b> carries load, the front and rear of the frame are each one <b>giga casting</b> instead of dozens of stamped parts, and the <span class="elec">battery pack</span> is part of the floor.'
    if (C.view === 'xray')
      return 'Under the steel is a <b>skateboard</b>: the battery flat in the floor, a <span class="heat">drive unit</span> at each axle, air springs at every corner and steer by wire in front. Pick something to follow.'
    const l = load(L.v)
    if (L.v < 3) return 'The truck is strapped to a <b>dyno</b>: its tyres sit on rollers, so it can drive at any speed without moving. Drag the speed up.'
    if (l.aero > l.rolling)
      return `At <b>${fmt(L.v)} km/h</b> it takes <b>${fmt(l.wheel)} kW</b> at the wheels, and <b>${fmt(l.aero)} kW</b> of that just pushes air aside. Drag grows with the cube of speed, so the last 30 km/h cost the most range.`
    return `At <b>${fmt(L.v)} km/h</b> it takes only <b>${fmt(l.wheel)} kW</b> at the wheels. Most of that is the tyres rolling; air barely matters yet. Speed up and watch the range fall.`
  }

  private motorText(live: Live) {
    const M = S.motor
    const rpm = live.motor.rpm
    if (M.view === 'exploded')
      return 'Pulled apart: the <b>rotor</b> with its magnets slides out of the stator, the <b>inverter</b> lifts off the top, and the gear train fans out: a small pinion, an intermediate pair and the big final gear on the <b>differential</b>.'
    if (M.mode === 'coast')
      return 'Coasting. The inverter stops pushing current, so the slots go dark. The magnets still spin, but nothing pulls on them, so there is no torque either way.'
    if (M.mode === 'regen')
      return 'Regenerating. The inverter now holds the field a quarter pole <b>behind</b> the rotor. The magnets drag it forward, the motor works as a generator and current flows <span class="regen">back to the battery</span>.'
    if (M.follow === 'current')
      return `Three currents, <span class="pu">U</span>, <span class="pv">V</span> and <span class="pw">W</span>, rise and fall a third of a cycle apart. Each slot glows while its current flows. At ${fmt(rpm)} rpm the inverter runs them at <b>${fmt((rpm / 60) * (DU.poles / 2))} Hz</b>.`
    if (M.follow === 'field')
      return 'Together the three currents make <span class="north">north</span> and <span class="south">south</span> poles that <b>turn</b> around the stator. The rotor&rsquo;s magnets chase them, a quarter pole behind. That chase is the torque.'
    if (M.follow === 'gears')
      return `A motor likes to spin fast, a wheel slowly. Two gear pairs, 17 to 55 and 19 to 72, cut the speed about <b>12 times</b> and multiply the torque by the same. ${fmt(rpm)} rpm here is <b>${fmt(rpm / DU.ratio)} rpm</b> at the wheel, ${fmt(motorKmh(rpm))} km/h.`
    if (M.view === 'whole')
      return 'A drive unit: the electric motor, the <b>inverter</b> on top that turns the battery&rsquo;s DC into three phase AC, and a gearbox that ends in the differential. Open it up.'
    if (rpm < 50) return 'Stopped. Drag the <b>motor speed</b> up and watch the currents start to turn.'
    return `At <b>${fmt(rpm)} rpm</b> the rotor turns ${fmt(rpm / 60)} times a second. The currents in the slots turn exactly with it, which is why this is a <b>synchronous</b> motor. Shown about 600 times slower.`
  }

  private lineText(live: Live) {
    const L = S.line
    const out = fmt(live.line.throughput)
    const bn = STATIONS[live.line.bottleneck].name.toLowerCase()
    if (L.breakdowns && L.buffer === 0)
      return 'Machines now fail at random. With <b>no buffers</b>, one stop starves every station after it and blocks every station before it, so the whole line stands still.'
    if (L.breakdowns)
      return `Machines fail at random, but the <b>buffers</b> between stations soak up the stops. A short breakdown no longer stops the whole line. Output: <b>${out} drones an hour</b>.`
    if (L.robots === 2)
      return `A second robot doubles the motors station. Output rises toward <b>80 an hour</b>, and the bottleneck moves to <b>${bn}</b>, now the slowest station. Fix one constraint and the next one shows up.`
    if (L.frameSpeed > 1.15)
      return `The frame station runs <b>${L.frameSpeed.toFixed(1)}× faster</b>, yet output is still <b>${out} an hour</b>. The extra frames just pile up in front of the motors. Speeding up anything but the bottleneck buys nothing.`
    if (L.frameSpeed < 0.85)
      return `Slow the frame station below the motors station and <b>it</b> becomes the bottleneck. Output drops to what it can cut, about <b>${fmt(3600 / (40 / L.frameSpeed))} an hour</b>.`
    return 'Five stations build a drone. The <b>motors</b> station needs 60 seconds per drone, longer than any other, so the line ships about <b>60 an hour</b> no matter how fast the rest run. That station is the <span class="warn">bottleneck</span>.'
  }

  private pumpText(speed: number) {
    const P = S.pump
    if (P.mode === 'cav')
      return 'Starve the inlet and the oxygen starts to <b>boil on the blades</b>. Vapor bubbles form at the inducer and collapse further in, the pump loses its grip and pressure falls away. The <b>inducer</b> exists to stop exactly this.'
    if (P.mode === 'start')
      return 'At start, gas <b>spins the turbine</b> before anything burns. As the pumps come up to speed the preburner lights, the hot gas takes over, and within seconds the shaft is running on its own.'
    if (P.follow === 'oxygen')
      return '<span class="ox">Liquid oxygen</span> enters on the axis. The helical <b>inducer</b> lifts its pressure just enough to keep it from boiling, the <b>impeller</b> flings it outward, and the <b>volute</b> collects it and turns speed into pressure.'
    if (P.follow === 'gas')
      return 'Hot <span class="gas">oxygen rich gas</span> from the preburner rushes through a ring of <b>stator vanes</b> that aim it at the turbine blades. It leaves slower and cooler, and every joule it gave up turns the shaft.'
    if (P.view === 'exploded')
      return 'From the inlet down: the <b>inducer</b>, the <b>impeller</b> and its <b>volute</b>, the bearings and the shaft, then the <b>turbine</b> with its stator ring. In a full flow engine both sides of this shaft carry oxygen, so no seal has to keep fuel and oxidizer apart.'
    if (speed < 0.05) return 'Stopped. Drag the <b>shaft speed</b> up to spin the turbine and watch the oxygen start to move.'
    return `At ${fmt(speed * 100)}% speed the pump moves about <b>${fmt(pumpNumbers(speed).lox)} kg of oxygen a second</b>. Pressure rises with the square of speed and power with the cube, so the last few percent cost the most.`
  }

  toast(msg: string) {
    const t = $('toast')
    t.textContent = msg
    t.classList.add('show')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800)
  }

  async share() {
    const url = BRAND.site ? `${BRAND.site}${PATHS[S.exhibit]}` : `${location.origin}${location.pathname}?ex=${S.exhibit}`
    const data = { title: TITLES[S.exhibit], text: 'An interactive lab: a fusion reactor, a rocket engine, a Cybertruck and a factory line you can take apart.', url }
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share(data)
        return
      }
      await navigator.clipboard.writeText(url)
      this.toast('Link copied')
    } catch {
      this.toast(url)
    }
  }

  progress(p: number, text?: string) {
    $('loadbar').style.width = `${Math.round(p * 100)}%`
    if (text) $('loadtext').textContent = text
  }

  ready() {
    $('loader')?.classList.add('done')
    window.setTimeout(() => $('loader')?.remove(), 1000)
  }
}

export function massName(M: number, short = false) {
  const named: [number, string][] = [[21, 'Cygnus X-1'], [4.3e6, 'Sgr A*'], [6.5e9, 'M87*']]
  if (short) for (const [m, name] of named) if (Math.abs(Math.log10(M / m)) < 0.08) return name
  if (M < 1e3) return `${Math.round(M)} suns`
  if (M < 1e6) return `${Math.round(M / 1e3)} thousand suns`
  if (M < 1e9) return `${(M / 1e6).toFixed(M < 1e7 ? 1 : 0)} million suns`
  return `${(M / 1e9).toFixed(1)} billion suns`
}
function distName(km: number) {
  if (km < 1e4) return `${Math.round(km)} km`
  if (km < 1e8) return `${(km / 1e6).toFixed(km < 1e7 ? 1 : 0)} million km`
  return `${(km / 1.496e8).toFixed(0)} × Sun to Earth`
}
function gName(g: number) {
  if (g >= 1e6) return `${Math.round(g / 1e6)} million g`
  if (g >= 10) return `${Math.round(g).toLocaleString('en-US')} g`
  if (g >= 0.01) return `${g.toFixed(2)} g`
  return `${g.toExponential(0).replace('e-', ' × 10⁻').replace(/(\d+)$/, (d) => d.split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join(''))} g`
}
function timeName(s: number) {
  if (s < 1) return `${(s * 1000).toPrecision(2)} thousandths of a second`
  if (s < 120) return `${Math.round(s)} seconds`
  if (s < 7200) return `${Math.round(s / 60)} minutes`
  return `${Math.round(s / 3600)} hours`
}
