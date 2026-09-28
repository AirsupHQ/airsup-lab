import * as THREE from 'three'

/** Small deterministic PRNG so every run (and every video frame) is identical. */
export function rng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Tileable 3D value-noise texture (fbm, 4 octaves). Sampled with hardware
 * trilinear filtering it is far cheaper than procedural noise in the plume
 * ray march and in the surface shaders.
 */
export function makeNoise3D(size = 64): THREE.Data3DTexture {
  const r = rng(7)
  const lat = (period: number) => {
    const a = new Float32Array(period * period * period)
    for (let i = 0; i < a.length; i++) a[i] = r()
    return a
  }
  const octaves = [
    { p: 8, w: 0.5, l: lat(8) },
    { p: 16, w: 0.25, l: lat(16) },
    { p: 32, w: 0.15, l: lat(32) },
    { p: 64, w: 0.1, l: lat(64) },
  ]
  const data = new Uint8Array(size * size * size)
  const sm = (t: number) => t * t * (3 - 2 * t)
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let v = 0
        for (const o of octaves) {
          const f = o.p / size
          const fx = x * f, fy = y * f, fz = z * f
          const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz)
          const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz)
          const P = o.p
          const at = (a: number, b: number, c: number) => o.l[((a % P) + ((b % P) * P) + ((c % P) * P * P))]
          const x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1, z0 = iz, z1 = iz + 1
          const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx
          const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx
          const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx
          const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx
          const c0 = c00 * (1 - ty) + c10 * ty
          const c1 = c01 * (1 - ty) + c11 * ty
          v += (c0 * (1 - tz) + c1 * tz) * o.w
        }
        data[x + y * size + z * size * size] = Math.max(0, Math.min(255, Math.round(v * 255)))
      }
  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

export const NOISE3D = { value: null as THREE.Data3DTexture | null }

/** GLSL helpers shared by the surface and effect shaders. */
export const GLSL_NOISE = /* glsl */ `
uniform highp sampler3D uNoise3D;
float n3(vec3 p) { return texture(uNoise3D, p).r; }
float fbm2(vec3 p) { return n3(p) * 0.65 + n3(p * 2.7 + 0.31) * 0.35; }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`
