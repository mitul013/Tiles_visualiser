/**
 * Detect tile surfaces from a cut-out layer (transparent = where tiles go), so a prepared room
 * (original + matt/glossy cut-outs, like the reference's room assets) needs no manual marking.
 *
 * For each transparent region: classify floor / wall from its position, fit a 4-corner quad
 * (largest quadrilateral inside the region's convex hull), and, for floors cut off by the photo
 * frame, extend the near corners outward so the perspective converges like a real floor.
 */
import type { SurfaceType } from '../types'

export interface DetectedSurface {
  type: SurfaceType
  label: string
  /** normalised outline of the region (convex hull; the cut-out gives the exact pixels) */
  area: [number, number][]
  /** perspective guide TL, TR, BR, BL inside the photo */
  guide: [number, number][]
  size: [number, number]
  /** share of the photo this surface covers */
  cover: number
}

type P = [number, number]

function erode(m: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue
      let ok = 1
      for (let dy = -r; dy <= r && ok; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          if (!m[yy * w + xx]) {
            ok = 0
            break
          }
        }
      out[y * w + x] = ok
    }
  return out
}

const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

function convexHull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const lower: P[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: P[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

const polyArea = (q: P[]) => {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i]
    const [x2, y2] = q[(i + 1) % q.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Largest-area quadrilateral with vertices on the hull (hull order keeps it convex). */
function maxQuad(hull: P[]): P[] {
  let h = hull
  if (h.length > 36) {
    const step = h.length / 36
    h = Array.from({ length: 36 }, (_, i) => hull[Math.floor(i * step)])
  }
  if (h.length <= 4) return h
  let best: P[] = h.slice(0, 4)
  let bestA = -1
  const n = h.length
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q = [h[a], h[b], h[c], h[d]]
          const ar = polyArea(q)
          if (ar > bestA) {
            bestA = ar
            best = q
          }
        }
  return best
}

/** Order four corners as TL, TR, BR, BL. */
function orderQuad(q: P[]): P[] {
  const byY = [...q].sort((a, b) => a[1] - b[1])
  const top = byY.slice(0, 2).sort((a, b) => a[0] - b[0])
  const bottom = byY.slice(2).sort((a, b) => a[0] - b[0])
  return [top[0], top[1], bottom[1], bottom[0]]
}

/**
 * @param alpha cut-out alpha (0..255), W x H; transparent pixels are surfaces
 */
export function detectSurfaces(alpha: Uint8ClampedArray, W: number, H: number): DetectedSurface[] {
  // work on a small grid (fast, plenty for corner fitting)
  const k = Math.min(1, 260 / Math.max(W, H))
  const w = Math.max(2, Math.round(W * k))
  const h = Math.max(2, Math.round(H * k))
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, Math.round(x / k))
      const sy = Math.min(H - 1, Math.round(y / k))
      m[y * w + x] = alpha[sy * W + sx] < 128 ? 1 : 0
    }
  // split surfaces that touch (e.g. wall running into floor) by eroding thin connections first,
  // labelling the cores, then giving every remaining pixel to the nearest core
  const core = erode(m, w, h, Math.max(1, Math.round(Math.max(w, h) / 130)))
  const label = new Int32Array(w * h).fill(-1)
  const regions: { px: number[]; minY: number; maxY: number; cy: number }[] = []
  const stack: number[] = []
  for (let i = 0; i < m.length; i++) {
    if (!core[i] || label[i] !== -1) continue
    const id = regions.length
    const px: number[] = []
    stack.push(i)
    label[i] = id
    let minY = h
    let maxY = 0
    let sy = 0
    while (stack.length) {
      const j = stack.pop()!
      px.push(j)
      const x = j % w
      const y = (j / w) | 0
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      sy += y
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (n >= 0 && core[n] && label[n] === -1) (label[n] = id), stack.push(n)
    }
    regions.push({ px, minY, maxY, cy: sy / px.length })
  }
  // grow cores back over the eroded rim (breadth-first, nearest core wins)
  let frontier: number[] = []
  for (let i = 0; i < m.length; i++) if (label[i] !== -1) frontier.push(i)
  while (frontier.length) {
    const next: number[] = []
    for (const j of frontier) {
      const x = j % w
      const y = (j / w) | 0
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (n >= 0 && m[n] && label[n] === -1) {
          label[n] = label[j]
          const r = regions[label[j]]
          r.px.push(n)
          r.minY = Math.min(r.minY, (n / w) | 0)
          r.maxY = Math.max(r.maxY, (n / w) | 0)
          next.push(n)
        }
    }
    frontier = next
  }

  const out: DetectedSurface[] = []
  const big = regions.filter((r) => r.px.length > w * h * 0.015).sort((a, b) => b.px.length - a.px.length)
  let walls = 0
  for (const r of big) {
    // boundary pixels only → hull
    const pts: P[] = []
    for (const j of r.px) {
      const x = j % w
      const y = (j / w) | 0
      const id = label[j]
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[j - 1] !== id || label[j + 1] !== id || label[j - w] !== id || label[j + w] !== id
      if (edge) pts.push([x / (w - 1), y / (h - 1)])
    }
    const hull = convexHull(pts)
    const quad = orderQuad(maxQuad(hull))
    const touchesBottom = r.maxY >= h - 2
    const isFloor = touchesBottom && r.cy / h > 0.5
    const isCeiling = !isFloor && r.minY <= 1 && r.cy / h < 0.25
    // perspective guide: a trapezoid inside the region. For floors, side edges converge towards
    // the back so tile lines recede (the user aligns it with real joints in the editor).
    const [tl, tr, br, bl] = quad
    let guide = quad
    if (isFloor) {
      const yTop = tl[1] + (bl[1] - tl[1]) * 0.15
      const yBot = tl[1] + (bl[1] - tl[1]) * 0.75
      const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4
      const wTop = Math.min(0.5, (tr[0] - tl[0]) * 0.5)
      const wBot = Math.min(0.8, wTop * 1.6)
      guide = [[cx - wTop / 2, yTop], [cx + wTop / 2, yTop], [cx + wBot / 2, yBot], [cx - wBot / 2, yBot]]
    } else {
      // walls / ceilings: inset rectangle of the fitted quad
      const ins = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const c: P = [(tl[0] + tr[0] + br[0] + bl[0]) / 4, (tl[1] + tr[1] + br[1] + bl[1]) / 4]
      guide = [ins(tl, c, 0.3), ins(tr, c, 0.3), ins(br, c, 0.3), ins(bl, c, 0.3)]
    }
    const type: SurfaceType = isFloor ? 'floor' : isCeiling ? 'ceiling' : 'wall'
    const n = type === 'wall' ? ++walls : 0
    const widthN = Math.max(...quad.map((q) => q[0])) - Math.min(...quad.map((q) => q[0]))
    const heightN = Math.max(...quad.map((q) => q[1])) - Math.min(...quad.map((q) => q[1]))
    const size: [number, number] = type === 'floor' ? [4.5, 5] : type === 'ceiling' ? [4.5, 4.5] : [Math.max(1, +(2.7 * ((widthN * W) / Math.max(1, heightN * H))).toFixed(1)), 2.7]
    const gw = Math.max(...guide.map((q) => q[0])) - Math.min(...guide.map((q) => q[0]))
    const gh = Math.max(...guide.map((q) => q[1])) - Math.min(...guide.map((q) => q[1]))
    // guide real size: floors ~2 m square by default; walls keep the photo aspect at ~1.2 m high
    const gSize: [number, number] = type === 'floor' ? [2, 2] : [Math.max(0.3, +((1.2 * (gw * W)) / Math.max(1, gh * H)).toFixed(2)), 1.2]
    void size
    const r4 = (p: P): [number, number] => [+p[0].toFixed(4), +p[1].toFixed(4)]
    out.push({ type, label: type === 'wall' ? (n > 1 ? `Wall ${n}` : 'Wall') : type === 'floor' ? 'Floor' : 'Ceiling', area: hull.map(r4), guide: guide.map(r4), size: gSize, cover: r.px.length / (w * h) })
  }
  return out
}
