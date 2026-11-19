/**
 * Room geometry from a metric depth map: planes, wall corners, camera and perspective guides.
 *
 * Key fact used throughout: for a pinhole camera a 3D plane is exactly LINEAR in inverse depth,
 *   1/Z = a·x + b·y + g      (x, y = pixel coordinates relative to the image centre)
 * whatever the focal length. So planes are fitted with ordinary least squares on 1/Z, walls are
 * split where that linear model changes, and the focal length is the one value that makes the
 * fitted floor / walls mutually perpendicular.
 */
import { median, type P2 } from './imageops'

export type V3 = [number, number, number]
/** inverse-depth plane: 1/Z = a·x + b·y + g (centred full-resolution pixel coordinates) */
export interface Plane {
  a: number
  b: number
  g: number
  /** number of supporting samples */
  n: number
  /** robust residual scale relative to the plane's typical inverse depth */
  err: number
}

export const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
export const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
export const norm = (p: V3): V3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1e-12
  return [p[0] / l, p[1] / l, p[2] / l]
}
export const add = (p: V3, q: V3, k = 1): V3 => [p[0] + k * q[0], p[1] + k * q[1], p[2] + k * q[2]]

/** Solve the 3x3 system M·p = v (Cramer). */
function solve3(m: number[], v: number[]): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-18) return null
  const x = (v[0] * (e * i - f * h) - b * (v[1] * i - f * v[2]) + c * (v[1] * h - e * v[2])) / det
  const y = (a * (v[1] * i - f * v[2]) - v[0] * (d * i - f * g) + c * (d * v[2] - v[1] * g)) / det
  const z = (a * (e * v[2] - v[1] * h) - b * (d * v[2] - v[1] * g) + v[0] * (d * h - e * g)) / det
  return [x, y, z]
}

/**
 * Robust plane fit (least squares, then re-fit on samples within 2.5 robust sigmas, repeated).
 * xs, ys: centred pixel coordinates; ds: inverse depth.
 */
export function fitPlane(xs: ArrayLike<number>, ys: ArrayLike<number>, ds: ArrayLike<number>): Plane | null {
  const n = xs.length
  if (n < 12) return null
  // scale coordinates for conditioning
  let sx = 1e-9
  for (let i = 0; i < n; i++) sx = Math.max(sx, Math.abs(xs[i]), Math.abs(ys[i]))
  let p: [number, number, number] | null = null
  let thr = Infinity
  let used = 0
  let sigma = 0
  for (let it = 0; it < 5; it++) {
    let sxx = 0, sxy = 0, sx1 = 0, syy = 0, sy1 = 0, s11 = 0, sxd = 0, syd = 0, sd = 0
    for (let i = 0; i < n; i++) {
      const x = xs[i] / sx
      const y = ys[i] / sx
      const d = ds[i]
      if (p && Math.abs(d - (p[0] * x + p[1] * y + p[2])) > thr) continue
      sxx += x * x
      sxy += x * y
      sx1 += x
      syy += y * y
      sy1 += y
      s11 += 1
      sxd += x * d
      syd += y * d
      sd += d
    }
    if (s11 < 12) break
    const q = solve3([sxx, sxy, sx1, sxy, syy, sy1, sx1, sy1, s11], [sxd, syd, sd])
    if (!q) break
    p = q
    used = s11
    const res = new Float64Array(n)
    for (let i = 0; i < n; i++) res[i] = Math.abs(ds[i] - (p[0] * (xs[i] / sx) + p[1] * (ys[i] / sx) + p[2]))
    sigma = median(res) * 1.4826
    thr = Math.max(2.5 * sigma, 1e-9)
  }
  if (!p) return null
  const md = median(Float64Array.from(ds as ArrayLike<number>)) || 1e-9
  return { a: p[0] / sx, b: p[1] / sx, g: p[2], n: used, err: sigma / Math.abs(md) }
}

/** Unit normal (pointing from the camera towards the plane) and distance for focal length f. */
export function planeNormal(p: Plane, f: number): { n: V3; d: number } {
  const N: V3 = [p.a * f, p.b * f, p.g]
  const l = Math.hypot(N[0], N[1], N[2]) || 1e-12
  return { n: [N[0] / l, N[1] / l, N[2] / l], d: 1 / l }
}

export interface Segment {
  /** first / last column index (inclusive) into the valid-column list */
  s: number
  e: number
}

/**
 * Split a 1D signal into the fewest straight pieces (segmented least squares, dynamic programming).
 * Used on the per-column wall depth profile: each straight piece is one wall, breaks are corners.
 * @param lambda cost of starting a new piece (same units as weighted squared error)
 */
export function segmentLinear(x: Float64Array, y: Float64Array, w: Float64Array, lambda: number, minLen: number): Segment[] {
  const n = x.length
  if (n === 0) return []
  // prefix sums for O(1) weighted line-fit error of any range
  const pre = (f: (i: number) => number) => {
    const a = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) a[i + 1] = a[i] + f(i)
    return a
  }
  const Sw = pre((i) => w[i])
  const Sx = pre((i) => w[i] * x[i])
  const Sy = pre((i) => w[i] * y[i])
  const Sxx = pre((i) => w[i] * x[i] * x[i])
  const Sxy = pre((i) => w[i] * x[i] * y[i])
  const Syy = pre((i) => w[i] * y[i] * y[i])
  const sse = (s: number, e: number) => {
    const sw = Sw[e + 1] - Sw[s]
    if (sw <= 0) return 0
    const sx = Sx[e + 1] - Sx[s]
    const sy = Sy[e + 1] - Sy[s]
    const sxx = Sxx[e + 1] - Sxx[s]
    const sxy = Sxy[e + 1] - Sxy[s]
    const syy = Syy[e + 1] - Syy[s]
    const vx = sxx - (sx * sx) / sw
    const cxy = sxy - (sx * sy) / sw
    const vy = syy - (sy * sy) / sw
    return Math.max(0, vx > 1e-12 ? vy - (cxy * cxy) / vx : vy)
  }
  const best = new Float64Array(n + 1).fill(Infinity)
  const from = new Int32Array(n + 1).fill(-1)
  best[0] = 0
  for (let e = 0; e < n; e++)
    for (let s = 0; s <= e; s++) {
      if (best[s] === Infinity) continue
      // pieces shorter than minLen are only allowed when the whole signal is that short
      if (e - s + 1 < minLen && !(s === 0 && e === n - 1)) continue
      const c = best[s] + sse(s, e) + lambda
      if (c < best[e + 1]) {
        best[e + 1] = c
        from[e + 1] = s
      }
    }
  const out: Segment[] = []
  let e = n
  if (from[e] < 0) return [{ s: 0, e: n - 1 }]
  while (e > 0) {
    const s = from[e]
    out.unshift({ s, e: e - 1 })
    e = s
  }
  return out
}

export interface Camera {
  f: number
  /** unit vector pointing up in camera coordinates (x right, y down, z forward) */
  up: V3
}

/**
 * Focal length that makes the fitted planes mutually perpendicular (floor ⟂ walls, adjacent
 * walls ⟂ each other), with a weak prior towards an ordinary field of view.
 */
export function estimateFocal(pairs: { p: Plane; q: Plane; w: number }[], longSide: number): number {
  const f0 = 0.8 * longSide
  let bestF = f0
  let bestC = Infinity
  for (let k = 0; k <= 80; k++) {
    // horizontal field of view from 28° to 110°
    const fov = ((28 + (82 * k) / 80) * Math.PI) / 180
    const f = longSide / 2 / Math.tan(fov / 2)
    let c = 0.03 * Math.log(f / f0) ** 2
    for (const { p, q, w } of pairs) {
      const cs = dot(planeNormal(p, f).n, planeNormal(q, f).n)
      c += w * cs * cs
    }
    if (c < bestC) {
      bestC = c
      bestF = f
    }
  }
  return bestF
}

/** Project a camera-space point to centred pixel coordinates. */
export const project = (X: V3, f: number): P2 => [(f * X[0]) / X[2], (f * X[1]) / X[2]]

/** Intersect the viewing ray of centred pixel (x, y) with the plane n·X = d. */
export function backProject(x: number, y: number, f: number, n: V3, d: number): V3 {
  const r: V3 = [x / f, y / f, 1]
  const t = d / (dot(n, r) || 1e-12)
  return [r[0] * t, r[1] * t, r[2] * t]
}

/**
 * Perspective guide for a plane: the image of a real square of side `side` (model units) lying on
 * the plane around the 3D point under pixel c, ordered TL, TR, BR, BL as seen in the photo.
 * `along` is the preferred in-plane direction for the square's horizontal edge.
 */
export function guideQuad(n: V3, d: number, f: number, c: P2, along: V3, side: number): { quad: P2[]; side: number } | null {
  const X0 = backProject(c[0], c[1], f, n, d)
  if (!(X0[2] > 0)) return null
  // in-plane orthonormal axes
  let a1 = norm(add(along, n, -dot(along, n)))
  if (!isFinite(a1[0]) || Math.hypot(...add(along, n, -dot(along, n))) < 1e-6) a1 = norm(cross(n, [0, 0, 1]))
  let a2 = norm(cross(n, a1))
  const p0 = project(X0, f)
  const dir = (a: V3): P2 => {
    const q = project(add(X0, a, 0.05 * X0[2]), f)
    return [q[0] - p0[0], q[1] - p0[1]]
  }
  // u = the axis that looks more horizontal in the photo, pointing right; v = the other, pointing down
  let d1 = dir(a1)
  let d2 = dir(a2)
  const horiz = (v: P2) => Math.abs(v[0]) / (Math.hypot(v[0], v[1]) || 1e-9)
  if (horiz(d2) > horiz(d1)) {
    ;[a1, a2] = [a2, a1]
    ;[d1, d2] = [d2, d1]
  }
  const u: V3 = d1[0] >= 0 ? a1 : [-a1[0], -a1[1], -a1[2]]
  const v: V3 = d2[1] >= 0 ? a2 : [-a2[0], -a2[1], -a2[2]]
  let s = side
  for (let it = 0; it < 8; it++) {
    const corners: V3[] = [
      add(add(X0, u, -s / 2), v, -s / 2),
      add(add(X0, u, s / 2), v, -s / 2),
      add(add(X0, u, s / 2), v, s / 2),
      add(add(X0, u, -s / 2), v, s / 2),
    ]
    // every corner well in front of the camera, otherwise use a smaller square
    if (corners.every((X) => X[2] > 0.25 * X0[2])) return { quad: corners.map((X) => project(X, f)), side: s }
    s /= 2
  }
  return null
}
