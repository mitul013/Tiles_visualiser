/**
 * Automatic room detection: one photo in, tile-ready room out.
 *
 *   photo ──► semantic segmentation (wall / floor / ceiling / 147 object classes)
 *         ──► metric depth
 *         ──► planes (floor, ceiling, each wall), wall corners, camera
 *         ──► per surface: perspective guide + area outline
 *         ──► object layer (everything standing in front of the surfaces), edges snapped to the photo
 *
 * This is the same information the reference visualiser's backend returns for an uploaded room
 * (object mask, surface-id mask, planes fitted from vanishing geometry), produced with open models.
 * Pure TypeScript on typed arrays: runs in a browser worker and in Node.
 */
import { boxBlur, components, dropSmall, guidedFilterColor, median, morph, morphGray, resizeBilinear, simplify, toTensor, traceOuter, type P2 } from './imageops'
import { add, backProject, cross, dot, estimateFocal, fitPlane, guideQuad, norm, planeNormal, segmentLinear, type Plane, type V3 } from './geometry'

export type DetectedType = 'floor' | 'wall' | 'ceiling'

export interface DetectedSurface {
  type: DetectedType
  label: string
  /** perspective guide: image of a real rectangle on the surface (TL, TR, BR, BL), normalised 0..1 */
  quad: P2[]
  /** outline of the surface (normalised polygon; may run past the photo edge) */
  area: P2[]
  /** real size of the guide rectangle in metres */
  size: [number, number]
  /** share of the photo this surface visibly covers */
  cover: number
}

export interface DetectResult {
  width: number
  height: number
  surfaces: DetectedSurface[]
  /** object layer alpha (255 = object in front / not tileable), width*height */
  objAlpha: Uint8Array
  camera: { f: number; fovDeg: number; pitchDeg: number; scale: number }
  /** what each pixel is (ADE20K class id) at network resolution: lets the editor remove one whole
   *  object (a sofa) without touching the curtain it overlaps */
  classMap: Uint8Array
  classW: number
  classH: number
  /** class of every pixel: 0 object, 1 floor, 2 ceiling, 3+ walls (debug / tests) */
  labels: Uint8Array
  timings: Record<string, number>
}

export interface Tensor {
  data: Float32Array
  width: number
  height: number
}
export interface Models {
  /** input: normalised CHW RGB at (width, height) → logits [150, height/4, width/4] */
  segment(input: Float32Array, width: number, height: number): Promise<Tensor>
  /** input: normalised CHW RGB at (width, height) → metric depth in metres [height, width] */
  depth(input: Float32Array, width: number, height: number): Promise<Tensor>
}
export interface DetectOptions {
  /** long side fed to the segmentation network (default 768; 960 is a little more precise, slower) */
  segSize?: number
  /** long side fed to the depth network */
  depthSize?: number
  /**
   * long side of an optional second, sharper depth pass used only to catch very thin objects
   * (lamp stems, cables, chair legs). Costs one more network run; off (0) by default.
   */
  detailSize?: number
  /** treat rugs as floor (tile over them) instead of keeping them as objects */
  tileOverRugs?: boolean
  onProgress?: (stage: string, fraction: number) => void
  /** receives intermediate maps (tests / tuning) */
  debug?: (name: string, data: Float32Array | Uint8Array, width: number, height: number) => void
}

// ADE20K class ids
const C_WALL = 0
const C_FLOOR = [3, 11, 52] // floor, sidewalk/pavement, path
const C_CEILING = 5
const C_RUG = 28

/** Network input size: photo aspect kept, long side ~`long`, both sides multiples of 32. */
export function pickSegSize(W: number, H: number, long = 768): [number, number] {
  const k = long / Math.max(W, H)
  const r = (v: number) => Math.max(224, Math.round((v * k) / 32) * 32)
  return [r(W), r(H)]
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export async function detectRoom(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, models: Models, opts: DetectOptions = {}): Promise<DetectResult> {
  const W = img.width
  const H = img.height
  const N = W * H
  const progress = opts.onProgress ?? (() => {})
  const timings: Record<string, number> = {}
  let t0 = now()
  const lap = (k: string) => {
    timings[k] = Math.round(now() - t0)
    t0 = now()
  }

  // ───────────────────────── 1. networks
  progress('Reading the room', 0.05)
  const [sw, sh] = pickSegSize(W, H, opts.segSize ?? 768)
  const seg = await models.segment(toTensor(img.data, W, H, sw, sh), sw, sh)
  lap('segment')
  progress('Measuring depth', 0.45)
  const dk = (opts.depthSize ?? 770) / Math.max(W, H)
  const dw = Math.max(14, Math.round((W * dk) / 14) * 14)
  const dh = Math.max(14, Math.round((H * dk) / 14) * 14)
  const dep = await models.depth(toTensor(img.data, W, H, dw, dh), dw, dh)
  lap('depth')
  progress('Finding walls and floor', 0.8)

  // ───────────────────────── 2. class probabilities (floor / wall / ceiling) at network resolution
  const lw = seg.width
  const lh = seg.height
  const ln = lw * lh
  const nc = Math.round(seg.data.length / ln)
  const pF = new Float32Array(ln)
  const pW = new Float32Array(ln)
  const pC = new Float32Array(ln)
  const pR = new Float32Array(ln)
  const classMap = new Uint8Array(ln)
  for (let i = 0; i < ln; i++) {
    let mx = -Infinity
    for (let c = 0; c < nc; c++) {
      const v = seg.data[c * ln + i]
      if (v > mx) {
        mx = v
        classMap[i] = c
      }
    }
    let sum = 0
    for (let c = 0; c < nc; c++) sum += Math.exp(seg.data[c * ln + i] - mx)
    const p = (c: number) => Math.exp(seg.data[c * ln + i] - mx) / sum
    let f = 0
    for (const c of C_FLOOR) f += p(c)
    pF[i] = f
    pR[i] = p(C_RUG)
    pW[i] = p(C_WALL)
    pC[i] = p(C_CEILING)
  }
  // rugs: kept as objects on the new floor unless asked otherwise. When the network sees hardly
  // any floor but a large "rug" (wall-to-wall carpet, a plain rendered floor), that rug IS the floor.
  {
    let fl = 0
    let rg = 0
    for (let i = 0; i < ln; i++) {
      if (pF[i] > 0.5) fl++
      if (pR[i] > 0.5) rg++
    }
    if (opts.tileOverRugs || (rg > 0.06 * ln && fl < 0.35 * rg)) for (let i = 0; i < ln; i++) pF[i] += pR[i]
  }
  // full resolution class map: 0 object, 1 floor, 2 ceiling, 3 wall
  const fF = resizeBilinear(pF, lw, lh, W, H)
  const fW = resizeBilinear(pW, lw, lh, W, H)
  const fC = resizeBilinear(pC, lw, lh, W, H)
  const cls = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const f = fF[i]
    const w = fW[i]
    const c = fC[i]
    const o = 1 - f - w - c
    cls[i] = o >= f && o >= w && o >= c ? 0 : f >= w && f >= c ? 1 : c >= w ? 2 : 3
  }

  // ───────────────────────── 3. planes from inverse depth (at depth resolution)
  const dn = dw * dh
  const D = new Float32Array(dn)
  for (let i = 0; i < dn; i++) D[i] = 1 / Math.max(0.05, dep.data[i])
  const dcls = new Uint8Array(dn)
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) dcls[y * dw + x] = cls[Math.min(H - 1, Math.floor(((y + 0.5) * H) / dh)) * W + Math.min(W - 1, Math.floor(((x + 0.5) * W) / dw))]
  const xOf = (x: number) => ((x + 0.5) * W) / dw - W / 2
  const yOf = (y: number) => ((y + 0.5) * H) / dh - H / 2
  const er = Math.max(1, Math.round(dw / 300))
  const coreOf = (c: number) => {
    const m = new Uint8Array(dn)
    for (let i = 0; i < dn; i++) m[i] = dcls[i] === c ? 1 : 0
    return morph(m, dw, dh, er, 'min')
  }
  const fitMask = (m: Uint8Array, x0 = -Infinity, x1 = Infinity): Plane | null => {
    const xs: number[] = []
    const ys: number[] = []
    const ds: number[] = []
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        if (!m[y * dw + x]) continue
        const xc = xOf(x)
        if (xc < x0 || xc > x1) continue
        xs.push(xc)
        ys.push(yOf(y))
        ds.push(D[y * dw + x])
      }
    return fitPlane(xs, ys, ds)
  }
  const share = (c: number) => {
    let n = 0
    for (let i = 0; i < dn; i++) if (dcls[i] === c) n++
    return n / dn
  }
  const floorCore = coreOf(1)
  const ceilCore = coreOf(2)
  const wallCore = coreOf(3)
  const floorShare = share(1)
  const ceilShare = share(2)
  const wallShare = share(3)
  let floorP = floorShare > 0.012 ? fitMask(floorCore) : null
  let ceilP = ceilShare > 0.012 ? fitMask(ceilCore) : null
  // a floor must face up and a ceiling down, otherwise the fit is not trustworthy
  if (floorP && !(floorP.b > 0)) floorP = null
  if (ceilP && !(ceilP.b < 0)) ceilP = null

  // ── walls: per-column depth profile → straight pieces = walls, breaks = corners
  interface Wall {
    plane: Plane
    /** centred x range of the wall's columns */
    x0: number
    x1: number
  }
  let walls: Wall[] = []
  if (wallShare > 0.01) {
    // common vertical slope of the walls (small for an upright camera)
    const slopes: number[] = []
    const st = Math.max(2, Math.round(dh / 60))
    for (let y = 0; y + st < dh; y += 2)
      for (let x = 0; x < dw; x += 3) if (wallCore[y * dw + x] && wallCore[(y + st) * dw + x]) slopes.push((D[(y + st) * dw + x] - D[y * dw + x]) / (st * (H / dh)))
    const bHat = median(slopes)
    const cx: number[] = []
    const cm: number[] = []
    const cw: number[] = []
    const minCount = Math.max(3, Math.round(dh * 0.02))
    const col: number[] = []
    for (let x = 0; x < dw; x++) {
      col.length = 0
      for (let y = 0; y < dh; y++) if (wallCore[y * dw + x]) col.push(D[y * dw + x] - bHat * yOf(y))
      if (col.length < minCount) continue
      cx.push(xOf(x))
      cm.push(median(col))
      cw.push(Math.min(1, col.length / (dh * 0.25)))
    }
    if (cx.length >= 6) {
      const scale = median(cm) || 1
      const xs = Float64Array.from(cx, (v) => v / W)
      const ys = Float64Array.from(cm, (v) => v / scale)
      const segs = segmentLinear(xs, ys, Float64Array.from(cw), 2e-4 * cx.length, Math.max(3, Math.round(dw * 0.04)))
      walls = segs
        .map((s) => {
          const x0 = cx[s.s]
          const x1 = cx[s.e]
          const half = W / dw
          const plane = fitMask(wallCore, x0 - half, x1 + half)
          return plane ? { plane, x0, x1 } : null
        })
        .filter((w): w is Wall => !!w)
      // merge neighbours that are really one wall (same direction, no step between them)
      const f0 = 0.8 * Math.max(W, H)
      for (let i = 0; i + 1 < walls.length; ) {
        const a = walls[i]
        const b = walls[i + 1]
        const ang = (Math.acos(Math.min(1, Math.abs(dot(planeNormal(a.plane, f0).n, planeNormal(b.plane, f0).n)))) * 180) / Math.PI
        const xb = (a.x1 + b.x0) / 2
        const da = a.plane.a * xb + a.plane.g
        const db = b.plane.a * xb + b.plane.g
        const step = Math.abs(da - db) / Math.max(1e-9, Math.abs(da) + Math.abs(db))
        if (ang < 14 && step < 0.04) {
          const plane = fitMask(wallCore, a.x0 - 1, b.x1 + 1)
          if (plane) {
            walls.splice(i, 2, { plane, x0: a.x0, x1: b.x1 })
            continue
          }
        }
        i++
      }
    }
    if (!walls.length) {
      const plane = fitMask(wallCore)
      if (plane) walls = [{ plane, x0: -W / 2, x1: W / 2 }]
    }
  }

  // ── corners between neighbouring walls: where the two planes meet (a straight line in the photo)
  /** corner k separates wall k (left) from wall k+1 (right): x = x0 + k·y */
  const corners: { x0: number; k: number }[] = []
  for (let i = 0; i + 1 < walls.length; i++) {
    const a = walls[i]
    const b = walls[i + 1]
    const xb = (a.x1 + b.x0) / 2
    const da = a.plane.a - b.plane.a
    let line = { x0: xb, k: 0 }
    if (Math.abs(da) > 1e-12) {
      const k = -(a.plane.b - b.plane.b) / da
      const x0 = -(a.plane.g - b.plane.g) / da
      // accept the geometric corner when it is steep and close to where the profile breaks
      if (Math.abs(k) < 0.35 && Math.abs(x0 - xb) < 0.07 * W) line = { x0, k }
    }
    corners.push(line)
  }
  const wallAt = (xc: number, yc: number) => {
    let k = 0
    while (k < corners.length && xc > corners[k].x0 + corners[k].k * yc) k++
    return k
  }
  // refit each wall on the pixels between its own corners
  if (walls.length > 1)
    walls = walls.map((w, i) => {
      const xs: number[] = []
      const ys: number[] = []
      const ds: number[] = []
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          if (!wallCore[y * dw + x]) continue
          const xc = xOf(x)
          const yc = yOf(y)
          if (wallAt(xc, yc) !== i) continue
          xs.push(xc)
          ys.push(yc)
          ds.push(D[y * dw + x])
        }
      const plane = fitPlane(xs, ys, ds)
      return plane ? { ...w, plane } : w
    })
  lap('planes')

  // ───────────────────────── 4. camera
  const pairs: { p: Plane; q: Plane; w: number }[] = []
  const f0 = 0.8 * Math.max(W, H)
  for (let i = 0; i < walls.length; i++) {
    if (floorP) pairs.push({ p: floorP, q: walls[i].plane, w: 0.4 })
    if (ceilP) pairs.push({ p: ceilP, q: walls[i].plane, w: 0.25 })
    if (i + 1 < walls.length) {
      const ang = (Math.acos(Math.min(1, Math.abs(dot(planeNormal(walls[i].plane, f0).n, planeNormal(walls[i + 1].plane, f0).n)))) * 180) / Math.PI
      if (ang > 50) pairs.push({ p: walls[i].plane, q: walls[i + 1].plane, w: 1 })
    }
  }
  const f = estimateFocal(pairs, Math.max(W, H))
  // up direction: from the floor (its normal points down, away from the camera) and/or the ceiling
  let up: V3 = [0, -1, 0]
  {
    let acc: V3 = [0, 0, 0]
    if (floorP) acc = add(acc, planeNormal(floorP, f).n, -floorShare)
    if (ceilP) acc = add(acc, planeNormal(ceilP, f).n, ceilShare)
    if (Math.hypot(...acc) > 1e-6) up = norm(acc)
    if (up[1] > -0.5) up = [0, -1, 0] // implausible (camera would be lying on its side)
  }
  // metric scale: the depth network's metres are approximate; anchor them on a normal ceiling
  // height when floor and ceiling are both visible, otherwise on a plausible camera height
  let scale = 1
  {
    const hf = floorP ? planeNormal(floorP, f).d : 0
    const hc = ceilP ? planeNormal(ceilP, f).d : 0
    if (hf && hc) scale = 2.7 / (hf + hc)
    else if (hf) scale = Math.min(1.65, Math.max(1.1, hf)) / hf
    else if (hc) scale = Math.min(1.6, Math.max(0.9, hc)) / hc
    scale = Math.min(3, Math.max(0.35, scale))
  }

  // ───────────────────────── 5. surfaces (3D planes), with walls snapped upright
  interface Surf {
    type: DetectedType
    n: V3
    d: number
    plane: Plane
    cover: number
    /** index into walls for walls */
    wall: number
    id: number
    /** distance as fitted to the depth map, when `d` was later corrected to meet the walls */
    dFit?: number
  }
  const surfs: Surf[] = []
  const centroidOf = (pred: (i: number, x: number, y: number) => boolean): P2 | null => {
    let sx = 0
    let sy = 0
    let n = 0
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++)
        if (pred(y * dw + x, x, y)) {
          sx += x
          sy += y
          n++
        }
    if (!n) return null
    const cx = sx / n
    const cy = sy / n
    // nearest region pixel to the centroid (the centroid itself may fall outside a concave region)
    let best: P2 | null = null
    let bd = Infinity
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++)
        if (pred(y * dw + x, x, y)) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2
          if (d2 < bd) {
            bd = d2
            best = [xOf(x), yOf(y)]
          }
        }
    return best
  }
  // fallbacks when a region is visible but its plane could not be fitted
  const camH = 1.45 / scale
  if (floorShare > 0.012) {
    const pl = floorP ? planeNormal(floorP, f) : { n: [-up[0], -up[1], -up[2]] as V3, d: camH }
    surfs.push({ type: 'floor', n: pl.n, d: pl.d, plane: floorP ?? { a: 0, b: 1 / (f * camH), g: 0, n: 0, err: 1 }, cover: floorShare, wall: -1, id: 1 })
  }
  if (ceilShare > 0.012) {
    const pl = ceilP ? planeNormal(ceilP, f) : { n: up, d: 1.2 / scale }
    surfs.push({ type: 'ceiling', n: pl.n, d: pl.d, plane: ceilP ?? { a: 0, b: -1 / (f * (1.2 / scale)), g: 0, n: 0, err: 1 }, cover: ceilShare, wall: -1, id: 2 })
  }
  walls.forEach((w, i) => {
    let cnt = 0
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (dcls[y * dw + x] === 3 && wallAt(xOf(x), yOf(y)) === i) cnt++
    let { n, d } = planeNormal(w.plane, f)
    // snap the wall upright (perpendicular to the floor) keeping it through its own centre point
    const tilt = dot(n, up)
    if (Math.abs(tilt) < 0.34) {
      const c = centroidOf((j, x, y) => dcls[j] === 3 && wallAt(xOf(x), yOf(y)) === i)
      if (c) {
        const X0 = backProject(c[0], c[1], f, n, d)
        const n2 = norm(add(n, up, -tilt))
        const d2 = dot(n2, X0)
        if (d2 > 0) {
          n = n2
          d = d2
        }
      }
    }
    surfs.push({ type: 'wall', n, d, plane: w.plane, cover: cnt / dn, wall: i, id: 3 + i })
  })
  /** inverse depth of a surface's (possibly snapped) plane at centred pixel (x, y) */
  const invDepth = (s: Surf, xc: number, yc: number) => (s.n[0] * (xc / f) + s.n[1] * (yc / f) + s.n[2]) / s.d
  const floorS = surfs.find((s) => s.type === 'floor')
  const ceilS = surfs.find((s) => s.type === 'ceiling')
  const wallS = surfs.filter((s) => s.type === 'wall')
  // final corners: where the upright walls meet. Both are perpendicular to the floor, so the line
  // runs exactly along the room's vertical, as a real corner does.
  for (let i = 0; i + 1 < wallS.length; i++) {
    const p = wallS[i]
    const q = wallS[i + 1]
    const A = (p.n[0] / p.d - q.n[0] / q.d) / f
    const B = (p.n[1] / p.d - q.n[1] / q.d) / f
    const C = p.n[2] / p.d - q.n[2] / q.d
    if (Math.abs(A) < 1e-12) continue
    const k = -B / A
    const x0 = -C / A
    const xb = (walls[i].x1 + walls[i + 1].x0) / 2
    if (Math.abs(k) < 0.35 && Math.abs(x0 - xb) < 0.07 * W) corners[i] = { x0, k }
  }

  // ───────────────────────── 6. label map: every pixel belongs to one surface (objects included,
  // by geometry: along a viewing ray the room surface you would hit is the nearest plane)
  const labels = new Uint8Array(N) // surface id of the visible surface, 0 = object
  const region = new Uint8Array(N) // surface id including the part hidden behind objects
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5 - H / 2
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const xc = x + 0.5 - W / 2
      const wi = wallS.length ? wallAt(xc, yc) : -1
      const c = cls[i]
      let vis = 0
      if (c === 1 && floorS) vis = 1
      else if (c === 2 && ceilS) vis = 2
      else if (c === 3 && wi >= 0) vis = 3 + wi
      labels[i] = vis
      if (vis) {
        region[i] = vis
        continue
      }
      // hidden: nearest plane along the ray among this column's wall, the floor and the ceiling
      let best = 0
      let bd = 0
      if (wi >= 0) {
        bd = invDepth(wallS[wi], xc, yc)
        best = 3 + wi
      }
      if (floorS) {
        const d = invDepth(floorS, xc, yc)
        if (d > bd || !best) {
          bd = d
          best = 1
        }
      }
      if (ceilS) {
        const d = invDepth(ceilS, xc, yc)
        if (d > bd || !best) {
          bd = d
          best = 2
        }
      }
      region[i] = best
    }
  }
  // ── junctions between two surfaces (wall/ceiling, wall/floor) are straight lines in a photo:
  // replace the network's slightly wavy border by the line fitted through it
  {
    const diag = Math.hypot(W, H)
    const tol = Math.max(2, 0.0025 * diag)
    const band = Math.max(6, 0.012 * diag)
    const pts = new Map<number, number[]>()
    const push = (a: number, b: number, x: number, y: number) => {
      const key = a < b ? a * 256 + b : b * 256 + a
      let arr = pts.get(key)
      if (!arr) pts.set(key, (arr = []))
      arr.push(x, y)
    }
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const a = labels[y * W + x]
        if (!a) continue
        const r = labels[y * W + x + 1]
        const d = labels[(y + 1) * W + x]
        if (r && r !== a) push(a, r, x + 1, y + 0.5)
        if (d && d !== a) push(a, d, x + 0.5, y + 1)
      }
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
    for (const [key, p] of pts) {
      const n = p.length / 2
      if (n < 0.04 * Math.max(W, H)) continue
      const a = Math.floor(key / 256)
      const b = key % 256
      // RANSAC line, then least squares on its inliers
      let best = 0
      let bl = [0, 0, 0]
      for (let it = 0; it < 160; it++) {
        const i = Math.floor(rnd() * n)
        const j = Math.floor(rnd() * n)
        const dx = p[j * 2] - p[i * 2]
        const dy = p[j * 2 + 1] - p[i * 2 + 1]
        const len = Math.hypot(dx, dy)
        if (len < 0.02 * diag) continue
        const nx = -dy / len
        const ny = dx / len
        const c = -(nx * p[i * 2] + ny * p[i * 2 + 1])
        let cnt = 0
        for (let k = 0; k < n; k += 2) if (Math.abs(nx * p[k * 2] + ny * p[k * 2 + 1] + c) < tol) cnt++
        if (cnt > best) {
          best = cnt
          bl = [nx, ny, c]
        }
      }
      let mx = 0, my = 0, cnt = 0
      const inl: number[] = []
      for (let k = 0; k < n; k++)
        if (Math.abs(bl[0] * p[k * 2] + bl[1] * p[k * 2 + 1] + bl[2]) < tol) {
          inl.push(k)
          mx += p[k * 2]
          my += p[k * 2 + 1]
          cnt++
        }
      // only when the border really is one straight line
      if (cnt < 0.6 * n || cnt < 20) continue
      mx /= cnt
      my /= cnt
      let sxx = 0, sxy = 0, syy = 0
      for (const k of inl) {
        const ex = p[k * 2] - mx
        const ey = p[k * 2 + 1] - my
        sxx += ex * ex
        sxy += ex * ey
        syy += ey * ey
      }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
      const ux = Math.cos(th)
      const uy = Math.sin(th)
      const nx = -uy
      const ny = ux
      let t0 = Infinity
      let t1 = -Infinity
      for (const k of inl) {
        const t = (p[k * 2] - mx) * ux + (p[k * 2 + 1] - my) * uy
        if (t < t0) t0 = t
        if (t > t1) t1 = t
      }
      // which side of the line is surface a
      let sa = 0
      const inBand = (x: number, y: number, w: number) => {
        const ex = x + 0.5 - mx
        const ey = y + 0.5 - my
        const t = ex * ux + ey * uy
        const s = ex * nx + ey * ny
        return t >= t0 - band && t <= t1 + band && Math.abs(s) <= w ? s : NaN
      }
      for (let y = 0; y < H; y += 2)
        for (let x = 0; x < W; x += 2) {
          const l = labels[y * W + x]
          if (l !== a && l !== b) continue
          const s = inBand(x, y, 3 * band)
          if (s === s) sa += (l === a ? 1 : -1) * Math.sign(s)
        }
      if (!sa) continue
      const sideA = Math.sign(sa)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          const l = labels[i]
          if (l !== a && l !== b) continue
          const s = inBand(x, y, band)
          if (s !== s) continue
          const nl = s * sideA > 0 ? a : b
          labels[i] = nl
          region[i] = nl
        }
    }
  }
  // ── a room is watertight: the floor (and ceiling) must meet each wall exactly along the junction
  // seen in the photo. The planes were fitted one by one, so slide the floor / ceiling along
  // their normal until they do. Walls are the reference: they are large, face the camera and are
  // measured best. This makes tile sizes agree between floor and walls, as in a hand-built model.
  {
    const refit = (s: Surf | undefined, id: number) => {
      if (!s || !wallS.length) return
      const cand: number[] = []
      const step = Math.max(1, Math.round(Math.max(W, H) / 800))
      for (let y = 2; y < H - 2; y += step)
        for (let x = 0; x < W; x += step) {
          if (labels[y * W + x] !== id) continue
          // a wall directly above the floor pixel (below, for the ceiling)
          const o = labels[(id === 1 ? y - 2 : y + 2) * W + x]
          if (o < 3) continue
          const w = wallS[o - 3]
          if (!w) continue
          const xc = x + 0.5 - W / 2
          const yc = (id === 1 ? y - 1 : y + 1) + 0.5 - H / 2
          const rw = w.n[0] * (xc / f) + w.n[1] * (yc / f) + w.n[2]
          const rs = s.n[0] * (xc / f) + s.n[1] * (yc / f) + s.n[2]
          if (rw > 1e-6 && rs > 1e-6) cand.push((rs * w.d) / rw)
        }
      if (cand.length < 25) return
      const d = median(cand)
      // only a correction, never a different room
      if (d > 0.6 * s.d && d < 1.6 * s.d) {
        s.dFit = s.d
        s.d = d
      }
    }
    refit(floorS, 1)
    refit(ceilS, 2)
    if (floorS && ceilS) scale = Math.min(3, Math.max(0.35, 2.7 / (floorS.d + ceilS.d)))
    else if (floorS) scale = Math.min(3, Math.max(0.35, Math.min(1.65, Math.max(1.1, floorS.d * scale)) / floorS.d))
  }
  lap('labels')

  // ───────────────────────── 7. object layer: not a surface, edges snapped to the photo
  progress('Cutting out furniture and objects', 0.88)
  const obj = new Uint8Array(N)
  for (let i = 0; i < N; i++) obj[i] = labels[i] ? 0 : 1
  // thin things the segmentation misses (lamp stems, chair legs, cables) stand out in depth:
  // clearly nearer than the surface behind them, in a narrow band
  {
    const rel = new Float32Array(dn)
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        const j = y * dw + x
        const fx = Math.min(W - 1, Math.floor(((x + 0.5) * W) / dw))
        const fy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / dh))
        const id = labels[fy * W + fx]
        const s = id === 1 ? floorS : id === 2 ? ceilS : id >= 3 ? wallS[id - 3] : undefined
        if (!s) continue
        // compare with the plane as the depth map sees it (not the junction-corrected one)
        const e = (invDepth(s, xOf(x), yOf(y)) * s.d) / (s.dFit ?? s.d)
        rel[j] = e > 1e-6 ? (D[j] - e) / e : 0
      }
    // remove the slowly varying part (plane fit / network bias): keep what sticks out locally
    const r1 = Math.max(4, Math.round(dw / 40))
    const base = boxBlur(rel, dw, dh, r1)
    const thin = new Uint8Array(dn)
    for (let j = 0; j < dn; j++) thin[j] = rel[j] - base[j] > 0.035 && rel[j] > 0.03 ? 1 : 0
    dropSmall(thin, dw, dh, Math.max(6, Math.round(dn / 20000)))
    opts.debug?.('thin', thin, dw, dh)
    for (let y = 0; y < H; y++) {
      const dy = Math.min(dh - 1, Math.floor((y * dh) / H))
      for (let x = 0; x < W; x++) if (thin[dy * dw + Math.min(dw - 1, Math.floor((x * dw) / W))]) obj[y * W + x] = 1
    }
  }
  // optional sharper pass: anything narrow that pops out of its surroundings in depth
  // (white top-hat of inverse depth), whatever the surface behind it
  if (opts.detailSize) {
    progress('Looking for thin objects', 0.9)
    const k2 = opts.detailSize / Math.max(W, H)
    const w2 = Math.max(14, Math.round((W * k2) / 14) * 14)
    const h2 = Math.max(14, Math.round((H * k2) / 14) * 14)
    const d2 = await models.depth(toTensor(img.data, W, H, w2, h2), w2, h2)
    const n2 = w2 * h2
    const inv = new Float32Array(n2)
    for (let i = 0; i < n2; i++) inv[i] = 1 / Math.max(0.05, d2.data[i])
    const r2 = Math.max(3, Math.round(w2 / 90))
    const opened = morphGray(morphGray(inv, w2, h2, r2, 'min'), w2, h2, r2, 'max')
    const thin = new Uint8Array(n2)
    // the network is unreliable in the outermost rows / columns: ignore a small margin
    const mg = Math.max(3, Math.round(Math.max(w2, h2) * 0.02))
    for (let y = mg; y < h2 - mg; y++)
      for (let x = mg; x < w2 - mg; x++) {
        const i = y * w2 + x
        thin[i] = (inv[i] - opened[i]) / inv[i] > 0.022 ? 1 : 0
      }
    dropSmall(thin, w2, h2, Math.max(10, Math.round(w2 / 40)))
    // a real thin part belongs to something: keep only pieces that touch an object already found
    // (a stem joins its lamp, a leg its chair); isolated specks on a wall are depth noise
    {
      const near = morph(obj, W, H, Math.max(2, Math.round(Math.max(W, H) / 500)), 'max')
      const { labels: tl, sizes } = components(thin, w2, h2)
      const keep = new Uint8Array(sizes.length)
      for (let y = 0; y < h2; y++) {
        const fy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / h2))
        for (let x = 0; x < w2; x++) {
          const l = tl[y * w2 + x]
          if (l && !keep[l] && near[fy * W + Math.min(W - 1, Math.floor(((x + 0.5) * W) / w2))]) keep[l] = 1
        }
      }
      for (let i = 0; i < n2; i++) if (thin[i] && !keep[tl[i]]) thin[i] = 0
    }
    opts.debug?.('detail', thin, w2, h2)
    for (let y = 0; y < H; y++) {
      const dy = Math.min(h2 - 1, Math.floor((y * h2) / H))
      for (let x = 0; x < W; x++) if (thin[dy * w2 + Math.min(w2 - 1, Math.floor((x * w2) / W))]) obj[y * W + x] = 1
    }
    lap('detail')
  }
  // specks are noise, not furniture; pin-holes inside objects are not floor
  dropSmall(obj, W, H, Math.max(12, Math.round(N / 40000)))
  {
    const inv = new Uint8Array(N)
    for (let i = 0; i < N; i++) inv[i] = obj[i] ? 0 : 1
    const { labels: cl, sizes } = components(inv, W, H)
    const minHole = Math.max(12, Math.round(N / 30000))
    for (let i = 0; i < N; i++) if (inv[i] && sizes[cl[i]] < minHole) obj[i] = 1
  }
  const R = new Float32Array(N)
  const G = new Float32Array(N)
  const B = new Float32Array(N)
  const P = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    R[i] = img.data[i * 4] / 255
    G[i] = img.data[i * 4 + 1] / 255
    B[i] = img.data[i * 4 + 2] / 255
    P[i] = obj[i]
  }
  const gr = Math.max(3, Math.round(Math.max(W, H) / 260))
  const q = guidedFilterColor([R, G, B], P, W, H, gr, 2e-4)
  const objAlpha = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    // steepen the soft matte into a crisp, anti-aliased edge
    const v = (q[i] - 0.3) / 0.4
    objAlpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(255 * v * v * (3 - 2 * v))
  }
  lap('objects')

  // ───────────────────────── 8. per surface: outline polygon + perspective guide
  progress('Fitting perspective', 0.95)
  const out: DetectedSurface[] = []
  const mainWall = [...wallS].sort((a, b) => b.cover - a.cover)[0]
  let wallNo = 0
  for (const s of surfs) {
    if (s.cover < (s.type === 'wall' ? 0.008 : 0.012)) continue
    const m = new Uint8Array(N)
    let any = 0
    for (let i = 0; i < N; i++)
      if (region[i] === s.id) {
        m[i] = 1
        any++
      }
    if (!any) continue
    // 1px overlap so neighbouring surfaces never leave a hairline of the old photo between them
    const poly = simplify(traceOuter(morph(m, W, H, 1, 'max'), W, H), Math.max(1.2, Math.max(W, H) / 1100))
    if (poly.length < 3) continue
    const edge = (v: number, max: number) => (v <= 0.5 ? -0.05 * max : v >= max - 0.5 ? 1.05 * max : v)
    const area = poly.map(([x, y]): P2 => [+(edge(x, W) / W).toFixed(4), +(edge(y, H) / H).toFixed(4)])
    const cw: P2 =
      (s.type === 'wall' ? centroidOf((j, x, y) => dcls[j] === 3 && wallAt(xOf(x), yOf(y)) === s.wall) : centroidOf((j) => dcls[j] === (s.type === 'floor' ? 1 : 2))) ?? [0, 0]
    // horizontal edge of the guide: along the wall's foot for walls, along the main wall for floors
    const along: V3 = s.type === 'wall' ? cross(s.n, up) : mainWall ? cross(s.n, mainWall.n) : [1, 0, 0]
    let side = 1 / scale
    let g = guideQuad(s.n, s.d, f, cw, along, side)
    // keep the guide a comfortable size on screen (it is only a reference rectangle)
    for (let it = 0; it < 6 && g; it++) {
      const xs = g.quad.map((p) => p[0])
      const ys = g.quad.map((p) => p[1])
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      if (span > 0.5 * Math.max(W, H)) side = g.side / 2
      else if (span < 0.1 * Math.max(W, H)) side = g.side * 2
      else break
      g = guideQuad(s.n, s.d, f, cw, along, side)
    }
    if (!g) continue
    const real = +(g.side * scale).toFixed(2)
    out.push({
      type: s.type,
      label: s.type === 'wall' ? (wallS.length > 1 ? `Wall ${++wallNo}` : 'Wall') : s.type === 'floor' ? 'Floor' : 'Ceiling',
      quad: g.quad.map(([x, y]): P2 => [+((x + W / 2) / W).toFixed(4), +((y + H / 2) / H).toFixed(4)]),
      area,
      size: [real, real],
      cover: +s.cover.toFixed(4),
    })
  }
  lap('surfaces')
  progress('Done', 1)
  return {
    width: W,
    height: H,
    surfaces: out,
    objAlpha,
    camera: { f, fovDeg: (2 * Math.atan(Math.max(W, H) / 2 / f) * 180) / Math.PI, pitchDeg: (Math.asin(Math.max(-1, Math.min(1, -up[2]))) * 180) / Math.PI, scale },
    classMap,
    classW: lw,
    classH: lh,
    labels,
    timings,
  }
}
