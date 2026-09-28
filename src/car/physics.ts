/**
 * Road load for a large electric pickup in the Cybertruck class. Mass, power,
 * battery and drag follow published figures for the tri motor truck; the rest
 * is textbook: aero drag grows with the square of speed, rolling resistance is
 * roughly constant, and the battery supplies the wheels through a drivetrain
 * that is about 88% efficient.
 */
export const TRUCK = {
  mass: 3104, // kg, tri motor curb weight
  cdA: 1.04, // m², drag coefficient about 0.34 on about 3.1 m² of frontal area
  crr: 0.011,
  rho: 1.2,
  g: 9.81,
  peak: 630, // kW, three motors together
  battery: 123, // kWh usable
  cells: 1344,
  eta: 0.88,
  aux: 1.5, // kW for screens, pumps and the heat pump
  wheelR: 0.445, // m, 35 inch tyres
  gear: 12, // about 12 to 1 from motor to wheel
  maxSpeed: 200,
  /** the grip limit off the line, about 1.05 g */
  aMax: 10.3,
}

export interface Load {
  /** km/h */
  v: number
  /** power at the wheels, kW (negative while braking) */
  wheel: number
  /** power from the battery, kW (negative while charging it back) */
  battery: number
  aero: number
  rolling: number
  /** km of range at this steady speed, from a full battery */
  range: number
  /** motor speed, rpm */
  rpm: number
}

export function load(vKmh: number, accel = 0): Load {
  const v = Math.max(0, vKmh) / 3.6
  const aeroN = 0.5 * TRUCK.rho * TRUCK.cdA * v * v
  const rollN = v > 0.05 ? TRUCK.crr * TRUCK.mass * TRUCK.g : 0
  const accelN = TRUCK.mass * accel
  const wheel = ((aeroN + rollN + accelN) * v) / 1000
  const battery = wheel >= 0 ? wheel / TRUCK.eta + TRUCK.aux : wheel * 0.8 + TRUCK.aux
  const cruise = ((aeroN + rollN) * v) / 1000 / TRUCK.eta + TRUCK.aux
  const range = v > 0.5 ? (TRUCK.battery / cruise) * (v * 3.6) : 0
  const rpm = (v / (2 * Math.PI * TRUCK.wheelR)) * 60 * TRUCK.gear
  return { v: vKmh, wheel, battery, aero: (aeroN * v) / 1000, rolling: (rollN * v) / 1000, range, rpm }
}

/** Launch acceleration at a given speed (m/s²): grip limited first, then power limited. */
export function launchAccel(vKmh: number) {
  const v = Math.max(0.1, vKmh / 3.6)
  const drag = 0.5 * TRUCK.rho * TRUCK.cdA * v * v + TRUCK.crr * TRUCK.mass * TRUCK.g
  const byPower = (TRUCK.peak * 1000 * 0.92) / v
  return (Math.min(TRUCK.aMax * TRUCK.mass, byPower) - drag) / TRUCK.mass
}
