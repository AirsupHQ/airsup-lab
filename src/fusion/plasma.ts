import * as THREE from 'three'
import { CutState, CUT_PROJ, GLSL_CUT_FRAG_PARS, GLSL_CUT_VERT, GLSL_CUT_VERT_PARS } from '../core/cut'
import { GLSL_NOISE, NOISE3D } from '../core/noise'
import { P2 } from '../core/geometry'

/**
 * Shape of the machine in its own frame (metres at exhibit scale, Y up, the
 * torus axis on Y). Every surface that wraps the plasma is the same D shape
 * grown outward: a flux surface of minor radius a, elongation K and
 * triangularity D (the top and bottom lean inward).
 */
export const TK = {
  R0: 0.8,
  a: 0.3,
  K: 1.7,
  D: 0.38,
  /** first wall (inner face of the blanket) as a multiple of a */
  fw: 1.17,
  blanket: 1.42,
  vvIn: 1.5,
  vvOut: 1.72,
}

/** D shaped contour of size a*s, n points, counter clockwise in (R, Z). */
export function dContour(s: number, n = 96, grow = 0, minR = 0): P2[] {
  const out: P2[] = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    const sn = Math.sin(th)
    const Rc = TK.R0 - TK.a * s * TK.D * sn * sn
    out.push([Math.max(minR, Rc + (TK.a * s + grow) * Math.cos(th)), (TK.K * TK.a * s + grow) * sn])
  }
  return out
}

/** Point on the flux surface rho at poloidal angle th and toroidal angle phi. */
export function fluxPoint(rho: number, th: number, phi: number, out = new THREE.Vector3()) {
  const sn = Math.sin(th)
  const R = TK.R0 - TK.a * rho * TK.D * sn * sn + TK.a * rho * Math.cos(th)
  return out.set(R * Math.cos(phi), TK.K * TK.a * rho * sn, R * Math.sin(phi))
}

/** Normalised minor radius of p (same formula as the shader). */
export function rhoAt(p: THREE.Vector3, a = TK.a) {
  const R = Math.hypot(p.x, p.z)
  const zn = p.y / (TK.K * a)
  const Rc = TK.R0 - a * TK.D * Math.min(zn * zn, 1)
  return Math.hypot((R - Rc) / a, zn)
}

/** Upper or lower half of the ring between two D contours (a simple polygon, so it can be revolved). */
export function dShell(sIn: number, sOut: number, upper: boolean, n = 72): P2[] {
  const o: P2[] = [], i: P2[] = []
  for (let k = 0; k <= n; k++) {
    const th = (upper ? 0 : Math.PI) + (k / n) * Math.PI
    const sn = Math.sin(th), cs = Math.cos(th)
    const ro = TK.R0 - TK.a * sOut * TK.D * sn * sn + TK.a * sOut * cs
    const ri = TK.R0 - TK.a * sIn * TK.D * sn * sn + TK.a * sIn * cs
    o.push([ro, TK.K * TK.a * sOut * sn])
    i.push([ri, TK.K * TK.a * sIn * sn])
  }
  return [...o, ...i.reverse()]
}

/** Live plasma controls, animated by main. */
export const PLASMA = {
  time: { value: 0 },
  /** 0 cold, 1 at the design point (150 million C), up to 1.2 */
  temp: { value: 1 },
  /** overall brightness (0 no plasma) */
  on: { value: 1 },
  /** vertical displacement (fraction of a) during a disruption */
  shift: { value: 0 },
  /** size of the plasma relative to its flux surface (breakdown fills the vessel) */
  size: { value: 1 },
  /** flash where the plasma touches the wall */
  flash: { value: 0 },
  emph: { value: 1 },
  steps: { value: 64 },
}

const VERT = /* glsl */ `
#include <common>
${GLSL_CUT_VERT_PARS}
#include <clipping_planes_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  ${GLSL_CUT_VERT}
}
`

const FRAG = /* glsl */ `
#include <common>
${GLSL_CUT_FRAG_PARS}
${GLSL_NOISE}
#include <clipping_planes_pars_fragment>
uniform float uTime, uTemp, uOn, uShift, uSize, uFlash, uEmph, uSteps;
uniform vec4 uShape; // R0, a, K, D
uniform float uWall;

// normalised minor radius of the D shaped flux surface through p (1 = plasma edge)
float rhoOf(vec3 p, float a, out float th) {
  float R = length(p.xz);
  float Z = p.y - uShift * uShape.y;
  float zn = Z / (uShape.z * a);
  float Rc = uShape.x - a * uShape.w * min(zn * zn, 1.0);
  float x = (R - Rc) / a;
  th = atan(zn, x);
  return length(vec2(x, zn));
}

vec3 ramp(float T) {
  // cool edge (magenta, the colour deuterium actually glows) to a white hot core
  vec3 c0 = vec3(0.55, 0.06, 0.42);
  vec3 c1 = vec3(1.0, 0.22, 0.62);
  vec3 c2 = vec3(0.86, 0.5, 1.0);
  vec3 c3 = vec3(0.92, 0.9, 1.0);
  if (T < 0.35) return mix(c0, c1, T / 0.35);
  if (T < 0.7) return mix(c1, c2, (T - 0.35) / 0.35);
  return mix(c2, c3, (T - 0.7) / 0.3);
}

vec3 emit(vec3 p, out float dens) {
  float a = uShape.y * uSize;
  float th;
  float rho = rhoOf(p, a, th);
  dens = 0.0;
  if (rho > 1.0) return vec3(0.0);
  float phi = atan(p.z, p.x);
  // field lines wind the long way round with safety factor q(rho) = 1 + 2 rho^2
  float q = 1.0 + 2.0 * rho * rho;
  float along = th - phi / q;
  float flow = uTime * 0.35;
  vec3 nq = vec3(rho * 2.2 - uTime * 0.05, along * 0.477 + flow, phi * 0.08 + th * 0.02);
  float fil = n3(nq) * 0.6 + n3(nq * vec3(2.0, 3.0, 5.0) + 0.3) * 0.4;
  float strands = 0.25 + 0.75 * smoothstep(0.38, 0.72, fil);
  float core = pow(max(1.0 - rho * rho, 0.0), 2.2);
  float edge = exp(-pow((rho - 0.92) / 0.055, 2.0));
  float T = clamp(core * (0.3 + 0.7 * uTemp), 0.0, 1.0);
  dens = core + edge;
  vec3 c = ramp(T) * core * (0.1 + 1.1 * uTemp * uTemp) * (0.5 + 0.5 * strands)
         + vec3(1.0, 0.16, 0.55) * edge * (0.35 + 0.4 * uTemp) * strands
         + vec3(0.9, 0.2, 0.7) * 0.08 * (1.0 - rho) * (0.3 + 0.7 * uTemp);
  return c;
}

void main() {
  #include <clipping_planes_fragment>
  // march backwards from where the ray leaves the plasma toward the camera,
  // stopping where it leaves the plasma again or reaches the section plane
  vec3 rd = normalize(vObj - vCutObjCam);
  float camT = length(vObj - vCutObjCam);
  float h = 0.022;
  float jit = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  bool inside = false;
  float t = h * jit;
  float capBoost = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps || t > camT) break;
    vec3 p = vObj - rd * t;
    float th;
    float rw = rhoOf(p, uShape.y * uWall, th);
    if (cutRemoved(p)) {
      // the section face: add the local glow as a thin sheet so the profile reads
      if (rw < 1.0) { float d; vec3 e = emit(p, d); acc += e * 0.07; }
      break;
    }
    if (rw < 1.0) inside = true;
    else if (inside) break;
    float d;
    acc += emit(p, d) * h;
    t += h;
  }
  vec3 col = acc * 6.5 * uOn * uEmph;
  // wall contact flash in a disruption
  col += vec3(1.0, 0.55, 0.9) * uFlash * 0.4;
  gl_FragColor = vec4(col, 1.0);
}
`

export function plasmaMaterial(cut: CutState) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCutPlane: cut.uPlane,
      uCutPlane2: cut.uPlane2,
      uCutGlow: cut.uGlow,
      uCutProj: CUT_PROJ,
      uNoise3D: NOISE3D,
      uTime: PLASMA.time,
      uTemp: PLASMA.temp,
      uOn: PLASMA.on,
      uShift: PLASMA.shift,
      uSize: PLASMA.size,
      uFlash: PLASMA.flash,
      uEmph: PLASMA.emph,
      uSteps: PLASMA.steps,
      uShape: { value: new THREE.Vector4(TK.R0, TK.a, TK.K, TK.D) },
      uWall: { value: TK.fw - 0.02 },
    },
    side: THREE.BackSide,
    clipping: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  m.clippingPlanes = cut.planes
  m.clipIntersection = cut.intersect
  return m
}

/* ---------------- glowing lines: field lines, coil currents, heating beam ---------------- */

export const GLOW_TIME = { value: 0 }

const LINE_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute float aS;
varying float vS;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vS = aS;
}
`
const LINE_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
varying float vS;
uniform vec3 uColor;
uniform float uTime, uSpeed, uScale, uEmph, uBase, uRate;
void main() {
  #include <clipping_planes_fragment>
  float ph = vS / uScale - uTime * uSpeed * uRate;
  float pulse = pow(0.5 + 0.5 * sin(ph * 6.2831853), 6.0);
  float I = (uBase + pulse) * uEmph;
  gl_FragColor = vec4(uColor * I, 1.0);
}
`

export interface GlowLineOpts {
  color: THREE.ColorRepresentation
  emph: { value: number }
  rate?: { value: number }
  speed?: number
  scale?: number
  base?: number
}

export function glowLineMaterial(cut: CutState, o: GlowLineOpts) {
  const m = new THREE.ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(o.color) },
      uTime: GLOW_TIME,
      uSpeed: { value: o.speed ?? 1 },
      uScale: { value: o.scale ?? 0.25 },
      uEmph: o.emph,
      uBase: { value: o.base ?? 0.35 },
      uRate: o.rate ?? { value: 1 },
    },
    clipping: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  m.clippingPlanes = cut.planes
  m.clipIntersection = cut.intersect
  return m
}
