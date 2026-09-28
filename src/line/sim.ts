import { rng } from '../core/noise'

/**
 * A five station drone line as a small discrete simulation. Everything runs on
 * the sim clock with a seeded random source, so a recording is frame exact.
 *
 * Times are in line seconds; LINE_TIME_SCALE line seconds pass per real second.
 */
export const LINE_TIME_SCALE = 20

export const STATIONS = [
  { name: 'Frame', sub: 'cut the frame', cycle: 40 },
  { name: 'Motors', sub: 'fit four motors', cycle: 60 },
  { name: 'Electronics', sub: 'board and battery', cycle: 45 },
  { name: 'Test', sub: 'spin up, check', cycle: 35 },
  { name: 'Pack', sub: 'box it', cycle: 30 },
] as const

export type MachineState = 'idle' | 'work' | 'blocked' | 'down'

export interface Item {
  id: number
  /** stations completed so far (0 = raw, 5 = boxed) */
  stage: number
  /** where it is: station index (inside a machine), conveyor index (after station i), or done */
  at: { kind: 'machine'; s: number; m: number } | { kind: 'belt'; b: number } | { kind: 'done' }
  /** visual position along the line in metres, eased toward its target */
  x: number
  z: number
  /** time spent in the current machine as a fraction of its cycle */
  prog: number
  t0: number
}

export interface Machine {
  state: MachineState
  item: Item | null
  t: number
  cycle: number
  downLeft: number
  /** seconds until the next failure (drawn when the machine starts working) */
  nextFail: number
  /** time spent busy or down in the window, for utilisation */
  busy: number
}

export interface LineSettings {
  frameSpeed: number
  robots: 1 | 2
  buffer: number
  breakdowns: boolean
}

/** Station x positions on the bench and the conveyor slot pitch. */
export const LINE_X = [-2.3, -1.2, -0.1, 1.0, 2.1]
export const SLOT = 0.23

export class LineSim {
  stations: Machine[][] = []
  belts: Item[][] = [[], [], [], []]
  done: Item[] = []
  items: Item[] = []
  t = 0
  finished = 0
  private nextId = 1
  private rnd = rng(11)
  private completions: number[] = []
  util = [0, 0, 0, 0, 0]
  throughput = 0
  settings: LineSettings = { frameSpeed: 1, robots: 1, buffer: 2, breakdowns: false }

  constructor() {
    this.reset()
  }

  reset() {
    this.rnd = rng(11)
    this.stations = STATIONS.map((_, i) => [this.machine(i)])
    this.belts = [[], [], [], []]
    this.done = []
    this.items = []
    this.t = 0
    this.finished = 0
    this.completions = []
    this.util = [0, 0, 0, 0, 0]
    this.throughput = 0
    this.apply()
  }

  private machine(i: number): Machine {
    return { state: 'idle', item: null, t: 0, cycle: STATIONS[i].cycle, downLeft: 0, nextFail: 0, busy: 0 }
  }

  /** Bring machines in line with the settings (adds or removes the second robot). */
  apply() {
    const want = this.settings.robots
    const st = this.stations[1]
    while (st.length < want) st.push(this.machine(1))
    while (st.length > want) {
      const m = st.pop()!
      // the removed robot hands its drone back to the belt in front of it
      if (m.item) {
        m.item.stage = 1
        this.belts[0].unshift(m.item)
        m.item.at = { kind: 'belt', b: 0 }
      }
    }
  }

  cycleOf(s: number) {
    const base = STATIONS[s].cycle
    return s === 0 ? base / this.settings.frameSpeed : base
  }

  capacity() {
    return Math.max(1, this.settings.buffer)
  }

  /** Can a machine at station s take a part now? */
  private freeMachine(s: number) {
    return this.stations[s].find((m) => m.state === 'idle') ?? null
  }

  private failTime() {
    // exponential, mean 500 line seconds of work between failures
    return -Math.log(1 - this.rnd()) * 500
  }

  step(dt: number) {
    const T = dt * LINE_TIME_SCALE
    this.t += T
    const S = this.settings
    for (let s = 0; s < this.stations.length; s++) {
      for (let mi = 0; mi < this.stations[s].length; mi++) {
        const m = this.stations[s][mi]
        m.cycle = this.cycleOf(s)
        if (m.state === 'down') {
          m.downLeft -= T
          m.busy += T
          if (m.downLeft <= 0) m.state = m.item ? 'work' : 'idle'
          continue
        }
        if (m.state === 'idle') {
          // pull a part: station 0 has endless raw frames, the rest take from the belt in front
          let it: Item | null = null
          if (s === 0) {
            it = { id: this.nextId++, stage: 0, at: { kind: 'machine', s: 0, m: mi }, x: LINE_X[0] - 0.62, z: 0, prog: 0, t0: this.t }
            this.items.push(it)
          } else {
            const belt = this.belts[s - 1]
            const front = belt[0]
            if (front && Math.abs(front.x - this.frontSlot(s - 1)) < 0.03) {
              belt.shift()
              it = front
            }
          }
          if (it) {
            it.at = { kind: 'machine', s, m: mi }
            it.prog = 0
            m.item = it
            m.state = 'work'
            m.t = 0
            if (m.nextFail <= 0) m.nextFail = this.failTime()
          }
        }
        if (m.state === 'work' && m.item) {
          m.t += T
          m.busy += T
          m.item.prog = Math.min(1, m.t / m.cycle)
          if (S.breakdowns) {
            m.nextFail -= T
            if (m.nextFail <= 0) {
              m.state = 'down'
              m.downLeft = 80 + this.rnd() * 90
              m.nextFail = this.failTime()
              continue
            }
          }
          if (m.t >= m.cycle) {
            m.item.stage = s + 1
            m.state = 'blocked'
          }
        }
        if (m.state === 'blocked' && m.item) {
          if (s === this.stations.length - 1) {
            m.item.at = { kind: 'done' }
            this.done.push(m.item)
            this.finished++
            this.completions.push(this.t)
            m.item = null
            m.state = 'idle'
          } else {
            const belt = this.belts[s]
            const room = this.settings.buffer === 0 ? belt.length === 0 && !!this.freeMachine(s + 1) : belt.length < this.capacity()
            if (room) {
              m.item.at = { kind: 'belt', b: s }
              belt.push(m.item)
              m.item = null
              m.state = 'idle'
            }
          }
        }
      }
    }
    // keep the last few boxes on the pallet
    while (this.done.length > 12) {
      const gone = this.done.shift()!
      this.items.splice(this.items.indexOf(gone), 1)
    }
    // throughput from the last few drones off the line, smoothed; a line that
    // has stopped shipping shows its rate falling from the time since the last one
    while (this.completions.length > 5) this.completions.shift()
    const c = this.completions
    let rate = 0
    if (c.length > 1) {
      const span = Math.max(c[c.length - 1] - c[0], (this.t - c[c.length - 1]) * (c.length - 1))
      rate = ((c.length - 1) / Math.max(1, span)) * 3600
    }
    this.throughput += (rate - this.throughput) * (1 - Math.exp(-T / 90))
    // utilisation, exponentially forgotten
    const k = Math.exp(-T / 600)
    for (let s = 0; s < this.stations.length; s++) {
      let busy = 0
      for (const m of this.stations[s]) {
        busy += m.state === 'work' || m.state === 'down' ? 1 : 0
      }
      this.util[s] = this.util[s] * k + (busy / this.stations[s].length) * (1 - k)
    }
    this.moveItems(dt)
  }

  frontSlot(b: number) {
    return LINE_X[b + 1] - 0.3
  }

  /** Ease every part toward where it belongs; parts on a belt queue up behind each other. */
  private moveItems(dt: number) {
    const speed = 0.9 // metres per real second on the belt
    for (let b = 0; b < this.belts.length; b++) {
      this.belts[b].forEach((it, i) => {
        const target = this.frontSlot(b) - i * SLOT
        it.x = Math.min(target, it.x + speed * dt)
        if (it.x > target) it.x = target
        it.z += (0 - it.z) * (1 - Math.exp(-dt * 8))
      })
    }
    for (let s = 0; s < this.stations.length; s++) {
      const n = this.stations[s].length
      this.stations[s].forEach((m, mi) => {
        if (!m.item) return
        const tx = LINE_X[s]
        const tz = n === 2 ? (mi === 0 ? -0.07 : 0.07) : 0
        m.item.x += (tx - m.item.x) * (1 - Math.exp(-dt * 7))
        m.item.z += (tz - m.item.z) * (1 - Math.exp(-dt * 7))
      })
    }
    this.done.forEach((it, i) => {
      const col = i % 3, row = Math.floor(i / 3) % 2, layer = Math.floor(i / 6)
      const tx = LINE_X[4] + 0.58 + col * 0.27
      const tz = -0.135 + row * 0.27
      it.x += (tx - it.x) * (1 - Math.exp(-dt * 5))
      it.z += (tz - it.z) * (1 - Math.exp(-dt * 5))
      ;(it as Item & { layer?: number }).layer = layer
    })
  }

  wip() {
    return this.items.length - this.done.length
  }

  bottleneck() {
    let best = 0
    for (let s = 1; s < this.util.length; s++) if (this.util[s] > this.util[best] + 1e-6) best = s
    return best
  }

  /** Steady state capacity of each station in drones per hour. */
  capacities() {
    return STATIONS.map((_, s) => (3600 / this.cycleOf(s)) * this.stations[s].length)
  }
}
