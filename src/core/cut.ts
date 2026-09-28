import * as THREE from 'three'

/**
 * A section cut through an assembly.
 *
 * Every part that belongs to the assembly is a closed solid rendered double
 * sided with the same clipping plane. Where the plane opens a solid, the camera
 * looks at that solid's back faces; the shader recognises those fragments,
 * shades them as the flat cut face and writes the depth of the plane itself.
 * The result reads as a machined section of solid metal without building any
 * cap geometry, for any cut position, so the cut can sweep in live.
 */
export class CutState {
  /** Plane in the owner's local frame. Kept side is z < d. */
  readonly local = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10)
  readonly world = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10)
  /** Second plane for a wedge cut: only what lies beyond both planes is removed. */
  readonly local2 = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10)
  readonly world2 = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10)
  readonly planes: THREE.Plane[] = [this.world]
  readonly uPlane = { value: new THREE.Vector4(0, 0, -1, 10) }
  /** Disabled (removes everywhere, so the intersection is just the first plane) unless this is a wedge. */
  readonly uPlane2 = { value: new THREE.Vector4(0, 0, 0, -1) }
  /** Half angle of the wedge in radians around the owner's Y axis, centred on +Z. 0 = a straight cut. */
  wedge = 0
  readonly uGlow = { value: 0 }
  /** 0 = whole, 1 = cut to the section plane. */
  amount = 0
  /**
   * Materials that follow this cut. While the assembly is whole they render
   * single sided with no depth writes from the fragment shader (so early depth
   * rejection works); only while it is open do they switch to the cap shader.
   */
  readonly materials = new Set<THREE.Material>()
  /** Meshes drawn with a front pass and, while cut, an extra back face pass for the caps. */
  readonly meshes = new Set<THREE.Mesh>()
  capsOn = true

  /** Register every mesh below root that uses one of this cut's surface materials. */
  collect(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || Array.isArray(m.material) || m.userData.fluid) return
      if (this.materials.has(m.material) && m.material.type !== 'ShaderMaterial') this.meshes.add(m)
    })
    const on = this.capsOn
    this.capsOn = !on
    this.setCaps(on)
  }

  setCaps(on: boolean) {
    if (on === this.capsOn) return
    this.capsOn = on
    for (const m of this.materials) {
      if (m.type !== 'ShaderMaterial') continue
      const sm = m as THREE.ShaderMaterial
      if (on) sm.defines.CAPS = 1
      else delete sm.defines.CAPS
      m.userData.caps = on
      m.needsUpdate = true
    }
    for (const mesh of this.meshes) {
      const front = (mesh.userData.front ?? mesh.material) as THREE.Material
      mesh.userData.front = front
      const g = mesh.geometry
      if (on) {
        const make = front.userData.makeBack as (() => THREE.Material) | undefined
        if (!make) continue
        front.userData.back ??= make()
        const count = g.index ? g.index.count : g.attributes.position.count
        g.clearGroups()
        g.addGroup(0, count, 0)
        g.addGroup(0, count, 1)
        mesh.material = [front, front.userData.back]
      } else {
        g.clearGroups()
        mesh.material = front
      }
    }
  }

  constructor(public owner: THREE.Object3D, public extent: number, public depth = 0, wedge = 0) {
    this.wedge = wedge
    if (wedge > 0) this.planes.push(this.world2)
  }

  /** Materials clip with both planes and keep anything outside the wedge. */
  get intersect() {
    return this.wedge > 0
  }

  update() {
    const a = this.amount
    this.setCaps(a > 0.0005)
    const e = a <= 0 ? 1e4 : this.depth + (this.extent - this.depth) * (1 - a)
    this.owner.updateWorldMatrix(true, false)
    if (this.wedge > 0) {
      const c = Math.cos(this.wedge), s = Math.sin(this.wedge)
      this.local.normal.set(c, 0, -s)
      this.local2.normal.set(-c, 0, -s)
      this.local.constant = e
      this.local2.constant = e
      this.world2.copy(this.local2).applyMatrix4(this.owner.matrixWorld)
      this.uPlane2.value.set(this.world2.normal.x, this.world2.normal.y, this.world2.normal.z, this.world2.constant)
    } else this.local.normal.set(0, 0, -1)
    if (this.wedge <= 0) this.local.constant = e
    this.world.copy(this.local).applyMatrix4(this.owner.matrixWorld)
    this.uPlane.value.set(this.world.normal.x, this.world.normal.y, this.world.normal.z, this.world.constant)
    // A thin glowing line rides the edge while the cut is moving.
    this.uGlow.value = a > 0.002 && a < 0.998 ? Math.sin(Math.PI * a) : 0
  }
}

/** Shared projection matrix for writing the cap depth. Set before every render. */
export const CUT_PROJ = { value: new THREE.Matrix4() }

/** Plane used by parts that are never cut (keeps shader permutations shared). */
export const NO_CUT = { uPlane: { value: new THREE.Vector4(0, 0, -1, 1e4) }, uPlane2: { value: new THREE.Vector4(0, 0, 0, -1) }, uGlow: { value: 0 } }

export const GLSL_CUT_VERT_PARS = /* glsl */ `
uniform vec4 uCutPlane;
uniform vec4 uCutPlane2;
varying vec3 vObj;
varying vec3 vCutObjCam;
varying vec4 vCutPlaneObj;
varying vec4 vCutPlane2Obj;
`

export const GLSL_CUT_VERT = /* glsl */ `
{
  vec4 cutP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    cutP = batchingMatrix * cutP;
  #endif
  #ifdef USE_INSTANCING
    cutP = instanceMatrix * cutP;
  #endif
  vObj = cutP.xyz;
  vCutObjCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vCutPlaneObj = uCutPlane * modelMatrix;
  vCutPlane2Obj = uCutPlane2 * modelMatrix;
}
`

export const GLSL_CUT_FRAG_PARS = /* glsl */ `
uniform vec4 uCutPlane;
uniform vec4 uCutPlane2;
uniform mat4 uCutProj;
uniform float uCutGlow;
varying vec3 vObj;
varying vec3 vCutObjCam;
varying vec4 vCutPlaneObj;
varying vec4 vCutPlane2Obj;
// the removed region is where both planes are negative; clip a ray to it
void cutClip(vec4 P, vec3 ro, vec3 rd, inout float t0, inout float t1, inout int exitId, int id) {
  float dn = dot(P.xyz, rd);
  float d0 = dot(P.xyz, ro) + P.w;
  if (abs(dn) < 1e-9) { if (d0 >= 0.0) { t0 = 1.0; t1 = 0.0; } return; }
  float th = -d0 / dn;
  if (dn > 0.0) { if (th < t1) { t1 = th; exitId = id; } }
  else t0 = max(t0, th);
}
bool cutRemoved(vec3 p) {
  return dot(vCutPlaneObj.xyz, p) + vCutPlaneObj.w < 0.0 && dot(vCutPlane2Obj.xyz, p) + vCutPlane2Obj.w < 0.0;
}
`

/**
 * Sets cutCap and cutHit (object space point on the plane). A back face counts
 * as a cap when the plane lies between the camera and it; drawn at its natural
 * depth, ordinary depth testing then keeps only back faces that no front face
 * hides, which are exactly the faces where the plane opens a solid.
 */
export const GLSL_CUT_FRAG = /* glsl */ `
bool cutCap = false;
vec3 cutHit = vObj;
vec3 cutNW = uCutPlane.xyz;
#ifdef CAPS
{
  #ifdef FLIP_SIDED
    bool cutBack = gl_FrontFacing;
  #else
    bool cutBack = !gl_FrontFacing;
  #endif
  if (cutBack) {
    vec3 ro = vCutObjCam;
    vec3 toF = vObj - ro;
    float tf = length(toF);
    vec3 rd = toF / max(tf, 1e-6);
    float t0 = 0.0, t1 = 1e9;
    int exitId = -1;
    cutClip(vCutPlaneObj, ro, rd, t0, t1, exitId, 0);
    cutClip(vCutPlane2Obj, ro, rd, t0, t1, exitId, 1);
    if (exitId >= 0 && t0 < t1 && t1 > 0.0 && t1 < tf) {
      cutCap = true;
      cutHit = ro + rd * t1;
      if (exitId == 1) cutNW = uCutPlane2.xyz;
    }
  }
}
#endif
`
