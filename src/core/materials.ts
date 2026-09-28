import * as THREE from 'three'
import { CutState, CUT_PROJ, NO_CUT, GLSL_CUT_FRAG, GLSL_CUT_FRAG_PARS, GLSL_CUT_VERT, GLSL_CUT_VERT_PARS } from './cut'
import { GLSL_NOISE, NOISE3D } from './noise'

export interface SurfOpts {
  color: number | string
  metalness?: number
  roughness?: number
  /** World scale of the detail noise (cycles per object unit). */
  detail?: number
  roughVar?: number
  colorVar?: number
  bump?: number
  /** 3D printed layer lines along the object Y axis: [frequency, height]. */
  layers?: [number, number]
  /** Brushed / turned finish. */
  anisotropy?: number
  anisotropyRotation?: number
  clearcoat?: number
  clearcoatRoughness?: number
  /** Heat tint along object Y: colours from y0 to y1. */
  tint?: { y0: number; y1: number; a: number | string; b: number | string; c: number | string; strength: number }
  /** Regen channel ribbing around the Y axis: [count, depth]. */
  ribs?: [number, number]
  /** Vertical streaks (soot and drips), strength. */
  streaks?: number
  emissive?: number | string
  emissiveIntensity?: number
  envMapIntensity?: number
  cut?: CutState | null
  capColor?: number | string
  capRoughness?: number
  capMetalness?: number
  side?: THREE.Side
  transparent?: boolean
  opacity?: number
  sheen?: number
  sheenColor?: number | string
  flatShading?: boolean
  vertexColors?: boolean
  map?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  name?: string
  /** internal: build the back face cap pass of a cut material */
  capPass?: boolean
}

const GLSL_BUMP = /* glsl */ `
vec3 surfPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`

/**
 * PBR surface with procedural wear (roughness breakup, colour variation,
 * micro bump, print layers, heat tint) and optional section cut.
 */
export function surf(o: SurfOpts): THREE.MeshStandardMaterial {
  const physical = (o.clearcoat ?? 0) > 0 || (o.sheen ?? 0) > 0 || (o.anisotropy ?? 0) > 0
  const base = {
    color: new THREE.Color(o.color as THREE.ColorRepresentation),
    metalness: o.metalness ?? 1,
    roughness: o.roughness ?? 0.4,
    envMapIntensity: o.envMapIntensity ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    flatShading: o.flatShading ?? false,
    vertexColors: o.vertexColors ?? false,
    map: o.map ?? null,
    roughnessMap: o.roughnessMap ?? null,
  }
  const m: THREE.MeshStandardMaterial = physical ? new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(o.color as THREE.ColorRepresentation),
    metalness: o.metalness ?? 1,
    roughness: o.roughness ?? 0.4,
    envMapIntensity: o.envMapIntensity ?? 1,
    clearcoat: o.clearcoat ?? 0,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.1,
    anisotropy: o.anisotropy ?? 0,
    anisotropyRotation: o.anisotropyRotation ?? 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    flatShading: o.flatShading ?? false,
    vertexColors: o.vertexColors ?? false,
    map: o.map ?? null,
    roughnessMap: o.roughnessMap ?? null,
    sheen: o.sheen ?? 0,
    sheenColor: new THREE.Color((o.sheenColor ?? 0xffffff) as THREE.ColorRepresentation),
  }) : new THREE.MeshStandardMaterial(base)
  if (o.name) m.name = o.name
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive as THREE.ColorRepresentation)
    m.emissiveIntensity = o.emissiveIntensity ?? 1
  }
  const cut = o.cut ?? null
  const capPass = !!o.capPass
  if (cut) {
    // front faces always draw single sided with early depth rejection; the cut
    // faces come from a separate back face pass that discards everything else
    m.side = capPass ? THREE.BackSide : THREE.FrontSide
    m.userData.caps = capPass
    m.clippingPlanes = cut.planes
    m.clipIntersection = cut.intersect
    m.clipShadows = true
    if (!capPass) {
      cut.materials.add(m)
      m.userData.makeBack = () => surf({ ...o, capPass: true, name: (o.name ?? 'surf') + ':caps' })
    }
  } else if (o.side !== undefined) m.side = o.side

  const detail = o.detail ?? 0
  const u = {
    uCutPlane: cut ? cut.uPlane : NO_CUT.uPlane,
    uCutPlane2: cut ? cut.uPlane2 : NO_CUT.uPlane2,
    uCutGlow: cut ? cut.uGlow : NO_CUT.uGlow,
    uCutProj: CUT_PROJ,
    uCapColor: { value: new THREE.Color((o.capColor ?? 0xc9ccd1) as THREE.ColorRepresentation) },
    uCapRough: { value: o.capRoughness ?? 0.42 },
    uCapMetal: { value: o.capMetalness ?? 0.35 },
    uDetail: { value: new THREE.Vector4(detail, o.roughVar ?? 0.35, o.colorVar ?? 0.12, o.bump ?? 0) },
    uLayers: { value: new THREE.Vector2(o.layers?.[0] ?? 0, o.layers?.[1] ?? 0) },
    uRibs: { value: new THREE.Vector2(o.ribs?.[0] ?? 0, o.ribs?.[1] ?? 0) },
    uStreaks: { value: o.streaks ?? 0 },
    uTintA: { value: new THREE.Color((o.tint?.a ?? 0) as THREE.ColorRepresentation) },
    uTintB: { value: new THREE.Color((o.tint?.b ?? 0) as THREE.ColorRepresentation) },
    uTintC: { value: new THREE.Color((o.tint?.c ?? 0) as THREE.ColorRepresentation) },
    uTintRange: { value: new THREE.Vector3(o.tint?.y0 ?? 0, o.tint?.y1 ?? 1, o.tint?.strength ?? 0) },
    uNoise3D: NOISE3D,
  }
  m.userData.u = u
  const defs: string[] = []
  if (cut) defs.push('#define SURF_CUT')
  if (detail > 0) defs.push('#define SURF_DETAIL')
  if (o.tint) defs.push('#define SURF_TINT')
  if ((o.streaks ?? 0) > 0) defs.push('#define SURF_STREAKS')
  if ((o.bump ?? 0) > 0 || (o.layers?.[1] ?? 0) > 0 || (o.ribs?.[1] ?? 0) > 0) defs.push('#define SURF_BUMP')
  const defStr = defs.join('\n') + '\n'

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    const capsDef = capPass ? '#define CAPS\n#define CAP_ONLY\n' : ''
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_CUT_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${GLSL_CUT_VERT}`)

    let f = shader.fragmentShader
    f = f.replace(
      '#include <common>',
      `${defStr}${capsDef}#include <common>
${GLSL_CUT_FRAG_PARS}
${GLSL_NOISE}
${GLSL_BUMP}
uniform vec3 uCapColor; uniform float uCapRough; uniform float uCapMetal;
uniform vec4 uDetail; uniform vec2 uLayers; uniform vec2 uRibs; uniform float uStreaks;
uniform vec3 uTintA; uniform vec3 uTintB; uniform vec3 uTintC; uniform vec3 uTintRange;
`,
    )
    f = f.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
#ifdef SURF_CUT
${GLSL_CUT_FRAG}
#ifdef CAP_ONLY
if (!cutCap) discard;
#endif
#else
bool cutCap = false; vec3 cutHit = vObj; vec3 cutNW = uCutPlane.xyz;
#endif
float surfN1 = 0.5, surfN2 = 0.5, surfH = 0.0;
#ifdef SURF_DETAIL
{
  vec3 dp = vObj * uDetail.x;
  surfN1 = fbm2(dp);
  surfN2 = n3(dp * 3.3 + vec3(7.3, 1.1, 3.7));
  surfH = (surfN1 - 0.5) * uDetail.w;
  #ifdef SURF_STREAKS
    float st = n3(vec3(vObj.x * uDetail.x * 2.2, vObj.y * uDetail.x * 0.18, vObj.z * uDetail.x * 2.2));
    surfN1 = mix(surfN1, st, 0.55);
  #endif
}
#endif
if (uLayers.y > 0.0) surfH += sin(vObj.y * uLayers.x) * uLayers.y;
if (uRibs.y > 0.0) surfH += smoothstep(-0.2, 0.9, sin(atan(vObj.z, vObj.x) * uRibs.x)) * uRibs.y;
`,
    )
    f = f.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
#ifdef SURF_DETAIL
  diffuseColor.rgb *= 1.0 + (surfN1 - 0.5) * uDetail.z * 2.0;
#endif
#ifdef SURF_TINT
{
  float ty = clamp((vObj.y - uTintRange.x) / (uTintRange.y - uTintRange.x), 0.0, 1.0);
  ty = clamp(ty + (surfN2 - 0.5) * 0.18, 0.0, 1.0);
  vec3 tc = ty < 0.5 ? mix(uTintA, uTintB, ty * 2.0) : mix(uTintB, uTintC, ty * 2.0 - 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, tc, uTintRange.z);
}
#endif
#ifdef SURF_STREAKS
  diffuseColor.rgb *= 1.0 - uStreaks * smoothstep(0.45, 0.8, surfN1);
#endif
if (cutCap) diffuseColor.rgb = uCapColor;
`,
    )
    f = f.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
#ifdef SURF_DETAIL
  roughnessFactor = clamp(roughnessFactor * (1.0 + (surfN2 - 0.5) * uDetail.y * 2.0), 0.03, 1.0);
#endif
if (cutCap) {
  roughnessFactor = uCapRough + (n3(cutHit * 9.0) - 0.5) * 0.08;
  metalnessFactor = uCapMetal;
}
`,
    )
    f = f.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
#ifdef SURF_BUMP
  if (!cutCap) normal = surfPerturb(-vViewPosition, normal, vec2(dFdx(surfH), dFdy(surfH)), faceDirection);
#endif
{
  // specular anti-aliasing: widen the lobe where the normal changes quickly across a pixel
  vec3 dn = fwidth(normal);
  float variance = dot(dn, dn);
  roughnessFactor = sqrt(clamp(roughnessFactor * roughnessFactor + min(variance * 0.6, 0.16), 0.0, 1.0));
}
if (cutCap) {
  normal = normalize((viewMatrix * vec4(-cutNW, 0.0)).xyz);
  nonPerturbedNormal = normal;
}
`,
    )
    f = f.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined(SURF_CUT) && !defined(CAP_ONLY)
if (uCutGlow > 0.0) {
  float cdw = dot(vCutPlaneObj.xyz, vObj) + vCutPlaneObj.w;
  float cdw2 = dot(vCutPlane2Obj.xyz, vObj) + vCutPlane2Obj.w;
  float cde = uCutPlane2.w < 0.0 && dot(uCutPlane2.xyz, uCutPlane2.xyz) < 0.5 ? abs(cdw) : max(cdw, cdw2) < 0.0 ? 1.0 : min(abs(cdw), abs(cdw2));
  totalEmissiveRadiance += vec3(0.45, 0.85, 1.0) * exp(-cde * 900.0) * uCutGlow * 14.0;
}
#endif
`,
    )
    shader.fragmentShader = f
  }
  m.customProgramCacheKey = () => 'surf|' + defStr + (capPass ? 'caps' : '')
  return m
}

/** A matte material for room surfaces (never cut, cheap). */
export function matte(color: number | string, roughness = 0.8, extra: Partial<SurfOpts> = {}) {
  return surf({ color, metalness: 0, roughness, detail: extra.detail ?? 0, ...extra })
}
