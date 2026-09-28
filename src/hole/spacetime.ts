import * as THREE from 'three'
import { GLSL_NOISE, NOISE3D } from '../core/noise'

/**
 * Light through curved spacetime, traced per pixel.
 *
 * Black hole: Schwarzschild, units of the horizon radius (rs = 1). Photon
 * paths use the exact trick that a Newtonian force a = -3/2 h² r / |r|⁵ on a
 * straight ray (h = |r × v|, constant) traces the same curve as a null
 * geodesic in the Schwarzschild metric. The disk is thin, from the innermost
 * stable orbit (3 rs) outward, with a Novikov Thorne style temperature
 * profile, Keplerian speed, relativistic Doppler beaming (g⁴) and
 * gravitational redshift.
 *
 * Wormhole: the Ellis metric ds² = -dt² + dl² + (b² + l²) dΩ², throat b = 1.
 * In the plane of each ray, d²l/dλ² = L² l / (b² + l²)² and dφ/dλ = L / (b² + l²);
 * rays that end at l > 0 see our sky, l < 0 the sky of the other side.
 */

export const HOLE = {
  time: { value: 0 },
  mode: { value: 0 }, // 0 black hole, 1 wormhole
  mix: { value: 0 }, // 0..1 crossfade between them
  open: { value: 1 }, // portal aperture 0..1
  cam: { value: new THREE.Vector3(0, 0, 40) },
  side: { value: 1 }, // wormhole universe the camera is in
  inside: { value: 0 }, // 1 when rendering full screen from inside portal space
  look: { value: 1 }, // -1 looks back
  probe: { value: new THREE.Vector4(0, 0, 100, 0.12) },
  probeOn: { value: 0 },
  stretch: { value: 1 },
  flash: { value: 0 },
  dark: { value: 0 },
  steps: { value: 220 },
  disk: { value: 1 },
  invVP: { value: new THREE.Matrix4() },
  diskRot: { value: new THREE.Matrix3() },
  scale: { value: 5 },
  center: { value: new THREE.Vector3() },
}

const COMMON = /* glsl */ `
${GLSL_NOISE}
uniform float uTime, uMode, uMix, uOpen, uSide, uInside, uLook, uProbeOn, uStretch, uFlash, uDark, uSteps, uDisk, uScale;
uniform vec3 uCam, uCenter;
uniform vec4 uProbe;
uniform mat3 uDiskRot;

vec3 hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yxz + 19.19);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// a starfield on a cube lattice of directions, plus nebula
vec3 stars(vec3 d, float dens) {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 180.0 : 420.0;
    vec3 q = d * sc;
    vec3 cell = floor(q);
    vec3 h = hash3(cell + float(k) * 17.0);
    if (h.x < dens * (k == 0 ? 0.12 : 0.35)) {
      vec3 sp = cell + 0.2 + 0.6 * h;
      float dist = length(q - sp);
      float b = pow(h.y, 6.0) * (k == 0 ? 5.0 : 1.4) + 0.05;
      vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.65), h.z);
      c += tint * b * exp(-dist * dist * (k == 0 ? 18.0 : 30.0));
    }
  }
  return c;
}

vec3 skyA(vec3 d) {
  // our side: a milky way band, faint blue and violet dust
  float band = exp(-pow(dot(d, normalize(vec3(0.2, 1.0, 0.35))) * 3.2, 2.0));
  float n = fbm2(d * 1.7 + 0.3) ;
  float n2 = n3(d * 4.0 + 2.0);
  vec3 neb = vec3(0.12, 0.16, 0.32) * band * (0.4 + n) + vec3(0.35, 0.18, 0.42) * pow(n2, 3.0) * band * 0.8;
  neb += vec3(0.9, 0.85, 0.8) * band * pow(n, 4.0) * 0.35;
  return neb * 0.55 + stars(d, 0.6 + band);
}

vec3 skyB(vec3 d) {
  // the other side: a warm nebula around a bright young star
  vec3 sunDir = normalize(vec3(-0.3, 0.25, 1.0));
  float sd = max(0.0, dot(d, sunDir));
  float n = fbm2(d * 1.4 + 5.1);
  float n2 = n3(d * 3.2 + 8.0);
  float n3b = n3(d * 7.0 + 3.0);
  vec3 neb = mix(vec3(0.9, 0.12, 0.35), vec3(1.0, 0.62, 0.22), n) * pow(n, 1.3) * 1.3 + vec3(0.1, 0.6, 0.75) * pow(n2, 2.5) * 1.1 + vec3(1.0, 0.85, 0.6) * pow(n3b, 6.0) * 0.8;
  vec3 sun = vec3(1.0, 0.92, 0.8) * (pow(sd, 900.0) * 60.0 + pow(sd, 40.0) * 0.8);
  vec3 base = vec3(0.02, 0.015, 0.04);
  return base + neb * neb * 0.9 + sun + stars(d, 1.2) * vec3(1.0, 0.9, 0.8) * 1.4;
}

// blackbody-ish ramp: t 0 dull red .. 1 white .. above, blue white
vec3 bb(float t) {
  t = clamp(t, 0.0, 1.6);
  vec3 c = mix(vec3(0.6, 0.06, 0.0), vec3(1.0, 0.45, 0.1), smoothstep(0.0, 0.45, t));
  c = mix(c, vec3(1.0, 0.86, 0.6), smoothstep(0.35, 0.85, t));
  c = mix(c, vec3(0.8, 0.88, 1.0), smoothstep(0.9, 1.5, t));
  return c;
}

vec4 diskHit(vec3 q, vec3 rd) {
  float r = length(q.xz);
  if (r < 3.0 || r > 15.0) return vec4(0.0);
  float phi = atan(q.z, q.x);
  float prof = pow(r, -0.75) * pow(max(0.0, 1.0 - sqrt(3.0 / r)), 0.25) / 0.33;
  float om = pow(r, -1.5) * 2.2;
  vec3 np = vec3(log(r) * 2.6, (phi - uTime * om) * 1.2, 0.3);
  vec3 cq = vec3(cos(phi - uTime * om) * r * 0.25, sin(phi - uTime * om) * r * 0.25, log(r) * 1.5);
  float turb = fbm2(cq * 0.9) * 0.75 + n3(cq * 3.1 + 1.7) * 0.5;
  float lanes = 0.55 + 0.45 * sin(np.x * 9.0 + turb * 4.0);
  float beta = clamp(sqrt(1.0 / (2.0 * max(r - 1.0, 0.2))), 0.0, 0.8);
  vec3 vel = normalize(vec3(-sin(phi), 0.0, cos(phi)));
  float cosT = dot(vel, -normalize(rd));
  float gam = 1.0 / sqrt(1.0 - beta * beta);
  float g = sqrt(max(0.0, 1.0 - 1.0 / r)) / (gam * (1.0 - beta * cosT));
  float edge = smoothstep(15.0, 10.0, r) * smoothstep(3.0, 3.4, r);
  float I = prof * pow(g, 4.0) * (0.35 + 0.9 * turb * lanes) * edge;
  vec3 c = bb(prof * g * 0.95 + 0.1) * I * 3.4;
  float a = clamp(edge * (0.55 + 0.4 * turb), 0.0, 0.92);
  return vec4(c, a);
}

// probe: a small bright capsule, stretched along the radial direction
float probeHit(vec3 a, vec3 b, out vec3 hp) {
  if (uProbeOn < 0.01) return -1.0;
  vec3 c = uProbe.xyz;
  vec3 rad = normalize(c);
  vec3 d = b - a;
  // squash space along the radial axis so the ellipsoid becomes a sphere
  float s = 1.0 / max(uStretch, 1.0);
  vec3 A = a - c, D = d;
  A += rad * dot(A, rad) * (s - 1.0);
  D += rad * dot(D, rad) * (s - 1.0);
  float R = uProbe.w;
  float qa = dot(D, D), qb = 2.0 * dot(A, D), qc = dot(A, A) - R * R;
  float disc = qb * qb - 4.0 * qa * qc;
  if (disc < 0.0) return -1.0;
  float t = (-qb - sqrt(disc)) / (2.0 * qa);
  if (t < 0.0 || t > 1.0) return -1.0;
  hp = a + d * t;
  return t;
}

vec3 traceHole(vec3 ro, vec3 rd) {
  vec3 p = ro, v = rd;
  float h2 = dot(cross(p, v), cross(p, v));
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < 600; i++) {
    if (float(i) >= uSteps) break;
    float r = length(p);
    if (r < 1.0) return acc;
    float h = clamp(0.1 * (r - 0.85), 0.012, 1.6);
    vec3 a = -1.5 * h2 * p / pow(r, 5.0);
    vec3 v2 = v + a * h;
    vec3 p2 = p + v2 * h;
    if (uDisk > 0.5) {
      vec3 q0 = uDiskRot * p, q1 = uDiskRot * p2;
      if (q0.y * q1.y < 0.0) {
        vec3 q = mix(q0, q1, q0.y / (q0.y - q1.y));
        vec4 dh = diskHit(q, uDiskRot * v2);
        acc += dh.rgb * trans * dh.a;
        trans *= 1.0 - dh.a;
      }
    }
    vec3 hp;
    if (probeHit(p, p2, hp) >= 0.0) {
      float rp = length(uProbe.xyz);
      float g = sqrt(max(0.0, 1.0 - 1.0 / rp));
      float blink = step(0.5, fract(uTime * 1.2 * g + 0.2));
      vec3 pc = vec3(0.85, 0.9, 1.0) * (0.5 + 1.5 * g) * g + vec3(1.0, 0.3, 0.2) * blink * 6.0 * g * g;
      return acc + pc * trans;
    }
    p = p2; v = v2;
    if (r > 120.0 && dot(p, v) > 0.0) break;
    if (trans < 0.01) return acc;
  }
  return acc + skyA(normalize(v)) * trans;
}

vec3 traceWorm(vec3 ro, vec3 rd, float side) {
  float l = side * max(length(ro), 1e-3);
  vec3 n0 = normalize(ro);
  float ca = dot(rd, n0) * side;
  vec3 t0 = rd - n0 * dot(rd, n0);
  float lt = length(t0);
  t0 = lt > 1e-5 ? t0 / lt : normalize(cross(n0, vec3(0.0, 1.0, 0.1)));
  float R0 = sqrt(1.0 + l * l);
  float sa = sqrt(max(0.0, 1.0 - ca * ca));
  float L = R0 * sa;
  float pl = ca; // dl/dlambda: outward in either universe means |l| grows
  float phi = 0.0;
  for (int i = 0; i < 600; i++) {
    if (float(i) >= uSteps) break;
    float r2 = 1.0 + l * l;
    float h = clamp(0.08 * sqrt(r2), 0.015, 1.4);
    pl += L * L * l / (r2 * r2) * h;
    l += pl * h;
    phi += L / (1.0 + l * l) * h;
    if (abs(l) > 90.0) break;
  }
  vec3 dir = normalize(cos(phi) * n0 + sin(phi) * t0);
  // a thin rim of light where rays graze the throat
  return l > 0.0 ? skyA(dir) : skyB(dir);
}

vec3 shade(vec3 ro, vec3 rd) {
  vec3 c;
  if (uMix < 0.001) c = traceHole(ro, rd);
  else if (uMix > 0.999) c = traceWorm(ro * 0.24, rd, uSide);
  else c = mix(traceHole(ro, rd), traceWorm(ro * 0.24, rd, uSide), uMix);
  c = mix(c, vec3(0.0), uDark);
  c += vec3(1.0, 0.96, 0.9) * uFlash * 6.0;
  return c;
}
`

const MESH_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const MESH_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  if (r > uOpen) discard;
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 ro = (vWorld - uCenter) * uScale;
  vec3 c = shade(ro, rd);
  // the event surface of the portal itself: a faint shimmer at the rim
  float rim = smoothstep(uOpen - 0.08, uOpen, r);
  c += vec3(0.5, 0.8, 1.0) * rim * 1.6;
  gl_FragColor = vec4(c, 1.0);
}
`

const FS_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
const FS_FRAG = /* glsl */ `
${COMMON}
uniform mat4 uInvVP;
varying vec2 vNdc;
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(b.xyz / b.w - a.xyz / a.w) * uLook;
  gl_FragColor = vec4(shade(uCam, rd), 1.0);
}
`

function uniforms() {
  return {
    uNoise3D: NOISE3D,
    uTime: HOLE.time, uMode: HOLE.mode, uMix: HOLE.mix, uOpen: HOLE.open, uSide: HOLE.side, uInside: HOLE.inside, uLook: HOLE.look,
    uProbeOn: HOLE.probeOn, uStretch: HOLE.stretch, uFlash: HOLE.flash, uDark: HOLE.dark, uSteps: HOLE.steps, uDisk: HOLE.disk,
    uScale: HOLE.scale, uCam: HOLE.cam, uCenter: HOLE.center, uProbe: HOLE.probe, uDiskRot: HOLE.diskRot, uInvVP: HOLE.invVP,
  }
}

export function portalMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: MESH_VERT, fragmentShader: MESH_FRAG, uniforms: uniforms(), side: THREE.DoubleSide })
}

export function fullscreenMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: FS_FRAG, uniforms: uniforms(), depthTest: false, depthWrite: false })
}
