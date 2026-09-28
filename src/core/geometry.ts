import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type P2 = [number, number]

function signedArea(p: P2[]) {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]
    const [x1, y1] = p[(i + 1) % p.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

/** Remove consecutive duplicate points (and a duplicated closing point). */
function clean(p: P2[]) {
  const out: P2[] = []
  for (const q of p) {
    const l = out[out.length - 1]
    if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-7) out.push([Math.max(0, q[0]), q[1]])
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-7) out.pop()
  return out
}

/**
 * Revolve a closed (r, y) profile around the Y axis into a watertight solid.
 * Normals are smoothed across profile corners flatter than `smoothDeg`.
 * UV: u runs around, v is the profile arc length (object units).
 */
export function revolve(profileIn: P2[], segs = 96, smoothDeg = 38): THREE.BufferGeometry {
  let p = clean(profileIn)
  if (signedArea(p) < 0) p = p.slice().reverse()
  const n = p.length
  const edgeN: P2[] = []
  const edgeLen: number[] = []
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n]
    const dr = b[0] - a[0], dy = b[1] - a[1]
    const l = Math.hypot(dr, dy) || 1
    edgeN.push([dy / l, -dr / l])
    edgeLen.push(l)
  }
  const cosLim = Math.cos((smoothDeg * Math.PI) / 180)
  const vN: (P2 | null)[] = []
  for (let i = 0; i < n; i++) {
    const nin = edgeN[(i - 1 + n) % n], nout = edgeN[i]
    const d = nin[0] * nout[0] + nin[1] * nout[1]
    if (d > cosLim) {
      const x = nin[0] + nout[0], y = nin[1] + nout[1]
      const l = Math.hypot(x, y) || 1
      vN.push([x / l, y / l])
    } else vN.push(null)
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  let vAcc = 0
  for (let e = 0; e < n; e++) {
    const a = p[e], b = p[(e + 1) % n]
    const na = vN[e] ?? edgeN[e]
    const nb = vN[(e + 1) % n] ?? edgeN[e]
    // Skip strips that are degenerate (both ends on the axis).
    if (a[0] < 1e-9 && b[0] < 1e-9) { vAcc += edgeLen[e]; continue }
    const base = pos.length / 3
    for (let s = 0; s <= segs; s++) {
      const t = (s / segs) * Math.PI * 2
      const sn = Math.sin(t), cs = Math.cos(t)
      pos.push(a[0] * sn, a[1], a[0] * cs)
      nor.push(na[0] * sn, na[1], na[0] * cs)
      uv.push(s / segs, vAcc)
      pos.push(b[0] * sn, b[1], b[0] * cs)
      nor.push(nb[0] * sn, nb[1], nb[0] * cs)
      uv.push(s / segs, vAcc + edgeLen[e])
    }
    for (let s = 0; s < segs; s++) {
      const a0 = base + s * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3
      idx.push(a0, a1, b0, b0, a1, b1)
    }
    vAcc += edgeLen[e]
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  fixWinding(g)
  return g
}

/** Sample a function r(y) into points from y0 to y1. */
export function sampleFn(f: (y: number) => number, y0: number, y1: number, n: number): P2[] {
  const out: P2[] = []
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n
    out.push([f(y), y])
  }
  return out
}

/** Closed wall profile between inner and outer radius functions over [y0, y1]. */
export function wall(inner: (y: number) => number, outer: (y: number) => number, y0: number, y1: number, n = 64): P2[] {
  const a = sampleFn(outer, y0, y1, n)
  const b = sampleFn(inner, y1, y0, n)
  return [...a, ...b]
}

/** Rectangle ring profile (for flanges, bands). */
export function ringProfile(r0: number, r1: number, y0: number, y1: number, bevel = 0): P2[] {
  if (bevel <= 0) return [[r0, y0], [r1, y0], [r1, y1], [r0, y1]]
  const b = Math.min(bevel, (r1 - r0) / 2, (y1 - y0) / 2)
  return [
    [r0, y0 + b], [r0 + b, y0], [r1 - b, y0], [r1, y0 + b],
    [r1, y1 - b], [r1 - b, y1], [r0 + b, y1], [r0, y1 - b],
  ]
}

/** Circle profile (for a torus built by revolve, with proper UVs). */
export function circleProfile(rc: number, yc: number, rad: number, n = 24): P2[] {
  const out: P2[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push([rc + Math.cos(t) * rad, yc + Math.sin(t) * rad])
  }
  return out
}

export interface PipeOpts {
  r: number | ((u: number) => number)
  ri?: number | ((u: number) => number)
  tubular?: number
  radial?: number
  /** Preferred frame normal (kept perpendicular to the path). */
  up?: THREE.Vector3
}

/**
 * Hollow (or solid) pipe along a curve, closed at both ends, so it can be cut.
 * Adds attribute `aS`: arc length from the start (object units).
 */
export function pipe(curve: THREE.Curve<THREE.Vector3>, o: PipeOpts): THREE.BufferGeometry {
  const T = o.tubular ?? 64, R = o.radial ?? 24
  const rF = typeof o.r === 'function' ? o.r : () => o.r as number
  const riF = o.ri === undefined ? () => 0 : typeof o.ri === 'function' ? o.ri : () => o.ri as number
  const len = curve.getLength()
  const up = (o.up ?? new THREE.Vector3(0, 0, 1)).clone().normalize()
  const P: THREE.Vector3[] = [], Tn: THREE.Vector3[] = [], N: THREE.Vector3[] = [], B: THREE.Vector3[] = []
  let prevN: THREE.Vector3 | null = null
  for (let i = 0; i <= T; i++) {
    const u = i / T
    const p = curve.getPointAt(u)
    const t = curve.getTangentAt(u).normalize()
    let nn = up.clone().sub(t.clone().multiplyScalar(up.dot(t)))
    if (nn.lengthSq() < 1e-6) {
      nn = prevN ? prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))) : new THREE.Vector3(1, 0, 0)
    }
    nn.normalize()
    if (prevN && nn.dot(prevN) < 0 && nn.lengthSq() > 0) {
      // keep the frame continuous
    }
    const b = new THREE.Vector3().crossVectors(t, nn).normalize()
    P.push(p); Tn.push(t); N.push(nn); B.push(b)
    prevN = nn
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], sA: number[] = [], idx: number[] = []
  const v = new THREE.Vector3(), d = new THREE.Vector3()
  const ring = (inner: boolean) => {
    const base = pos.length / 3
    for (let i = 0; i <= T; i++) {
      const u = i / T
      const r = inner ? riF(u) : rF(u)
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2
        d.copy(N[i]).multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a))
        v.copy(P[i]).addScaledVector(d, r)
        pos.push(v.x, v.y, v.z)
        const s = inner ? -1 : 1
        nor.push(d.x * s, d.y * s, d.z * s)
        uv.push(j / R, u * len)
        sA.push(u * len)
      }
    }
    for (let i = 0; i < T; i++)
      for (let j = 0; j < R; j++) {
        const a = base + i * (R + 1) + j
        const b = a + R + 1
        if (inner) idx.push(a, a + 1, b, b, a + 1, b + 1)
        else idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
  }
  ring(false)
  const hollow = riF(0) > 0 || riF(1) > 0
  if (hollow) ring(true)
  // End caps (annulus or disc).
  for (const end of [0, T]) {
    const u = end / T
    const r0 = hollow ? riF(u) : 0, r1 = rF(u)
    const nrm = Tn[end].clone().multiplyScalar(end === 0 ? -1 : 1)
    const base = pos.length / 3
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2
      d.copy(N[end]).multiplyScalar(Math.cos(a)).addScaledVector(B[end], Math.sin(a))
      for (const rr of [r0, r1]) {
        v.copy(P[end]).addScaledVector(d, rr)
        pos.push(v.x, v.y, v.z)
        nor.push(nrm.x, nrm.y, nrm.z)
        uv.push(j / R, rr)
        sA.push(u * len)
      }
    }
    for (let j = 0; j < R; j++) {
      const a = base + j * 2
      if (end === 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sA, 1))
  g.setIndex(idx)
  // Fix winding of caps against their intended normals.
  fixWinding(g)
  return g
}

/** Ensure every triangle winds so its geometric normal agrees with the vertex normals. */
export function fixWinding(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute
  const nA = g.attributes.normal as THREE.BufferAttribute
  const index = g.index!
  const ia = index.array as unknown as number[]
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), gn = new THREE.Vector3()
  for (let i = 0; i < ia.length; i += 3) {
    a.fromBufferAttribute(p, ia[i]); b.fromBufferAttribute(p, ia[i + 1]); c.fromBufferAttribute(p, ia[i + 2])
    gn.subVectors(b, a).cross(c.clone().sub(a))
    if (gn.lengthSq() < 1e-20) continue
    nn.fromBufferAttribute(nA, ia[i]).add(new THREE.Vector3().fromBufferAttribute(nA, ia[i + 1])).add(new THREE.Vector3().fromBufferAttribute(nA, ia[i + 2]))
    if (gn.dot(nn) < 0) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t }
  }
  index.needsUpdate = true
}

/** Smooth curve through points (centripetal Catmull-Rom). */
export function path(pts: [number, number, number][], tension = 0.5) {
  return new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), false, 'catmullrom', tension)
}

/** Polyline with rounded corners (bend radius), good for tube routing. */
export function bentPath(pts: [number, number, number][], bend: number): THREE.CurvePath<THREE.Vector3> {
  const V = pts.map((q) => new THREE.Vector3(...q))
  const cp = new THREE.CurvePath<THREE.Vector3>()
  let cur = V[0].clone()
  for (let i = 1; i < V.length - 1; i++) {
    const p0 = V[i - 1], p1 = V[i], p2 = V[i + 1]
    const d0 = p1.clone().sub(p0), d1 = p2.clone().sub(p1)
    const l0 = d0.length(), l1 = d1.length()
    d0.normalize(); d1.normalize()
    const r = Math.min(bend, l0 * 0.45, l1 * 0.45)
    const a = p1.clone().addScaledVector(d0, -r)
    const b = p1.clone().addScaledVector(d1, r)
    if (a.distanceTo(cur) > 1e-6) cp.add(new THREE.LineCurve3(cur.clone(), a))
    cp.add(new THREE.QuadraticBezierCurve3(a, p1.clone(), b))
    cur = b
  }
  cp.add(new THREE.LineCurve3(cur, V[V.length - 1].clone()))
  return cp
}

/** Hex bolt head (closed). */
export function boltGeo(r = 1, h = 0.7) {
  const g = new THREE.CylinderGeometry(r, r, h, 6, 1, false)
  g.translate(0, h / 2, 0)
  return g
}

/** Place `count` instances around the Y axis at radius, height; returns matrices. */
export function ringMatrices(count: number, radius: number, y: number, phase = 0, tilt?: THREE.Euler, scale = 1) {
  const out: THREE.Matrix4[] = []
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0))
    if (tilt) q.multiply(new THREE.Quaternion().setFromEuler(tilt))
    m.compose(new THREE.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius), q, new THREE.Vector3(scale, scale, scale))
    out.push(m)
  }
  return out
}

export function merge(geos: THREE.BufferGeometry[]) {
  // Minimal merge for same-attribute geometries (position, normal, uv[, aS]).
  const names = ['position', 'normal', 'uv']
  const hasS = geos.every((g) => g.getAttribute('aS'))
  if (hasS) names.push('aS')
  const out = new THREE.BufferGeometry()
  let vcount = 0
  const idx: number[] = []
  const buffers: Record<string, number[]> = {}
  for (const n of names) buffers[n] = []
  for (const g of geos) {
    const gi = g.index ? (g.index.array as unknown as number[]) : [...Array(g.attributes.position.count).keys()]
    for (const i of gi) idx.push(i + vcount)
    for (const n of names) {
      const a = g.getAttribute(n) as THREE.BufferAttribute
      if (!a) {
        const size = n === 'uv' ? 2 : n === 'aS' ? 1 : 3
        for (let i = 0; i < g.attributes.position.count * size; i++) buffers[n].push(0)
      } else {
        const arr = a.array as unknown as number[]
        const dst = buffers[n]
        for (let i = 0; i < arr.length; i++) dst.push(arr[i])
      }
    }
    vcount += g.attributes.position.count
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(buffers.position, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normal, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uv, 2))
  if (hasS) out.setAttribute('aS', new THREE.Float32BufferAttribute(buffers.aS, 1))
  out.setIndex(idx)
  return out
}

/** Centripetal Catmull-Rom through 2D control points, sampled to n points per span. */
export function spline2(ctrl: P2[], n = 12): P2[] {
  const out: P2[] = []
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]]
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2]
    for (let k = 0; k < n; k++) {
      const t = k / n
      const t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(ctrl[ctrl.length - 1])
  return out
}

/** Interpolate r at y along a polyline sampled monotonically in y. */
export function rAt(poly: P2[], y: number) {
  let best = poly[0][0], bd = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1]
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1])
    if (y >= lo && y <= hi && hi > lo) {
      const t = (y - a[1]) / (b[1] - a[1])
      return a[0] + (b[0] - a[0]) * t
    }
    const d = Math.min(Math.abs(y - a[1]), Math.abs(y - b[1]))
    if (d < bd) { bd = d; best = Math.abs(y - a[1]) < Math.abs(y - b[1]) ? a[0] : b[0] }
  }
  return best
}

/** Thin helical blade (closed slab) for inducers. Outward winding. */
export function helixBlade(r0: number, r1: number, y0: number, y1: number, turns: number, th: number, phase = 0, seg = 72, radial = 6) {
  const pos: number[] = [], idx: number[] = []
  const at = (u: number, v: number, side: number): [number, number, number] => {
    const a = phase + u * turns * Math.PI * 2
    const r = r0 + (r1 - r0) * v
    const y = y0 + (y1 - y0) * u + side * th * 0.5
    return [Math.sin(a) * r, y, Math.cos(a) * r]
  }
  const W = radial + 1
  const S = (seg + 1) * W
  for (const side of [1, -1]) {
    for (let i = 0; i <= seg; i++) for (let j = 0; j <= radial; j++) pos.push(...at(i / seg, j / radial, side))
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * W + j, b = a + 1, c = a + W + 1, d = a + W
      quad(a, b, c, d) // top
      quad(S + a, S + d, S + c, S + b) // bottom
    }
  for (let i = 0; i < seg; i++) {
    const o0 = i * W + radial, o1 = (i + 1) * W + radial
    quad(o0, o1, S + o1, S + o0)
    const n0 = i * W, n1 = (i + 1) * W
    quad(n0, S + n0, S + n1, n1)
  }
  for (let j = 0; j < radial; j++) {
    quad(j, S + j, S + j + 1, j + 1)
    const e0 = seg * W + j, e1 = e0 + 1
    quad(e0, e1, S + e1, S + e0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const ng = g.toNonIndexed()
  ng.computeVertexNormals()
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2))
  return ng
}

/** Curved impeller blade (closed slab) between radii, sweeping by `sweep` radians, at height y. */
export function impellerBlade(r0: number, r1: number, yIn0: number, yIn1: number, yOut0: number, yOut1: number, sweep: number, th: number, phase = 0, seg = 16) {
  const pos: number[] = [], idx: number[] = []
  const W = 2
  const pt = (u: number, v: number, side: number): [number, number, number] => {
    const r = r0 + (r1 - r0) * u
    const a = phase + sweep * Math.pow(u, 1.3) + side * (th / Math.max(r, 1e-3)) * 0.5
    const y = (yIn0 + (yOut0 - yIn0) * u) + ((yIn1 + (yOut1 - yIn1) * u) - (yIn0 + (yOut0 - yIn0) * u)) * v
    return [Math.sin(a) * r, y, Math.cos(a) * r]
  }
  for (const side of [1, -1]) for (let i = 0; i <= seg; i++) for (let v = 0; v < W; v++) pos.push(...pt(i / seg, v, side))
  const S = (seg + 1) * W
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  for (let i = 0; i < seg; i++) {
    const a = i * W, b = a + 1, c = a + W + 1, d = a + W
    quad(a, b, c, d)
    quad(S + a, S + d, S + c, S + b)
    quad(a, d, S + d, S + a)
    quad(b, S + b, S + c, c)
  }
  quad(0, S, S + 1, 1)
  const e = seg * W
  quad(e, e + 1, S + e + 1, S + e)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const ng = g.toNonIndexed()
  ng.computeVertexNormals()
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2))
  return ng
}

/** Hollow torus split into two closed halves (so the cavity can be cut open). */
export function hollowTorus(rc: number, yc: number, rOut: number, rIn: number, n = 20): P2[][] {
  const lower: P2[] = [], upper: P2[] = []
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (Math.PI * i) / n // PI..2PI (bottom half), outer arc
    lower.push([rc + Math.cos(a) * rOut, yc + Math.sin(a) * rOut])
  }
  for (let i = n; i >= 0; i--) {
    const a = Math.PI + (Math.PI * i) / n
    lower.push([rc + Math.cos(a) * rIn, yc + Math.sin(a) * rIn])
  }
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * i) / n // 0..PI top half
    upper.push([rc + Math.cos(a) * rOut, yc + Math.sin(a) * rOut])
  }
  for (let i = n; i >= 0; i--) {
    const a = (Math.PI * i) / n
    upper.push([rc + Math.cos(a) * rIn, yc + Math.sin(a) * rIn])
  }
  return [lower, upper]
}

/** Ring with a circular cavity, as two closed halves split through the cavity centre. */
export function ringWithCavity(outer: P2[], cx: number, cy: number, cr: number, n = 16): P2[][] {
  // outer: closed CCW polygon of the ring cross-section that contains the circle.
  // Split by the horizontal line y = cy.
  const below: P2[] = [], above: P2[] = []
  const crossings: { i: number; p: P2 }[] = []
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length]
    if ((a[1] - cy) * (b[1] - cy) < 0) {
      const t = (cy - a[1]) / (b[1] - a[1])
      crossings.push({ i, p: [a[0] + (b[0] - a[0]) * t, cy] })
    }
  }
  if (crossings.length !== 2) return [outer]
  const [c0, c1] = crossings
  // walk the polygon, splitting into two chains
  const chainA: P2[] = [c0.p], chainB: P2[] = [c1.p]
  for (let k = c0.i + 1; ; k++) { const q = outer[k % outer.length]; chainA.push(q); if (k % outer.length === c1.i) break }
  chainA.push(c1.p)
  for (let k = c1.i + 1; ; k++) { const q = outer[k % outer.length]; chainB.push(q); if (k % outer.length === c0.i) break }
  chainB.push(c0.p)
  const semi = (fromAngle: number, toAngle: number) => {
    const pts: P2[] = []
    for (let i = 0; i <= n; i++) { const a = fromAngle + ((toAngle - fromAngle) * i) / n; pts.push([cx + Math.cos(a) * cr, cy + Math.sin(a) * cr]) }
    return pts
  }
  for (const ch of [chainA, chainB]) {
    const avgY = ch.reduce((s, p) => s + p[1], 0) / ch.length
    const end = ch[ch.length - 1], start = ch[0]
    // close the chain along y = cy, detouring around the cavity semicircle on this side
    const isBelow = avgY < cy
    const leftToRight = end[0] < start[0]
    let arc: P2[]
    if (isBelow) arc = leftToRight ? semi(Math.PI, 2 * Math.PI) : semi(2 * Math.PI, Math.PI)
    else arc = leftToRight ? semi(Math.PI, 0) : semi(0, Math.PI)
    const poly = [...ch, ...arc]
    ;(isBelow ? below : above).push(...poly)
  }
  return [below, above].filter((p) => p.length > 2)
}

/**
 * Spiral volute centre line around the Y axis. The cross-section grows from r0 at
 * the tongue to r1 over `sweep` of a turn while the inner edge stays at rBase, then
 * the passage leaves tangentially and bends toward `exitDir`.
 */
export class SpiralCurve extends THREE.Curve<THREE.Vector3> {
  readonly split = 0.8
  private exitA: THREE.Vector3
  private exitB: THREE.Vector3
  private exitC: THREE.Vector3
  constructor(
    public y: number,
    public rBase: number,
    public r0: number,
    public r1: number,
    public start = 0,
    public sweep = 0.94,
    public exitLen = 0.2,
    exitDir: THREE.Vector3 | null = null,
    public dir = 1,
  ) {
    super()
    const aE = this.start + this.dir * this.sweep * Math.PI * 2
    const R = this.rBase + this.r1
    this.exitA = new THREE.Vector3(Math.sin(aE) * R, this.y, Math.cos(aE) * R)
    const t = new THREE.Vector3(Math.cos(aE), 0, -Math.sin(aE)).multiplyScalar(this.dir)
    this.exitB = this.exitA.clone().addScaledVector(t, this.exitLen * 0.55)
    const d = exitDir ? exitDir.clone().normalize() : t
    this.exitC = this.exitB.clone().addScaledVector(d, this.exitLen * 0.6)
  }
  radiusAt(u: number) {
    const s = Math.min(u / this.split, 1)
    return this.r0 + (this.r1 - this.r0) * Math.pow(s, 0.85)
  }
  getPoint(u: number, target = new THREE.Vector3()) {
    if (u <= this.split) {
      const s = u / this.split
      const a = this.start + this.dir * s * this.sweep * Math.PI * 2
      const R = this.rBase + this.radiusAt(u)
      return target.set(Math.sin(a) * R, this.y, Math.cos(a) * R)
    }
    const k = (u - this.split) / (1 - this.split)
    const a = this.exitA, b = this.exitB, c = this.exitC
    return target.set(
      (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * b.x + k * k * c.x,
      (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * b.y + k * k * c.y,
      (1 - k) * (1 - k) * a.z + 2 * (1 - k) * k * b.z + k * k * c.z,
    )
  }
  exitPoint() { return this.exitC.clone() }
  exitTangent() { return this.exitC.clone().sub(this.exitB).normalize() }
}

/** Shell and fluid for a spiral volute. */
export function volute(c: SpiralCurve, wallT: number, tubular = 200, radial = 32) {
  const up = new THREE.Vector3(0, 1, 0)
  const shell = pipe(c, { r: (u) => c.radiusAt(u) + wallT, ri: (u) => c.radiusAt(u), tubular, radial, up })
  const fluid = pipe(c, { r: (u) => c.radiusAt(u) - 0.001, tubular, radial: Math.round(radial * 0.7), up })
  return { shell, fluid }
}

/** Flange ring (closed) centred at p, facing n. */
export function flangeAt(p: THREE.Vector3, n: THREE.Vector3, rIn: number, rOut: number, th: number) {
  const g = revolve(ringProfile(rIn, rOut, -th / 2, th / 2, Math.min(0.003, th / 4)), 48)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize())
  g.applyQuaternion(q)
  g.translate(p.x, p.y, p.z)
  return g
}

/** Bolt circle on a flange at p facing n. */
export function boltCircle(p: THREE.Vector3, n: THREE.Vector3, r: number, count: number, size: number) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize())
  const out: THREE.Matrix4[] = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const local = new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r).applyQuaternion(q)
    out.push(new THREE.Matrix4().compose(p.clone().add(local), q, new THREE.Vector3(size, size, size)))
  }
  return out
}

/**
 * Merge the static meshes directly under each group, one draw call per
 * material. Instanced meshes, fluids, skinned or flagged meshes stay as they are.
 * Transforms are baked, so object space for the merged mesh is the group's.
 */
export function mergeStatic(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false) {
  const groups: THREE.Object3D[] = []
  root.traverse((o) => { if (o.children.length) groups.push(o) })
  let before = 0, after = 0
  for (const g of groups) {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>()
    for (const c of g.children) {
      const m = c as THREE.Mesh
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.userData.fluid || keep(m) || m.children.length) continue
      if (!m.geometry.getAttribute('normal')) continue
      const list = buckets.get(m.material) ?? []
      list.push(m)
      buckets.set(m.material, list)
    }
    for (const [mat, list] of buckets) {
      before += list.length
      if (list.length < 2) { after += list.length; continue }
      const geos: THREE.BufferGeometry[] = []
      for (const m of list) {
        m.updateMatrix()
        let geo = m.geometry.clone()
        geo.applyMatrix4(m.matrix)
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name)
        if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2))
        if (!geo.index) {
          const n = geo.attributes.position.count
          const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n)
          for (let i = 0; i < n; i++) idx[i] = i
          geo.setIndex(new THREE.BufferAttribute(idx, 1))
        }
        geo.morphAttributes = {}
        geos.push(geo)
      }
      const merged = mergeGeometries(geos, false)
      if (!merged) { after += list.length; continue }
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = list.some((m) => m.castShadow)
      mesh.receiveShadow = list.some((m) => m.receiveShadow)
      mesh.layers.mask = list[0].layers.mask
      mesh.name = `${g.name || 'group'}:${(mat as THREE.Material).name || 'merged'}`
      for (const m of list) g.remove(m)
      g.add(mesh)
      after++
    }
  }
  return { before, after }
}
