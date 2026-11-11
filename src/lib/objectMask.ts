/**
 * Object-mask refinement ("snap to object").
 *
 * The user marks objects roughly (brush strokes or boxes). We separate the object from the
 * surface behind it by colour: a background model is learned from the surface pixels around
 * the rough region, a foreground model from the pixels inside it, and each pixel is assigned
 * to the closer model. Two refinement rounds (GrabCut-style), then morphological clean-up.
 * The result is a pixel-precise mask that follows the object's real outline.
 */

type Lab = [number, number, number]

function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    c /= 255
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

function kmeans(samples: Lab[], k: number, iters = 8): Lab[] {
  if (!samples.length) return []
  k = Math.min(k, samples.length)
  // k-means++ style seeding (deterministic stride for stability)
  const centers: Lab[] = [samples[0]]
  while (centers.length < k) {
    let best = 0
    let bestD = -1
    for (let i = 0; i < samples.length; i += Math.max(1, Math.floor(samples.length / 400))) {
      const dd = Math.min(...centers.map((c) => d2(c, samples[i])))
      if (dd > bestD) {
        bestD = dd
        best = i
      }
    }
    centers.push(samples[best])
  }
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0, 0])
    for (const s of samples) {
      let bi = 0
      let bd = Infinity
      for (let c = 0; c < centers.length; c++) {
        const dd = d2(centers[c], s)
        if (dd < bd) {
          bd = dd
          bi = c
        }
      }
      sum[bi][0] += s[0]
      sum[bi][1] += s[1]
      sum[bi][2] += s[2]
      sum[bi][3]++
    }
    for (let c = 0; c < centers.length; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]]
  }
  return centers
}

const nearest = (cs: Lab[], p: Lab) => {
  let bd = Infinity
  for (const c of cs) bd = Math.min(bd, d2(c, p))
  return Math.sqrt(bd)
}

/** Box blur on a 0..1 field (separable), used for morphology. */
function boxBlur(src: Float32Array, W: number, H: number, r: number) {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    let acc = 0
    const row = y * W
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))]
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / (2 * r + 1)
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / (2 * r + 1)
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
    }
  }
  return out
}

/** Keep connected components larger than minSize; fill holes smaller than maxHole. */
function cleanComponents(m: Uint8Array, W: number, H: number, minSize: number, maxHole: number) {
  const label = new Int32Array(W * H).fill(-1)
  const stack: number[] = []
  const flood = (start: number, val: number, id: number) => {
    const px: number[] = []
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const i = stack.pop()!
      px.push(i)
      const x = i % W
      const y = (i / W) | 0
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]
      for (const n of nb) if (n >= 0 && label[n] === -1 && m[n] === val) (label[n] = id), stack.push(n)
    }
    return px
  }
  let id = 0
  for (let i = 0; i < m.length; i++) {
    if (label[i] !== -1) continue
    const val = m[i]
    const px = flood(i, val, id++)
    if (val === 1 && px.length < minSize) for (const p of px) m[p] = 0
    if (val === 0 && px.length < maxHole) {
      // holes = background components not touching the image border
      const touches = px.some((p) => p % W === 0 || p % W === W - 1 || p < W || p >= W * (H - 1))
      if (!touches) for (const p of px) m[p] = 1
    }
  }
}

/**
 * @param photo   the room photo pixels
 * @param rough   alpha (0..255) of the user's rough marking, same size as photo
 * @param surface optional alpha of the marked surfaces (used to sample the background)
 * @returns       refined alpha mask (0..255)
 */
export function refineObjectMask(photo: ImageData, rough: Uint8ClampedArray, surface?: Uint8ClampedArray): Uint8ClampedArray {
  const W = photo.width
  const H = photo.height
  const N = W * H
  const px = photo.data
  const inRough = new Uint8Array(N)
  let roughCount = 0
  for (let i = 0; i < N; i++) if (rough[i] > 20) (inRough[i] = 1), roughCount++
  const out = new Uint8ClampedArray(N)
  if (!roughCount) return out

  // background sample region: a ring around the rough marking (+ the surface, if known)
  const R = Math.max(6, Math.round(Math.max(W, H) / 60))
  const dil = boxBlur(Float32Array.from(inRough), W, H, R)
  const lab = new Array<Lab>(N)
  const getLab = (i: number) => lab[i] ?? (lab[i] = rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]))
  const bgS: Lab[] = []
  const fgS: Lab[] = []
  const step = Math.max(1, Math.round(Math.sqrt(N / 60000)))
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step) {
      const i = y * W + x
      if (inRough[i]) fgS.push(getLab(i))
      else if (dil[i] > 0.001 || (surface && surface[i] > 128 && (x + y) % (step * 3) === 0)) bgS.push(getLab(i))
    }
  let bg = kmeans(bgS, 6)
  let fg = kmeans(fgS, 6)
  // drop foreground clusters that are really the surface showing through the rough marking
  const prune = () => {
    const kept = fg.filter((c) => nearest(bg, c) > 6)
    fg = kept.length ? kept : fg
  }
  prune()

  // spatial prior: how deep a pixel lies inside the rough marking (1 = centre, ~0.5 = its edge).
  // Users mark around objects, so the centre is more likely object and the rim more likely surface.
  const depth = boxBlur(Float32Array.from(inRough), W, H, Math.max(3, Math.round(R / 1.5)))
  const obj = new Uint8Array(N)
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < N; i++) {
      if (!inRough[i]) {
        obj[i] = 0
        continue
      }
      const p = getLab(i)
      const db = nearest(bg, p)
      const df = nearest(fg, p)
      const prior = 14 * (depth[i] - 0.8)
      obj[i] = db > 3.5 && df < db + prior ? 1 : 0
    }
    if (round === 0) {
      // re-estimate both models from the classification (GrabCut-style iteration)
      const f2: Lab[] = []
      const b2: Lab[] = [...bgS]
      for (let i = 0; i < N; i += step * 2) {
        if (!inRough[i]) continue
        ;(obj[i] ? f2 : b2).push(getLab(i))
      }
      if (f2.length > 20) fg = kmeans(f2, 6)
      bg = kmeans(b2, 8)
      prune()
    }
  }

  // morphology: close small gaps, remove specks, fill holes
  const sm = boxBlur(Float32Array.from(obj), W, H, 2)
  const m = new Uint8Array(N)
  for (let i = 0; i < N; i++) m[i] = inRough[i] && sm[i] > 0.42 ? 1 : 0
  cleanComponents(m, W, H, Math.max(12, Math.round(roughCount * 0.004)), Math.round(roughCount * 0.03))
  // soft 1px edge
  const soft = boxBlur(Float32Array.from(m), W, H, 1)
  for (let i = 0; i < N; i++) out[i] = Math.round(Math.min(1, soft[i] * 1.15) * 255)
  return out
}

/** Canvas helper: refine a rough mask canvas against a photo; returns a new mask canvas (white + alpha). */
export function refineMaskCanvas(photo: CanvasImageSource, rough: HTMLCanvasElement, W: number, H: number, surfaceQuads: [number, number][][] = []) {
  const pc = document.createElement('canvas')
  pc.width = W
  pc.height = H
  const pctx = pc.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(photo, 0, 0, W, H)
  const photoData = pctx.getImageData(0, 0, W, H)
  const rctx = rough.getContext('2d', { willReadFrequently: true })!
  const rd = rctx.getImageData(0, 0, W, H).data
  const roughA = new Uint8ClampedArray(W * H)
  for (let i = 0; i < W * H; i++) roughA[i] = rd[i * 4 + 3]
  let surf: Uint8ClampedArray | undefined
  if (surfaceQuads.length) {
    const sc = document.createElement('canvas')
    sc.width = W
    sc.height = H
    const sctx = sc.getContext('2d', { willReadFrequently: true })!
    for (const q of surfaceQuads) {
      sctx.beginPath()
      q.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)))
      sctx.fill()
    }
    const sd = sctx.getImageData(0, 0, W, H).data
    surf = new Uint8ClampedArray(W * H)
    for (let i = 0; i < W * H; i++) surf[i] = sd[i * 4 + 3]
  }
  const a = refineObjectMask(photoData, roughA, surf)
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const octx = out.getContext('2d')!
  const img = octx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 40
    img.data[i * 4 + 2] = 120
    img.data[i * 4 + 3] = a[i]
  }
  octx.putImageData(img, 0, 0)
  return out
}
