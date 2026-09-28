import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { GTAOShader, generateMagicSquareNoise } from 'three/addons/shaders/GTAOShader.js'
import { CUT_PROJ } from '../core/cut'
import { GLSL_NOISE, NOISE3D } from '../core/noise'
import { Plume } from '../engine/plume'

export const LAYER_OPAQUE = 0
export const LAYER_GAS = 1
export const LAYER_GLOW = 2

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const AO_BLUR = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform float uNear, uFar;
float lin(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
void main() {
  float d0 = lin(texture2D(tDepth, vUv).x);
  float sum = 0.0, wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float a = texture2D(tAO, uv).r;
    float d = lin(texture2D(tDepth, uv).x);
    float w = exp(-float(i * i) / 10.0) * exp(-abs(d - d0) / (0.02 * d0 + 0.002) * 1.5);
    sum += a * w; wsum += w;
  }
  gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
}
`

const AO_APPLY = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAO;
uniform float uStrength;
void main() {
  float a = texture2D(tAO, vUv).r;
  a = mix(1.0, a, uStrength);
  gl_FragColor = vec4(vec3(a), 1.0);
}
`

const COMPOSITE = /* glsl */ `
precision highp float;
${GLSL_NOISE}
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tPlume;
uniform float uTime;
uniform float uHaze;
uniform vec2 uTexel;
void main() {
  vec4 pl = texture2D(tPlume, vUv);
  float hz = pl.a;
  vec3 q = vec3(vUv * vec2(26.0, 15.0), uTime * 1.6);
  vec2 off = vec2(n3(q) - 0.5, n3(q + vec3(5.2, 1.3, 0.0)) - 0.5) * hz * uHaze;
  vec3 sc = texture2D(tScene, vUv + off).rgb;
  vec3 c = sc + pl.rgb;
  // never let a stray NaN or inf from a shader bleed through bloom and blur
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  gl_FragColor = vec4(min(c, vec3(512.0)), 1.0);
}
`

const BLOOM_PRE = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / (4.0 * uKnee + 1e-5);
  float w = max(rq, br - uThreshold) / max(br, 1e-5);
  return c * w;
}
void main() {
  vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 col = (a + b + c + d) * 0.25;
  col = min(col, vec3(64.0));
  gl_FragColor = vec4(prefilter(col), 1.0);
}
`

const BLOOM_DOWN = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec2 t = uTexel;
  vec3 A = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 B = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 C = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 D = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 E = texture2D(tSrc, vUv).rgb;
  vec3 F = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 G = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 H = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 I = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 J = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 K = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 L = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 M = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col = E * 0.125 + (A + C + G + I) * 0.03125 + (B + D + F + H) * 0.0625 + (J + K + L + M) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}
`

const BLOOM_UP = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb
    + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb * 2.0
    + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb
    + texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0
    + texture2D(tSrc, vUv).rgb * 4.0
    + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0
    + texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb
    + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0
    + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  s /= 16.0;
  gl_FragColor = vec4(s + texture2D(tPrev, vUv).rgb, 1.0);
}
`

const DOF = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxBlur;
uniform float uTaps;
float lin(float d) { return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
float coc(float z) { return clamp(abs(z - uFocus) / z * uAperture, 0.0, uMaxBlur); }
void main() {
  float z0 = lin(texture2D(tDepth, vUv).x);
  float c0 = coc(z0);
  vec3 base = texture2D(tSrc, vUv).rgb;
  if (c0 < 0.35) { gl_FragColor = vec4(base, 1.0); return; }
  vec3 acc = base;
  float wsum = 1.0;
  const float GA = 2.39996323;
  float r = 0.5;
  for (int i = 0; i < 40; i++) {
    if (float(i) >= uTaps) break;
    float fi = float(i) + 0.5;
    float rad = sqrt(fi / uTaps) * c0;
    vec2 o = vec2(cos(fi * GA), sin(fi * GA)) * rad * uTexel;
    float zs = lin(texture2D(tDepth, vUv + o).x);
    float cs = coc(zs);
    // do not let sharp foreground bleed onto the blurred background
    float w = zs < z0 ? smoothstep(rad - 1.0, rad + 1.0, cs) : 1.0;
    acc += texture2D(tSrc, vUv + o).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`

const FINAL = /* glsl */ `
precision highp float;
${GLSL_NOISE}
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform vec2 uRes;
uniform float uSharpen;
vec3 aces(vec3 x) {
  // ACES fitted (Stephen Hill)
  const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = i * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(o * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  vec2 ca = d * r2 * uCA;
  vec3 col;
  col.r = texture2D(tSrc, vUv - ca).r;
  col.g = texture2D(tSrc, vUv).g;
  col.b = texture2D(tSrc, vUv + ca).b;
  if (uSharpen > 0.0) {
    vec2 px = 1.0 / uRes;
    vec3 nb = texture2D(tSrc, vUv + vec2(px.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(px.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, px.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, px.y)).rgb;
    vec3 blur = nb * 0.25;
    vec3 d = col - blur;
    col = max(col + clamp(d, -0.35 * col - 0.02, 0.35 * col + 0.02) * uSharpen, 0.0);
  }
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  // gentle grade: cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.93, 0.98, 1.06), (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
  col = mix(col, col * vec3(1.04, 1.0, 0.95), smoothstep(0.55, 1.0, l) * 0.5);
  col *= 1.0 - uVignette * smoothstep(0.12, 0.9, r2 * 2.2);
  col = toSRGB(clamp(col, 0.0, 1.0));
  float g = hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5;
  col += g * uGrain;
  col += (hash12(gl_FragCoord.xy * 1.37 + 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`

export interface PipelineOpts {
  ao: boolean
  msaa: number
  aoSamples?: number
}

export class Pipeline {
  w = 1
  h = 1
  readonly quad = new FullScreenQuad()
  sceneRT!: THREE.WebGLRenderTarget
  aoRT!: THREE.WebGLRenderTarget
  aoTmp!: THREE.WebGLRenderTarget
  plumeRT!: THREE.WebGLRenderTarget
  hdrRT!: THREE.WebGLRenderTarget
  dofRT!: THREE.WebGLRenderTarget
  bloom: THREE.WebGLRenderTarget[] = []
  bloomUp: THREE.WebGLRenderTarget[] = []
  gtao: THREE.ShaderMaterial
  aoBlur: THREE.ShaderMaterial
  aoApply: THREE.ShaderMaterial
  composite: THREE.ShaderMaterial
  bloomPre: THREE.ShaderMaterial
  bloomDown: THREE.ShaderMaterial
  bloomUpM: THREE.ShaderMaterial
  dof: THREE.ShaderMaterial
  final: THREE.ShaderMaterial
  params = {
    exposure: 1.32,
    bloom: 0.06,
    bloomThreshold: 0.9,
    bloomRadius: 1.0,
    vignette: 0.55,
    grain: 0.018,
    ca: 0.005,
    haze: 0.012,
    ao: 0.85,
    aoRadius: 0.09,
    dofFocus: 2.5,
    dofAperture: 0.0,
    dofMax: 14,
    sharpen: 0,
    dofTaps: 24,
  }
  plumeScale = 0.5
  aoScale = 0.5
  shadowDirty = true
  aoEnabled: boolean
  msaa: number

  constructor(private renderer: THREE.WebGLRenderer, opts: PipelineOpts) {
    this.aoEnabled = opts.ao
    this.msaa = opts.msaa
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NoBlending, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
      new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, blending, depthTest: false, depthWrite: false, ...extra })
    this.gtao = new THREE.ShaderMaterial({
      defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0, SAMPLES: opts.aoSamples ?? 12 },
      uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
      vertexShader: GTAOShader.vertexShader,
      fragmentShader: GTAOShader.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.gtao.uniforms.tNoise.value = generateMagicSquareNoise()
    this.aoBlur = mk(AO_BLUR, { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 60 } })
    this.aoApply = mk(AO_APPLY, { tAO: { value: null }, uStrength: { value: 1 } }, THREE.CustomBlending, {
      blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, blendEquationAlpha: THREE.AddEquation,
    })
    this.composite = mk(COMPOSITE, { tScene: { value: null }, tPlume: { value: null }, uTime: { value: 0 }, uHaze: { value: 0 }, uTexel: { value: new THREE.Vector2() }, uNoise3D: NOISE3D })
    this.bloomPre = mk(BLOOM_PRE, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } })
    this.bloomDown = mk(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } })
    this.bloomUpM = mk(BLOOM_UP, { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } })
    this.dof = mk(DOF, { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 60 }, uFocus: { value: 2 }, uAperture: { value: 0 }, uMaxBlur: { value: 12 }, uTaps: { value: 24 } })
    this.final = mk(FINAL, {
      tSrc: { value: null }, tBloom: { value: null }, uBloom: { value: 0.05 }, uExposure: { value: 1 }, uTime: { value: 0 },
      uVignette: { value: 0.5 }, uGrain: { value: 0.02 }, uCA: { value: 0.01 }, uRes: { value: new THREE.Vector2() }, uSharpen: { value: 0 }, uNoise3D: NOISE3D,
    })
  }

  setSize(w: number, h: number) {
    this.w = w
    this.h = h
    const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }
    this.sceneRT?.dispose()
    const depth = new THREE.DepthTexture(w, h)
    depth.type = THREE.FloatType
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.msaa, depthTexture: depth, depthBuffer: true })
    this.sceneRT.texture.minFilter = THREE.LinearFilter
    const hw = Math.max(1, Math.round(w * this.aoScale)), hh = Math.max(1, Math.round(h * this.aoScale))
    for (const rt of [this.aoRT, this.aoTmp, this.plumeRT, this.hdrRT, this.dofRT]) rt?.dispose()
    this.aoRT = new THREE.WebGLRenderTarget(hw, hh, hf)
    this.aoTmp = new THREE.WebGLRenderTarget(hw, hh, hf)
    const pw = Math.max(1, Math.round(w * this.plumeScale)), ph = Math.max(1, Math.round(h * this.plumeScale))
    this.plumeRT = new THREE.WebGLRenderTarget(pw, ph, hf)
    this.hdrRT = new THREE.WebGLRenderTarget(w, h, hf)
    this.dofRT = new THREE.WebGLRenderTarget(w, h, hf)
    for (const rt of this.bloom) rt.dispose()
    for (const rt of this.bloomUp) rt.dispose()
    this.bloom = []
    this.bloomUp = []
    let bw = Math.max(1, Math.round(w / 2)), bh = Math.max(1, Math.round(h / 2))
    for (let i = 0; i < 7; i++) {
      this.bloom.push(new THREE.WebGLRenderTarget(bw, bh, hf))
      this.bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, hf))
      bw = Math.max(1, Math.round(bw / 2))
      bh = Math.max(1, Math.round(bh / 2))
    }
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.quad.render(this.renderer)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, plume: Plume | null, time: number) {
    const r = this.renderer
    const P = this.params
    CUT_PROJ.value.copy(camera.projectionMatrix)
    r.autoClear = false
    if (this.shadowDirty) { r.shadowMap.needsUpdate = true; this.shadowDirty = false }

    // 1. opaque surfaces
    r.setRenderTarget(this.sceneRT)
    r.setClearColor(0x000000, 1)
    r.clear(true, true, true)
    camera.layers.set(LAYER_OPAQUE)
    r.render(scene, camera)

    // 2. ambient occlusion from the resolved depth, multiplied into the colour
    if (this.aoEnabled && P.ao > 0) {
      const g = this.gtao.uniforms
      g.tDepth.value = this.sceneRT.depthTexture
      g.resolution.value.set(this.aoRT.width, this.aoRT.height)
      g.cameraNear.value = camera.near
      g.cameraFar.value = camera.far
      g.cameraProjectionMatrix.value.copy(camera.projectionMatrix)
      g.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse)
      g.cameraWorldMatrix.value.copy(camera.matrixWorld)
      g.radius.value = P.aoRadius
      g.distanceExponent.value = 1.6
      g.thickness.value = 1.0
      g.scale.value = 1.0
      this.pass(this.gtao, this.aoRT)
      const b = this.aoBlur.uniforms
      b.tDepth.value = this.sceneRT.depthTexture
      b.uNear.value = camera.near
      b.uFar.value = camera.far
      b.tAO.value = this.aoRT.texture
      b.uDir.value.set(1 / this.aoRT.width, 0)
      this.pass(this.aoBlur, this.aoTmp)
      b.tAO.value = this.aoTmp.texture
      b.uDir.value.set(0, 1 / this.aoRT.height)
      this.pass(this.aoBlur, this.aoRT)
      this.aoApply.uniforms.tAO.value = this.aoRT.texture
      this.aoApply.uniforms.uStrength.value = P.ao
      this.pass(this.aoApply, this.sceneRT)
    }

    // 3. emissive liquids, gases and glows on top of the occluded colour
    r.setRenderTarget(this.sceneRT)
    camera.layers.disableAll()
    camera.layers.enable(LAYER_GAS)
    camera.layers.enable(LAYER_GLOW)
    r.render(scene, camera)
    camera.layers.set(LAYER_OPAQUE)

    // 4. plume at reduced resolution, depth aware
    r.setRenderTarget(this.plumeRT)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    if (plume) {
      plume.setCamera(camera, this.sceneRT.depthTexture!, this.plumeRT.width, this.plumeRT.height)
      r.render(plume.scene, camera)
    }

    // 5. composite scene + plume + heat haze
    const c = this.composite.uniforms
    c.tScene.value = this.sceneRT.texture
    c.tPlume.value = this.plumeRT.texture
    c.uTime.value = time
    c.uHaze.value = P.haze
    this.pass(this.composite, this.hdrRT)

    let src = this.hdrRT
    // 6. depth of field
    if (P.dofAperture > 0.001) {
      const d = this.dof.uniforms
      d.tSrc.value = this.hdrRT.texture
      d.tDepth.value = this.sceneRT.depthTexture
      d.uTexel.value.set(1 / this.w, 1 / this.h)
      d.uNear.value = camera.near
      d.uFar.value = camera.far
      d.uFocus.value = P.dofFocus
      d.uAperture.value = P.dofAperture * (this.h / 1080)
      d.uMaxBlur.value = P.dofMax * (this.h / 1080)
      d.uTaps.value = P.dofTaps
      this.pass(this.dof, this.dofRT)
      src = this.dofRT
    }

    // 7. bloom
    const bp = this.bloomPre.uniforms
    bp.tSrc.value = src.texture
    bp.uTexel.value.set(0.5 / this.w, 0.5 / this.h)
    bp.uThreshold.value = P.bloomThreshold
    bp.uKnee.value = 0.6
    this.pass(this.bloomPre, this.bloom[0])
    for (let i = 1; i < this.bloom.length; i++) {
      const bd = this.bloomDown.uniforms
      bd.tSrc.value = this.bloom[i - 1].texture
      bd.uTexel.value.set(1 / this.bloom[i - 1].width, 1 / this.bloom[i - 1].height)
      this.pass(this.bloomDown, this.bloom[i])
    }
    const n = this.bloom.length
    // upsample chain: bloomUp[i] = up(bloomUp[i+1]) + bloom[i]
    let prev: THREE.WebGLRenderTarget = this.bloom[n - 1]
    for (let i = n - 2; i >= 0; i--) {
      const bu = this.bloomUpM.uniforms
      bu.tSrc.value = prev.texture
      bu.tPrev.value = this.bloom[i].texture
      bu.uTexel.value.set(1 / prev.width, 1 / prev.height)
      bu.uRadius.value = P.bloomRadius
      this.pass(this.bloomUpM, this.bloomUp[i])
      prev = this.bloomUp[i]
    }

    // 8. final
    const f = this.final.uniforms
    f.tSrc.value = src.texture
    f.tBloom.value = prev.texture
    f.uBloom.value = P.bloom
    f.uExposure.value = P.exposure
    f.uTime.value = time
    f.uVignette.value = P.vignette
    f.uGrain.value = P.grain
    f.uCA.value = P.ca
    f.uRes.value.set(this.w, this.h)
    f.uSharpen.value = P.sharpen
    this.pass(this.final, null)
  }
}
