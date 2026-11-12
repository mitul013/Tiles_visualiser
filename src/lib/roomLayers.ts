/**
 * Layered room model for photo rooms (same structure as tilesview's room assets):
 *
 *   original   – the clean room photo
 *   cutout     – the photo with the tile area TRANSPARENT; objects, furniture and untiled parts
 *                stay opaque so they are never covered or recoloured (≈ wall_matt_floor_matt)
 *   shadow     – greyscale light map multiplied onto MATT surfaces (≈ shadow.A/B, multiply)
 *   reflection – stronger-contrast light map multiplied onto GLOSSY surfaces (≈ reflection.A/B)
 *   highlight  – brightening map applied with SCREEN blend (full on glossy, softer on matt)
 *
 * Render order (as in the reference): original → tiles → shadow|reflection per surface finish
 * (multiply) → highlight (screen) → cutout (normal alpha, on top).
 *
 * Every layer can be uploaded (prepared in an editor / AI tool) or generated from the photo using
 * the marked surface quads and object mask.
 */
import { pointInQuad, type Pt } from './homography'

export interface RoomLayers {
  cutout: string
  /** optional glossy cut-out (e.g. with soft reflections/shadows baked in), used inside glossy surfaces */
  cutoutGlossy?: string
  shadow: string
  reflection: string
  highlight: string
  source: 'generated' | 'uploaded' | 'mixed'
}

/** Layers saved by older versions only had matt/glossy cut-outs: regenerate those. */
export const isCurrentLayers = (l: unknown): l is RoomLayers => !!l && typeof (l as RoomLayers).cutout === 'string' && typeof (l as RoomLayers).shadow === 'string'

/** Separable min/max filter (erosion / dilation) with a square window of radius r. */
function morph(src: Float32Array<ArrayBufferLike>, W: number, H: number, r: number, op: (...v: number[]) => number) {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = src[y * W + x]
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) v = op(v, src[y * W + k])
      tmp[y * W + x] = v
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x]
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) v = op(v, tmp[k * W + x])
      out[y * W + x] = v
    }
  return out
}

/** Separable box blur (two passes ≈ smooth) of a luminance field. */
function smooth(src: Float32Array<ArrayBufferLike>, W: number, H: number, r: number) {
  let a = src
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(W * H)
    const out = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += a[y * W + Math.min(W - 1, Math.max(0, k))]
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc / (2 * r + 1)
        acc += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + x]
      for (let y = 0; y < H; y++) {
        out[y * W + x] = acc / (2 * r + 1)
        acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
      }
    }
    a = out
  }
  return a
}

const canvas = (W: number, H: number) => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return c
}

const alphaOf = (src: CanvasImageSource, W: number, H: number, blurPx = 0) => {
  const c = canvas(W, H)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  if (blurPx) ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(src, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const a = new Uint8ClampedArray(W * H)
  for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3]
  return a
}

/**
 * @param quads   surface quads in pixel coords (perspective + which surface a pixel belongs to)
 * @param objMask optional object layer (opaque = object in front)
 * @param cutout  optional uploaded cut-out: its transparent area defines the tile area exactly
 */
export function generateLayers(photo: CanvasImageSource, W: number, H: number, quads: Pt[][], objMask?: CanvasImageSource | null, cutout?: CanvasImageSource | null): RoomLayers {
  // --- tile area (hole): from an uploaded cut-out, or quads minus objects
  let hole: Float32Array
  if (cutout) {
    const a = alphaOf(cutout, W, H)
    hole = Float32Array.from(a, (v) => 1 - v / 255)
  } else {
    const sc = canvas(W, H)
    const sctx = sc.getContext('2d', { willReadFrequently: true })!
    sctx.filter = `blur(${Math.max(0.6, W / 1400)}px)`
    for (const q of quads) {
      sctx.beginPath()
      q.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)))
      sctx.closePath()
      sctx.fill()
    }
    const sd = sctx.getImageData(0, 0, W, H).data
    const obj = objMask ? alphaOf(objMask, W, H, Math.max(0.5, W / 1600)) : null
    hole = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) hole[i] = (sd[i * 4 + 3] / 255) * (obj ? 1 - obj[i] / 255 : 1)
  }

  // --- room light, estimated on a small working copy (light varies smoothly; this keeps big phone
  // photos fast). Morphological opening (erase thin bright lines: veins, specks) then closing
  // (erase thin dark lines: grout, joints) keeps broad light and object shadows; then smooth.
  const k = Math.min(1, 420 / Math.max(W, H))
  const w2 = Math.max(2, Math.round(W * k))
  const h2 = Math.max(2, Math.round(H * k))
  const lc0 = canvas(w2, h2)
  const l0ctx = lc0.getContext('2d', { willReadFrequently: true })!
  l0ctx.imageSmoothingQuality = 'high'
  l0ctx.drawImage(photo, 0, 0, w2, h2)
  const raw = l0ctx.getImageData(0, 0, w2, h2).data
  let L: Float32Array<ArrayBufferLike> = new Float32Array(w2 * h2)
  for (let i = 0; i < w2 * h2; i++) L[i] = 0.299 * raw[i * 4] + 0.587 * raw[i * 4 + 1] + 0.114 * raw[i * 4 + 2]
  // window large enough to erase thick veins / grout of the old surface (object shadows are larger)
  const rad = Math.max(2, Math.round(w2 / 70))
  L = morph(morph(L, w2, h2, rad, Math.min), w2, h2, rad, Math.max) // opening
  L = morph(morph(L, w2, h2, rad, Math.max), w2, h2, rad, Math.min) // closing
  L = smooth(L, w2, h2, Math.max(1, Math.round(w2 / 220)))

  // tile area + surface id at working resolution; mean light per surface
  const smallQuads = quads.map((q) => q.map(([x, y]) => [x * k, y * k] as Pt))
  const holeS = new Float32Array(w2 * h2)
  const surfId = new Int16Array(w2 * h2).fill(-1)
  const sums = quads.map(() => [0, 0])
  let gs = 0
  let gn = 0
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const i = y * w2 + x
      const fx = Math.min(W - 1, Math.round(x / k))
      const fy = Math.min(H - 1, Math.round(y / k))
      const hv = hole[fy * W + fx]
      holeS[i] = hv
      if (hv < 0.05) continue
      let id = smallQuads.findIndex((q) => pointInQuad([x, y], q))
      if (id < 0) id = 0
      surfId[i] = id
      if (hv > 0.9) {
        if (sums[id]) {
          sums[id][0] += L[i]
          sums[id][1]++
        }
        gs += L[i]
        gn++
      }
    }
  const gMean = Math.max(8, gn ? gs / gn : 128)
  const means = sums.map(([s, n]) => Math.max(8, n > 12 ? s / n : gMean))

  // --- cut-out (full res, PNG with alpha)
  const pc = canvas(W, H)
  const pctx = pc.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(photo, 0, 0, W, H)
  const cut = pctx.getImageData(0, 0, W, H)
  const cd = cut.data
  for (let i = 0; i < W * H; i++) cd[i * 4 + 3] = Math.round(255 * (1 - hole[i]))
  pctx.putImageData(cut, 0, 0)

  // --- light maps at working resolution (drawn scaled up, they're smooth): white = unchanged
  const mk = () => new ImageData(w2, h2)
  const shadow = mk()
  const refl = mk()
  const high = mk()
  for (let i = 0; i < w2 * h2; i++) {
    const o = i * 4
    const mean = surfId[i] >= 0 ? means[surfId[i]] : gMean
    const dark = Math.max(0, 1 - L[i] / mean)
    const s = Math.max(0.3, 1 - 0.9 * dark) // matt: soft, diffuse shadows
    const g = Math.max(0.25, 1 - 1.05 * dark) // glossy: crisper, deeper
    // highlights in absolute brightness (a ratio over-brightens dark surfaces)
    const h = Math.min(0.6, Math.max(0, ((L[i] - mean) / 255) * 1.4)) // sun patches / sheen
    shadow.data[o] = shadow.data[o + 1] = shadow.data[o + 2] = 255 * s
    refl.data[o] = refl.data[o + 1] = refl.data[o + 2] = 255 * g
    high.data[o] = high.data[o + 1] = high.data[o + 2] = 255 * h
    shadow.data[o + 3] = refl.data[o + 3] = high.data[o + 3] = 255
  }
  void holeS
  const toUrl = (img: ImageData) => {
    const c = canvas(w2, h2)
    c.getContext('2d')!.putImageData(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.9)
  }
  return { cutout: pc.toDataURL('image/png'), shadow: toUrl(shadow), reflection: toUrl(refl), highlight: toUrl(high), source: cutout ? 'mixed' : 'generated' }
}
