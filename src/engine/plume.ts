import * as THREE from 'three'
import { GLSL_NOISE, NOISE3D } from '../core/noise'
import { GEO } from './raptor'

/**
 * Engine physics for the lab. Anchored to SpaceX's published Raptor 3
 * figures (280 tf, 350 bar, Isp 350 s) and Raptor's 34.34 area ratio.
 */
export const PHYS = {
  thrustSL: 280, // tf at 100 %, sea level
  pc: 350, // bar at 100 %
  mdot: 800, // kg/s at 100 % (280 tf / 350 s)
  of: 3.6,
  exitArea: Math.PI * 0.65 * 0.65,
  /** exit to chamber pressure for area ratio 34.34, gamma 1.2 */
  peRatio: 0.00269,
  ambient(hKm: number) {
    return 1.01325 * Math.exp(-hKm / 8.4)
  },
  state(throttle: number, hKm: number) {
    const pc = this.pc * throttle
    const pe = pc * this.peRatio
    const pa = this.ambient(hKm)
    // thrust = throttle * vacuum thrust - pa * Ae (kN -> tf)
    const vacTf = this.thrustSL + (1.01325e5 * this.exitArea) / 9806.65
    const thrust = throttle * vacTf - (pa * 1e5 * this.exitArea) / 9806.65
    const n = pe / Math.max(pa, 1e-7)
    return { pc, pe, pa, n, thrust, mdot: this.mdot * throttle, lox: this.mdot * throttle * (this.of / (1 + this.of)), ch4: this.mdot * throttle * (1 / (1 + this.of)) }
  },
}

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
precision highp float;
${GLSL_NOISE}
varying vec3 vWorld;
uniform mat4 uW2P;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear, uFar;
uniform vec3 uCamFwd;
uniform float uLen, uRad;
uniform float uN, uVac, uThr, uCell, uBeq, uStr, uInt, uTime, uOn, uSteps;

float viewZ(float d) { return (uNear * uFar) / ((uFar - uNear) * d - uFar); }

vec3 emission(vec3 p, out float haze) {
  float x = p.x;
  float r = length(p.yz);
  float tu = n3(vec3(x * 0.06 - uTime * 0.5, p.y * 0.14, p.z * 0.14));
  float tu2 = n3(vec3(x * 0.21 - uTime * 1.7, p.y * 0.45 + 3.1, p.z * 0.45 + 1.7));
  float turb = tu * 0.6 + tu2 * 0.4;

  // ---------- atmospheric jet: boundary oscillates through shock cells ----------
  float L = uCell;
  float decay = exp(-x / (2.6 * L));
  float grow = 1.0 + 0.03 * x + 0.004 * x * x;
  float A = (uBeq - 1.0) * 0.55;
  A += (A >= 0.0 ? 0.035 : -0.035);
  float b = (uBeq - A * cos(6.2831853 * x / L) * decay) * grow;
  b *= 1.0 + (turb - 0.5) * 0.18 * smoothstep(1.5, 7.0, x);
  b = max(b, 0.3);
  float inside = smoothstep(b * 1.05, b * 0.86, r);

  float k0 = floor(x / L - 0.55 + 0.5);
  float xk = (k0 + 0.55) * L;
  float kp = floor(x / L - 0.55);
  float xp = (kp + 0.55) * L;
  float over = step(uBeq, 1.0);
  float kd = mix(0.75, 0.55, over);
  float strk = uStr * exp(-max(k0, 0.0) * kd);
  float strp = uStr * exp(-max(kp, 0.0) * kd);
  float dx = (x - xk) / (0.15 * L);
  float bd = min(b, 1.25);
  float spindle = exp(-dx * dx) * exp(-pow(r / (0.23 * bd * (1.0 - 0.3 * dx * dx)), 2.0)) * step(-0.5, k0);
  float core = exp(-dx * dx * 5.0) * exp(-pow(r / (0.1 * bd), 2.0)) * step(-0.5, k0);
  float tail = (kp >= 0.0 ? 1.0 : 0.0) * exp(-max(x - xp, 0.0) / (0.22 * L)) * step(xp, x) * exp(-pow(r / (0.28 * bd), 2.0));
  float ph = fract(x / L);
  float rs = b * abs(1.0 - 2.0 * ph);
  float sheet = exp(-pow((r - rs) / (0.1 * b), 2.0)) * inside * decay * smoothstep(0.0, 0.5, x) * (0.6 + 0.8 * tu2);

  vec3 e = vec3(0.0);
  e += vec3(1.0, 0.9, 0.78) * core * strk * 10.0;
  e += vec3(1.0, 0.64, 0.62) * spindle * strk * 3.2;
  e += vec3(0.95, 0.45, 0.72) * tail * strp * 0.9 * (0.75 + 0.5 * tu2);
  e += vec3(0.68, 0.45, 1.0) * sheet * (0.06 + uStr * 0.09) / max(1.0, uBeq);
  // translucent violet jet body, brightest right behind the exit
  e += vec3(0.36, 0.3, 1.0) * inside * (0.07 + 0.2 * exp(-x / 2.2)) * (0.75 + 0.5 * tu);
  e += vec3(0.7, 0.62, 1.0) * exp(-x / 0.28) * exp(-pow(r / 0.97, 8.0)) * 0.8;
  // afterburning mantle: patchy, grows downstream
  float mantle = exp(-pow((r - b * 1.05) / (0.35 * b), 2.0)) * smoothstep(3.0, 9.0, x) * exp(-x / (uLen * 0.8));
  e += vec3(1.0, 0.46, 0.26) * mantle * smoothstep(0.42, 0.9, turb) * 0.42;
  float far = exp(-pow(r / (b * 1.1), 2.0)) * smoothstep(3.5 * L, 8.0 * L, x) * exp(-max(x - 5.0 * L, 0.0) / (uLen * 0.4));
  e += vec3(1.0, 0.52, 0.22) * far * smoothstep(0.35, 0.95, turb) * 0.45;
  // under-expanded jets carry their energy further out: keep brightness per area steady
  e /= max(1.0, uBeq * uBeq * 0.85);

  // ---------- vacuum plume: wide, faint ----------
  float bv = 1.0 + x * 0.8;
  vec3 ev = vec3(0.46, 0.36, 1.0) * exp(-pow(r / bv, 2.0) * 1.7) * exp(-x / 9.0) / (bv * bv) * (0.75 + 0.5 * turb) * 1.15;
  // faint luminous boundary of the expanding plume
  ev += vec3(0.55, 0.42, 1.0) * exp(-pow((r - bv * 0.82) / (0.22 * bv), 2.0)) * exp(-x / 11.0) / bv * (0.6 + 0.6 * tu2) * 0.55;
  ev += vec3(0.75, 0.64, 1.0) * exp(-x / 0.7) * exp(-pow(r / (0.9 + x * 0.35), 2.0)) * 0.4;

  e = mix(e, ev, uVac);
  haze = exp(-pow(r / (b * 1.2), 2.0)) * exp(-x / 14.0) * (1.0 - uVac) * (0.5 + turb);
  return e;
}

void main() {
  vec3 ro = (uW2P * vec4(cameraPosition, 1.0)).xyz;
  vec3 rdw = normalize(vWorld - cameraPosition);
  vec3 rd = (uW2P * vec4(rdw, 0.0)).xyz;
  // cylinder r < uRad along +x, x in [0, uLen]
  float a = dot(rd.yz, rd.yz);
  float bq = 2.0 * dot(ro.yz, rd.yz);
  float c = dot(ro.yz, ro.yz) - uRad * uRad;
  float disc = bq * bq - 4.0 * a * c;
  if (disc <= 0.0 || a < 1e-9) discard;
  float sq = sqrt(disc);
  float t0 = (-bq - sq) / (2.0 * a);
  float t1 = (-bq + sq) / (2.0 * a);
  float tx0 = (0.0 - ro.x) / rd.x, tx1 = (uLen - ro.x) / rd.x;
  if (tx0 > tx1) { float tt = tx0; tx0 = tx1; tx1 = tt; }
  t0 = max(max(t0, tx0), 0.0);
  t1 = min(t1, tx1);
  vec2 uv = gl_FragCoord.xy / uRes;
  float d = texture2D(uDepth, uv).x;
  if (d < 1.0) {
    float vz = -viewZ(d);
    float ts = vz / max(dot(rdw, uCamFwd), 1e-4);
    t1 = min(t1, ts);
  }
  if (t1 <= t0) discard;
  float n = uSteps;
  float dt = (t1 - t0) / n;
  float jitter = ign(gl_FragCoord.xy + fract(uTime * 7.13) * 64.0);
  float segLen = length(rd) * dt;
  vec3 acc = vec3(0.0);
  float hz = 0.0;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= n) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * t;
    float rr = length(p.yz);
    float reach = 1.35 * uBeq * (1.0 + 0.035 * p.x + 0.004 * p.x * p.x) + 0.4 + uVac * (0.9 + 0.8 * p.x);
    if (rr > reach) continue;
    float h;
    acc += emission(p, h) * segLen;
    hz += h * segLen;
  }
  float flick = 0.94 + 0.06 * n3(vec3(uTime * 3.1, 0.2, 0.7)) + 0.03 * sin(uTime * 47.0);
  acc *= uInt * uOn * flick;
  gl_FragColor = vec4(acc, hz * uOn * 0.12);
}
`

export class Plume {
  readonly scene = new THREE.Scene()
  readonly mesh: THREE.Mesh
  readonly frame = new THREE.Object3D()
  readonly material: THREE.ShaderMaterial
  readonly lights: THREE.PointLight[] = []
  /** Plume box in exit radius units. */
  len = 20
  rad = 5
  private w2p = new THREE.Matrix4()
  /** smoothed physics */
  s = { n: 1, vac: 0, thr: 1, cell: 2.8, beq: 1, str: 0.5, int: 1, on: 1 }

  constructor(private engineRoot: THREE.Object3D, lightParent: THREE.Object3D) {
    const g = new THREE.CylinderGeometry(this.rad, this.rad, this.len, 40, 1, false)
    g.rotateZ(-Math.PI / 2)
    g.translate(this.len / 2, 0, 0)
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uW2P: { value: this.w2p },
        uDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.05 },
        uFar: { value: 60 },
        uCamFwd: { value: new THREE.Vector3() },
        uLen: { value: this.len },
        uRad: { value: this.rad },
        uN: { value: 1 },
        uVac: { value: 0 },
        uThr: { value: 1 },
        uCell: { value: 2.8 },
        uBeq: { value: 1 },
        uStr: { value: 0.5 },
        uInt: { value: 1 },
        uTime: { value: 0 },
        uOn: { value: 1 },
        uSteps: { value: 56 },
        uNoise3D: NOISE3D,
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    })
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.frame.add(this.mesh)
    this.scene.add(this.frame)
    this.frame.matrixAutoUpdate = false

    const cols = [0xb48cff, 0xff9a6a]
    const xs = [1.4, 5.0]
    for (let i = 0; i < 2; i++) {
      const L = new THREE.PointLight(cols[i], 0, 3.2, 2)
      L.userData.x = xs[i]
      lightParent.add(L)
      this.lights.push(L)
    }
  }

  /** Target physics, smoothed toward over time. */
  update(dt: number, t: number, throttle: number, hKm: number, on: number) {
    const st = PHYS.state(throttle, hKm)
    const n = Math.min(Math.max(st.n, 0.15), 1e6)
    const ln = Math.log(n)
    const vac = THREE.MathUtils.smoothstep(Math.log10(n), 0.9, 2.7)
    const beq = THREE.MathUtils.clamp(Math.pow(n, 0.28), 0.72, 3.2)
    const cell = 3.1 * Math.pow(beq, 0.85)
    const str = (0.45 + 1.15 * Math.min(Math.abs(ln), 1.6)) * (1 - vac)
    const int = (0.45 + 0.55 * throttle)
    const k = 1 - Math.exp(-dt * 3.2)
    const s = this.s
    s.n += (n - s.n) * k
    s.vac += (vac - s.vac) * k
    s.thr += (throttle - s.thr) * k
    s.cell += (cell - s.cell) * k
    s.beq += (beq - s.beq) * k
    s.str += (str - s.str) * k
    s.int += (int - s.int) * k
    s.on += (on - s.on) * (1 - Math.exp(-dt * 5))
    const u = this.material.uniforms
    u.uN.value = s.n
    u.uVac.value = s.vac
    u.uThr.value = s.thr
    u.uCell.value = s.cell
    u.uBeq.value = s.beq
    u.uStr.value = s.str
    u.uInt.value = s.int
    u.uOn.value = s.on
    u.uTime.value = t
    u.uRad.value = Math.min(this.rad, 1.6 + 1.9 * s.beq + 3.2 * s.vac)

    // frame: engine root * translate to exit * rotate +x to -y * scale Re
    this.engineRoot.updateWorldMatrix(true, false)
    const m = new THREE.Matrix4()
      .multiply(this.engineRoot.matrixWorld)
      .multiply(new THREE.Matrix4().makeTranslation(0, GEO.yE, 0))
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(GEO.Re, GEO.Re, GEO.Re))
    this.frame.matrix.copy(m)
    this.frame.matrixWorld.copy(m)
    this.mesh.updateMatrixWorld(true)
    this.w2p.copy(m).invert()

    const flick = 0.92 + 0.08 * Math.sin(t * 31.0) * Math.sin(t * 17.3)
    for (const L of this.lights) {
      const x = L.userData.x as number
      const p = new THREE.Vector3(x, 0, 0).applyMatrix4(m)
      L.position.copy(p)
      L.parent?.worldToLocal(L.position)
      const base = x < 2 ? 2.6 : 3.6 * (1 - s.vac * 0.6)
      L.intensity = base * s.int * s.on * flick * (0.6 + 0.4 * s.str)
    }
  }

  setCamera(cam: THREE.PerspectiveCamera, depth: THREE.Texture, w: number, h: number) {
    const u = this.material.uniforms
    u.uDepth.value = depth
    u.uRes.value.set(w, h)
    u.uNear.value = cam.near
    u.uFar.value = cam.far
    cam.getWorldDirection(u.uCamFwd.value)
  }
}
