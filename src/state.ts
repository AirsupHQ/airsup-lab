export type EngineView = 'whole' | 'cut' | 'exploded'
export type Follow = 'all' | 'oxygen' | 'methane' | 'fire'
export type PumpFollow = 'all' | 'oxygen' | 'gas'
export type PumpMode = 'run' | 'start' | 'cav'
export type FusionFollow = 'all' | 'plasma' | 'magnets' | 'neutrons' | 'power'
export type FusionMode = 'run' | 'start' | 'disrupt'
export type CarView = 'whole' | 'xray' | 'exploded'
export type CarFollow = 'all' | 'energy' | 'motors' | 'structure'
export type CarMode = 'cruise' | 'launch' | 'regen' | 'steer'
export type RideHeight = 'low' | 'normal' | 'high'
export type MotorFollow = 'all' | 'current' | 'field' | 'gears'
export type MotorMode = 'drive' | 'regen' | 'coast'
export type RobotView = 'whole' | 'xray' | 'exploded' | 'actuator'
export type RobotFollow = 'all' | 'actuators' | 'power' | 'hands'
export type RobotMode = 'walk' | 'squat' | 'stand'
export type HoleView = 'bh' | 'wh'
export type HoleMode = 'watch' | 'probe' | 'dive'
export type JetFollow = 'all' | 'air' | 'core' | 'fire' | 'heat' | 'spools'
export type DroneFollow = 'all' | 'air' | 'power' | 'control' | 'sensors'
export type DroneMode = 'hover' | 'wind' | 'gust'
export type F1Follow = 'all' | 'air' | 'pressure' | 'power'
export type F1Mode = 'straight' | 'corner' | 'brake'
export type Exhibit = 'hall' | 'fusion' | 'engine' | 'pump' | 'line' | 'car' | 'motor' | 'robot' | 'hole' | 'jet' | 'f1' | 'drone'

export const EXHIBITS: Exhibit[] = ['fusion', 'engine', 'pump', 'line', 'car', 'motor', 'robot', 'hole', 'jet', 'f1', 'drone']

/** URL path for each exhibit, under /lab. */
export const PATHS: Record<Exhibit, string> = {
  hall: '/lab/hall',
  fusion: '/lab',
  engine: '/lab/rocket-engine',
  pump: '/lab/turbopump',
  line: '/lab/production-line',
  car: '/lab/cybertruck',
  motor: '/lab/drive-unit',
  robot: '/lab/humanoid',
  hole: '/lab/black-hole',
  jet: '/lab/jet-engine',
  f1: '/lab/f1',
  drone: '/lab/drone',
}

export function exhibitFromPath(path: string, search: URLSearchParams): Exhibit {
  const ex = search.get('ex')
  if (ex === 'hall' || EXHIBITS.includes(ex as Exhibit)) return ex as Exhibit
  if (/turbopump/.test(path)) return 'pump'
  if (/rocket-engine/.test(path)) return 'engine'
  if (/production-line/.test(path)) return 'line'
  if (/drone|quadcopter/.test(path)) return 'drone'
  if (/\/f1|formula/.test(path)) return 'f1'
  if (/jet/.test(path)) return 'jet'
  if (/black-hole|wormhole/.test(path)) return 'hole'
  if (/humanoid|robot/.test(path)) return 'robot'
  if (/cybertruck|truck|car/.test(path)) return 'car'
  if (/drive-unit|motor/.test(path)) return 'motor'
  if (/hall/.test(path)) return 'hall'
  return 'fusion'
}

export const S = {
  exhibit: 'fusion' as Exhibit,
  engine: {
    view: 'whole' as EngineView,
    follow: 'all' as Follow,
    throttle: 1,
    alt: 0,
    running: true,
  },
  pump: {
    view: 'cut' as EngineView,
    follow: 'all' as PumpFollow,
    speed: 1,
    mode: 'run' as PumpMode,
    strobe: false,
    /** seconds since the current scenario started */
    modeT: 0,
  },
  fusion: {
    view: 'cut' as EngineView,
    follow: 'all' as FusionFollow,
    /** plasma temperature, million degrees C */
    temp: 150,
    mode: 'run' as FusionMode,
    modeT: 0,
  },
  car: {
    view: 'whole' as CarView,
    follow: 'all' as CarFollow,
    /** km/h the driver asks for */
    speed: 100,
    mode: 'cruise' as CarMode,
    modeT: 0,
    height: 'normal' as RideHeight,
  },
  jet: {
    view: 'whole' as EngineView,
    follow: 'all' as JetFollow,
    throttle: 1,
    ab: true,
  },
  drone: {
    view: 'whole' as EngineView,
    follow: 'all' as DroneFollow,
    mode: 'hover' as DroneMode,
    payload: false,
  },
  f1: {
    view: 'whole' as EngineView,
    follow: 'all' as F1Follow,
    /** km/h */
    speed: 300,
    mode: 'corner' as F1Mode,
  },
  hole: {
    view: 'bh' as HoleView,
    /** 0..1 on a log scale from 10 suns to 6.5 billion */
    mass: 0.64,
    mode: 'watch' as HoleMode,
    modeT: 0,
  },
  robot: {
    view: 'whole' as RobotView,
    follow: 'all' as RobotFollow,
    mode: 'walk' as RobotMode,
    /** kg carried in both hands */
    payload: 0,
  },
  motor: {
    view: 'cut' as EngineView,
    follow: 'all' as MotorFollow,
    /** rpm */
    rpm: 7000,
    mode: 'drive' as MotorMode,
  },
  line: {
    frameSpeed: 1,
    robots: 1 as 1 | 2,
    buffer: 2,
    breakdowns: false,
  },
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onChange(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function changed() {
  for (const fn of listeners) fn()
}
