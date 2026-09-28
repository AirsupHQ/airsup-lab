import * as THREE from 'three'
import { CutState, CUT_PROJ, GLSL_CUT_FRAG, GLSL_CUT_FRAG_PARS, GLSL_CUT_VERT, GLSL_CUT_VERT_PARS } from '../core/cut'
import { GLSL_NOISE, NOISE3D } from '../core/noise'

export type FluidKind = 'lox' | 'ch4' | 'oxgas' | 'fuelgas' | 'fire'

/** Shared per kind: colour and a live emphasis value the UI animates. */
export const FLUIDS: Record<FluidKind, { color: THREE.Color; emph: { value: number } }> = {
  lox: { color: new THREE.Color(0x46c8ff), emph: { value: 1 } },
  ch4: { color: new THREE.Color(0xffa23a), emph: { value: 1 } },
  oxgas: { color: new THREE.Color(0x9b7bff), emph: { value: 1 } },
  fuelgas: { color: new THREE.Color(0xff5a2a), emph: { value: 1 } },
  fire: { color: new THREE.Color(0xffd9a8), emph: { value: 1 } },
}

export const FLUID_TIME = { value: 0 }
/** Overall flow speed (0 = stopped engine, 1 = full throttle). */
export const FLUID_RATE = { value: 1 }
/** Overall brightness of all internal flows (0 when the engine is off). */
export const FLUID_ON = { value: 1 }

export interface FluidOpts {
  kind: FluidKind
  /** 0 = along attribute aS (pipes), 1 = along object +Y, 2 = along -Y, 3 = combustion field, 4 = swirl around Y */
  mode: 0 | 1 | 2 | 3 | 4
  /** Pattern length in object units. */
  scale?: number
  speed?: number
  /** Additive, translucent gas (true) or opaque glowing liquid (false). */
  gas?: boolean
  intensity?: number
  /** For the combustion field: lookup texture of time of flight, speed, temperature, radius vs y. */
  field?: THREE.DataTexture
  fieldRange?: [number, number]
  /** per assembly overrides */
  rate?: { value: number }
  on?: { value: number }
  emph?: { value: number }
}

const VERT = /* glsl */ `
#include <common>
${GLSL_CUT_VERT_PARS}
attribute float aS;
varying float vS;
varying vec3 vViewPosition;
#include <clipping_planes_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vViewPosition = -mvPosition.xyz;
  vS = aS;
  ${GLSL_CUT_VERT}
}
`

const FRAG = /* glsl */ `
#include <common>
${GLSL_CUT_FRAG_PARS}
${GLSL_NOISE}
#include <clipping_planes_pars_fragment>
varying float vS;
varying vec3 vViewPosition;
uniform vec3 uColor;
uniform float uEmph;
uniform float uTime;
uniform float uRate;
uniform float uOn;
uniform float uScale;
uniform float uSpeed;
uniform float uIntensity;
uniform int uMode;
uniform float uGas;
uniform sampler2D uField;
uniform vec2 uFieldRange;

vec3 fireRamp(float T) {
  // cool exhaust (deep violet blue) to white hot chamber gas
  vec3 c0 = vec3(0.16, 0.16, 0.95);
  vec3 c1 = vec3(0.52, 0.22, 1.0);
  vec3 c2 = vec3(1.0, 0.36, 0.42);
  vec3 c3 = vec3(1.0, 0.62, 0.24);
  vec3 c4 = vec3(1.0, 0.93, 0.78);
  if (T < 0.3) return mix(c0, c1, T / 0.3);
  if (T < 0.56) return mix(c1, c2, (T - 0.3) / 0.26);
  if (T < 0.76) return mix(c2, c3, (T - 0.56) / 0.2);
  return mix(c3, c4, (T - 0.76) / 0.24);
}

void main() {
  vec4 diffuseColor = vec4(1.0);
  #include <clipping_planes_fragment>
  ${GLSL_CUT_FRAG}
  if (!gl_FrontFacing && !cutCap) discard;
  #ifndef CAPS
  if (uMode != 3) discard;
  #endif
  vec3 P = cutCap ? cutHit : vObj;
  float t = uTime;
  float thick = cutCap ? length(vObj - cutHit) : 0.0;
  vec3 col = uColor;
  float I = 1.0;

  if (uMode == 3) {
    // Combustion field inside chamber and nozzle.
    float fy = clamp((P.y - uFieldRange.x) / (uFieldRange.y - uFieldRange.x), 0.0, 1.0);
    vec4 fd = texture2D(uField, vec2(fy, 0.5));
    float tof = fd.r, spd = fd.g, T = fd.b, R = max(fd.a, 1e-3);
    float r = length(P.xz) / R;
    float streak = n3(vec3(tof * 1.3 - t * 1.6 * uRate, r * 3.0, P.x * 0.9 + P.z * 0.9));
    float fine = n3(vec3(tof * 4.0 - t * 4.0 * uRate, r * 9.0, 0.37));
    float temp = T * (0.88 + 0.12 * (1.0 - r * r)) + (streak - 0.5) * 0.12;
    col = fireRamp(clamp(temp, 0.0, 1.0));
    float dens = mix(0.55, 1.0, T) * (0.75 + 0.5 * streak) * (0.85 + 0.3 * fine);
    // near the injector face the gas is still mixing: show the jets
    float jets = smoothstep(0.08, 0.0, uFieldRange.y - P.y) * (0.5 + 0.5 * sin(r * 40.0));
    dens += jets * 0.6;
    // sonic line at the throat
    float sonic = exp(-pow((spd - 1.0) * 14.0, 2.0)) * 1.4;
    col += vec3(0.8, 0.9, 1.0) * sonic * 0.6;
    I = dens * (cutCap ? (0.2 + min(thick, 0.6) * 2.6) : 1.2) * mix(0.45, 1.0, T);
  } else {
    float s;
    if (uMode == 0) s = vS;
    else if (uMode == 1) s = P.y;
    else if (uMode == 2) s = -P.y;
    else s = atan(P.z, P.x) * 0.3 + P.y;
    float ph = s / uScale - t * uSpeed * uRate;
    float bands = 0.62 + 0.38 * smoothstep(0.15, 0.85, abs(fract(ph) * 2.0 - 1.0));
    float streak = n3(vec3(ph * 0.35, P.x * 2.3 + P.z * 2.3, P.y * 0.8));
    float fine = n3(vec3(ph * 1.7, P.x * 7.0, P.z * 7.0 + P.y * 3.0));
    I = bands * (0.7 + 0.6 * streak) * (0.85 + 0.3 * fine);
    if (uGas > 0.5) I *= cutCap ? (0.35 + thick * 5.0) : 0.6;
  }
  I *= uIntensity * uEmph * uOn;
  vec3 outc = col * I;
  if (uGas > 0.5) {
    gl_FragColor = vec4(outc, 1.0);
  } else {
    // liquids are opaque: a dim base so they read as a body of liquid when dimmed
    gl_FragColor = vec4(outc + col * 0.05, 0.0);
  }
}
`

export function fluidMat(cut: CutState, o: FluidOpts) {
  const F = FLUIDS[o.kind]
  const gas = o.gas ?? (o.kind === 'oxgas' || o.kind === 'fuelgas' || o.kind === 'fire')
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCutPlane: cut.uPlane,
      uCutPlane2: cut.uPlane2,
      uCutGlow: cut.uGlow,
      uCutProj: CUT_PROJ,
      uNoise3D: NOISE3D,
      uColor: { value: F.color },
      uEmph: o.emph ?? F.emph,
      uTime: FLUID_TIME,
      uRate: o.rate ?? FLUID_RATE,
      uOn: o.on ?? FLUID_ON,
      uScale: { value: o.scale ?? 0.12 },
      uSpeed: { value: o.speed ?? 1.2 },
      uIntensity: { value: o.intensity ?? 1.6 },
      uMode: { value: o.mode },
      uGas: { value: gas ? 1 : 0 },
      uField: { value: o.field ?? null },
      uFieldRange: { value: new THREE.Vector2(...(o.fieldRange ?? [0, 1])) },
    },
    side: THREE.DoubleSide,
    defines: cut.capsOn ? { CAPS: 1 } : {},
    clipping: true,
    transparent: gas,
    depthWrite: !gas,
    blending: gas ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  m.clippingPlanes = cut.planes
  m.clipIntersection = cut.intersect
  m.userData.caps = cut.capsOn
  cut.materials.add(m)
  m.userData.kind = o.kind
  m.userData.gas = gas
  return m
}
