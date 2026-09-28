/**
 * A deliberately small fusion model, tuned to ITER's design point.
 *
 * Fusion power follows the measured deuterium tritium reactivity (Bosch and
 * Hale fit) at fixed density, scaled so 150 million C gives ITER's 500 MW.
 * Heat leaks out in proportion to the stored energy (constant confinement
 * time, 150 MW of losses at the design point); a fifth of the fusion power
 * stays in the plasma as alpha particles and the heating makes up the rest.
 * That gives Q = 10 at 150 million C, like ITER's target.
 */
function reactivity(TkeV: number) {
  const BG = 34.3827, mrc2 = 1124656
  const C1 = 1.17302e-9, C2 = 1.51361e-2, C3 = 7.51886e-2, C4 = 4.60643e-3, C5 = 1.35e-2, C6 = -1.0675e-4, C7 = 1.366e-5
  const T = Math.max(0.2, TkeV)
  const th = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))))
  const xi = Math.pow((BG * BG) / (4 * th), 1 / 3)
  return C1 * th * Math.sqrt(xi / (mrc2 * T * T * T)) * Math.exp(-3 * xi)
}

const keV = (megaC: number) => megaC / 11.6045
const REF = reactivity(keV(150))

export const FUSION = {
  minT: 15,
  maxT: 180,
  state(megaC: number) {
    const fusion = 500 * (reactivity(keV(megaC)) / REF)
    const loss = 150 * (megaC / 150)
    const heating = Math.max(0, loss - 0.2 * fusion)
    const Q = heating > 0.5 ? fusion / heating : Infinity
    return { fusion, heating, Q, loss }
  },
}
