/**
 * Small, dependency-free image operations on typed arrays (no DOM), shared by the browser worker
 * and the Node server / test harness.
 */

export type F32 = Float32Array<ArrayBufferLike>
export type P2 = [number, number]

/** Bilinear resize of a single-channel float image. */
export function resizeBilinear(src: F32, sw: number, sh: number, dw: number, dh: number): F32 {
  if (sw === dw && sh === dh) return src
  const out = new Float32Array(dw * dh)
  const kx = sw / dw
  const ky = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ky - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * kx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = fx - x0
      const a = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx
      const b = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx
      out[y * dw + x] = a * (1 - wy) + b * wy
    }
  }
  return out
}

/**
 * RGBA bytes -> normalised CHW float tensor at (dw, dh), ImageNet mean/std.
 * Downscaling averages the source footprint (area filter), so thin details survive.
 */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const MEAN = [0.485, 0.456, 0.406]
  const STD = [0.229, 0.224, 0.225]
  const out = new Float32Array(3 * dw * dh)
  const kx = sw / dw
  const ky = sh / dh
  const n = dw * dh
  if (kx <= 1 && ky <= 1) {
    for (let y = 0; y < dh; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ky - 0.5))
      const y0 = Math.floor(fy)
      const y1 = Math.min(sh - 1, y0 + 1)
      const wy = fy - y0
      for (let x = 0; x < dw; x++) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * kx - 0.5))
        const x0 = Math.floor(fx)
        const x1 = Math.min(sw - 1, x0 + 1)
        const wx = fx - x0
        for (let c = 0; c < 3; c++) {
          const a = rgba[(y0 * sw + x0) * 4 + c] * (1 - wx) + rgba[(y0 * sw + x1) * 4 + c] * wx
          const b = rgba[(y1 * sw + x0) * 4 + c] * (1 - wx) + rgba[(y1 * sw + x1) * 4 + c] * wx
          out[c * n + y * dw + x] = ((a * (1 - wy) + b * wy) / 255 - MEAN[c]) / STD[c]
        }
      }
    }
    return out
  }
  for (let y = 0; y < dh; y++) {
    const ya = Math.floor(y * ky)
    const yb = Math.max(ya + 1, Math.min(sh, Math.ceil((y + 1) * ky)))
    for (let x = 0; x < dw; x++) {
      const xa = Math.floor(x * kx)
      const xb = Math.max(xa + 1, Math.min(sw, Math.ceil((x + 1) * kx)))
      let r = 0
      let g = 0
      let b = 0
      for (let yy = ya; yy < yb; yy++)
        for (let xx = xa; xx < xb; xx++) {
          const o = (yy * sw + xx) * 4
          r += rgba[o]
          g += rgba[o + 1]
          b += rgba[o + 2]
        }
      const cnt = (yb - ya) * (xb - xa) * 255
      out[y * dw + x] = (r / cnt - MEAN[0]) / STD[0]
      out[n + y * dw + x] = (g / cnt - MEAN[1]) / STD[1]
      out[2 * n + y * dw + x] = (b / cnt - MEAN[2]) / STD[2]
    }
  }
  return out
}

/** Mean filter with a (2r+1) square window, edges clamped (running sums). */
export function boxBlur(src: F32, W: number, H: number, r: number): F32 {
  if (r < 1) return src
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(W - 1, Math.max(0, k))]
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc * norm
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + x]
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * norm
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
    }
  }
  return out
}

/**
 * Guided filter with a colour guide (He et al.): smooths `p` while snapping its edges to the
 * edges of the guide image. Used to pull coarse network masks onto real object outlines.
 * @param guide RGB planes in 0..1, each W*H
 */
export function guidedFilterColor(guide: [F32, F32, F32], p: F32, W: number, H: number, r: number, eps: number): F32 {
  const n = W * H
  const [R, G, B] = guide
  const mul = (a: F32, b: F32) => {
    const o = new Float32Array(n)
    for (let i = 0; i < n; i++) o[i] = a[i] * b[i]
    return o
  }
  const bl = (a: F32) => boxBlur(a, W, H, r)
  const mR = bl(R)
  const mG = bl(G)
  const mB = bl(B)
  const mP = bl(p)
  const mRp = bl(mul(R, p))
  const mGp = bl(mul(G, p))
  const mBp = bl(mul(B, p))
  const vRR = bl(mul(R, R))
  const vRG = bl(mul(R, G))
  const vRB = bl(mul(R, B))
  const vGG = bl(mul(G, G))
  const vGB = bl(mul(G, B))
  const vBB = bl(mul(B, B))
  const aR = new Float32Array(n)
  const aG = new Float32Array(n)
  const aB = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // covariance of the guide in the window (+eps on the diagonal), inverted in closed form
    const rr = vRR[i] - mR[i] * mR[i] + eps
    const rg = vRG[i] - mR[i] * mG[i]
    const rb = vRB[i] - mR[i] * mB[i]
    const gg = vGG[i] - mG[i] * mG[i] + eps
    const gb = vGB[i] - mG[i] * mB[i]
    const bb = vBB[i] - mB[i] * mB[i] + eps
    const cR = mRp[i] - mR[i] * mP[i]
    const cG = mGp[i] - mG[i] * mP[i]
    const cB = mBp[i] - mB[i] * mP[i]
    const i00 = gg * bb - gb * gb
    const i01 = rb * gb - rg * bb
    const i02 = rg * gb - rb * gg
    const det = rr * i00 + rg * i01 + rb * i02 || 1e-12
    const i11 = rr * bb - rb * rb
    const i12 = rb * rg - rr * gb
    const i22 = rr * gg - rg * rg
    const ar = (i00 * cR + i01 * cG + i02 * cB) / det
    const ag = (i01 * cR + i11 * cG + i12 * cB) / det
    const ab = (i02 * cR + i12 * cG + i22 * cB) / det
    aR[i] = ar
    aG[i] = ag
    aB[i] = ab
    b[i] = mP[i] - ar * mR[i] - ag * mG[i] - ab * mB[i]
  }
  const maR = bl(aR)
  const maG = bl(aG)
  const maB = bl(aB)
  const mb = bl(b)
  const q = new Float32Array(n)
  for (let i = 0; i < n; i++) q[i] = maR[i] * R[i] + maG[i] * G[i] + maB[i] * B[i] + mb[i]
  return q
}

/** Grey-scale erosion (op='min') / dilation (op='max') with a square window of radius r. */
export function morphGray(src: F32, W: number, H: number, r: number, op: 'min' | 'max'): F32 {
  const pick = op === 'min' ? Math.min : Math.max
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = src[y * W + x]
      const a = Math.max(0, x - r)
      const b = Math.min(W - 1, x + r)
      for (let k = a; k <= b; k++) v = pick(v, src[y * W + k])
      tmp[y * W + x] = v
    }
  for (let y = 0; y < H; y++) {
    const a = Math.max(0, y - r)
    const b = Math.min(H - 1, y + r)
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x]
      for (let k = a; k <= b; k++) v = pick(v, tmp[k * W + x])
      out[y * W + x] = v
    }
  }
  return out
}

/** Binary erosion (op='min') / dilation (op='max') with a square window of radius r. */
export function morph(src: Uint8Array, W: number, H: number, r: number, op: 'min' | 'max'): Uint8Array {
  if (r < 1) return src
  const tmp = new Uint8Array(W * H)
  const out = new Uint8Array(W * H)
  const want = op === 'max' ? 1 : 0
  // a pixel becomes `want` when any pixel within r is `want` (two separable passes with run lengths)
  const pass = (a: Uint8Array, b: Uint8Array, horizontal: boolean) => {
    const outer = horizontal ? H : W
    const inner = horizontal ? W : H
    for (let o = 0; o < outer; o++) {
      let last = -1e9
      // forward: distance to the previous `want`
      const idx = (k: number) => (horizontal ? o * W + k : k * W + o)
      const dist = new Int32Array(inner)
      for (let k = 0; k < inner; k++) {
        if ((a[idx(k)] ? 1 : 0) === want) last = k
        dist[k] = k - last
      }
      last = 1e9
      for (let k = inner - 1; k >= 0; k--) {
        if ((a[idx(k)] ? 1 : 0) === want) last = k
        const d = Math.min(dist[k], last - k)
        b[idx(k)] = d <= r ? want : 1 - want
      }
    }
  }
  pass(src, tmp, true)
  pass(tmp, out, false)
  return out
}

/** 4-connected components. Returns labels (0 = background, 1..n) and per-component pixel counts. */
export function components(mask: Uint8Array, W: number, H: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(W * H)
  const sizes: number[] = [0]
  const stack = new Int32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || labels[i]) continue
    const id = sizes.length
    let sp = 0
    let cnt = 0
    stack[sp++] = i
    labels[i] = id
    while (sp) {
      const j = stack[--sp]
      cnt++
      const x = j % W
      if (x > 0 && mask[j - 1] && !labels[j - 1]) (labels[j - 1] = id), (stack[sp++] = j - 1)
      if (x < W - 1 && mask[j + 1] && !labels[j + 1]) (labels[j + 1] = id), (stack[sp++] = j + 1)
      if (j >= W && mask[j - W] && !labels[j - W]) (labels[j - W] = id), (stack[sp++] = j - W)
      if (j < W * (H - 1) && mask[j + W] && !labels[j + W]) (labels[j + W] = id), (stack[sp++] = j + W)
    }
    sizes.push(cnt)
  }
  return { labels, sizes }
}

/** Remove connected blobs of `mask` smaller than minSize (in place). */
export function dropSmall(mask: Uint8Array, W: number, H: number, minSize: number) {
  const { labels, sizes } = components(mask, W, H)
  for (let i = 0; i < W * H; i++) if (mask[i] && sizes[labels[i]] < minSize) mask[i] = 0
}

/**
 * Outer contour of the largest blob in a binary mask, as a closed polygon running along pixel
 * edges (crack following), so two regions that share a border produce the same border line.
 * Coordinates are pixel-corner coordinates (0..W, 0..H).
 */
export function traceOuter(mask: Uint8Array, W: number, H: number): P2[] {
  const { labels, sizes } = components(mask, W, H)
  let best = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > (sizes[best] || 0)) best = i
  if (!best) return []
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] === best
  // start: top-left-most pixel of the blob; walk its boundary clockwise keeping the blob on the right
  let sx = -1
  let sy = -1
  for (let i = 0; i < W * H && sx < 0; i++) if (labels[i] === best) (sx = i % W), (sy = (i / W) | 0)
  const pts: P2[] = []
  // directions: 0=right, 1=down, 2=left, 3=up; position is a pixel corner
  let x = sx
  let y = sy
  let d = 0
  const x0 = x
  const y0 = y
  let guard = 4 * (W + 1) * (H + 1)
  do {
    pts.push([x, y])
    // cells around the corner (x,y): a=(x-1,y-1) b=(x,y-1) c=(x-1,y) e=(x,y)
    // try turning right first, then straight, then left: hugs the 4-connected blob on the right-hand side
    const ahead = (dir: number): [boolean, boolean] => {
      // [cell on the left of the move, cell on the right of the move]
      if (dir === 0) return [at(x, y - 1), at(x, y)]
      if (dir === 1) return [at(x, y), at(x - 1, y)]
      if (dir === 2) return [at(x - 1, y), at(x - 1, y - 1)]
      return [at(x - 1, y - 1), at(x, y - 1)]
    }
    let moved = false
    for (const turn of [1, 0, 3]) {
      const nd = (d + turn) % 4
      const [l, r] = ahead(nd)
      if (r && !l) {
        d = nd
        moved = true
        break
      }
    }
    if (!moved) break
    if (d === 0) x++
    else if (d === 1) y++
    else if (d === 2) x--
    else y--
  } while ((x !== x0 || y !== y0) && guard-- > 0)
  return pts
}

/** Douglas-Peucker simplification of a closed polygon. */
export function simplify(poly: P2[], tol: number): P2[] {
  if (poly.length < 5) return poly
  // split at the two mutually farthest-ish points so the closed ring becomes two open chains
  let a = 0
  let b = 0
  let best = -1
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i][0] - poly[0][0]) ** 2 + (poly[i][1] - poly[0][1]) ** 2
    if (d > best) (best = d), (b = i)
  }
  best = -1
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i][0] - poly[b][0]) ** 2 + (poly[i][1] - poly[b][1]) ** 2
    if (d > best) (best = d), (a = i)
  }
  if (a > b) [a, b] = [b, a]
  const chain = (pts: P2[]): P2[] => {
    const keep = new Uint8Array(pts.length)
    keep[0] = keep[pts.length - 1] = 1
    const st: [number, number][] = [[0, pts.length - 1]]
    while (st.length) {
      const [s, e] = st.pop()!
      const [x1, y1] = pts[s]
      const [x2, y2] = pts[e]
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1e-9
      let far = -1
      let fd = tol
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs((pts[i][0] - x1) * dy - (pts[i][1] - y1) * dx) / len
        if (d > fd) (fd = d), (far = i)
      }
      if (far > 0) {
        keep[far] = 1
        st.push([s, far], [far, e])
      }
    }
    return pts.filter((_, i) => keep[i])
  }
  const c1 = chain(poly.slice(a, b + 1))
  const c2 = chain([...poly.slice(b), ...poly.slice(0, a + 1)])
  return [...c1.slice(0, -1), ...c2.slice(0, -1)]
}

/** Median of an array (copy + sort); returns 0 for empty input. */
export function median(v: number[] | Float32Array | Float64Array): number {
  if (!v.length) return 0
  const s = Float64Array.from(v).sort()
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
