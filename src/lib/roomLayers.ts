/**
 * Layered room model for photo rooms (same structure as tilesview's room assets):
 *
 *   original  – the clean room photo
 *   matt      – the same photo as a CUT-OUT: transparent where tiles go, opaque everywhere else
 *               (furniture, objects, untiled walls). Inside the transparent area it keeps the
 *               room's shadows as semi-transparent black, so they fall on top of any new tile.
 *   glossy    – same cut-out plus soft specular highlights (sheen/reflections) for glossy finishes
 *
 * Render order: original → tiles (perspective) → cut-out overlay (matt or glossy per surface).
 *
 * Overlays can be uploaded (made in an editor / AI background remover) or generated here from the
 * marked surface quads + object mask.
 */
import { pointInQuad, type Pt } from './homography'

export interface RoomLayers {
  matt: string
  glossy: string
  source: 'generated' | 'uploaded'
}

const canvas = (W: number, H: number) => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return c
}

/**
 * Generate matt + glossy cut-out overlays.
 * @param quads       surface quads in pixel coords
 * @param objMask     optional object layer (opaque = object in front, kept in the overlay)
 * @param surfaceMask optional explicit surface alpha (e.g. from an uploaded cut-out); otherwise quads
 */
export function generateLayers(photo: CanvasImageSource, W: number, H: number, quads: Pt[][], objMask?: CanvasImageSource | null, surfaceMask?: Uint8ClampedArray): RoomLayers {
  const base = canvas(W, H)
  const bctx = base.getContext('2d', { willReadFrequently: true })!
  bctx.drawImage(photo, 0, 0, W, H)
  const src = bctx.getImageData(0, 0, W, H)

  // blurred luminance = the room's light, without the old surface texture
  const bl = canvas(W, H)
  const blctx = bl.getContext('2d', { willReadFrequently: true })!
  blctx.filter = `blur(${Math.max(2, W / 200)}px)`
  blctx.drawImage(photo, 0, 0, W, H)
  const blur = blctx.getImageData(0, 0, W, H).data

  // surface coverage (feathered) and object coverage
  let surf: Uint8ClampedArray
  if (surfaceMask) surf = surfaceMask
  else {
    const sc = canvas(W, H)
    const sctx = sc.getContext('2d', { willReadFrequently: true })!
    sctx.filter = `blur(${Math.max(0.6, W / 1400)}px)`
    sctx.fillStyle = '#000'
    for (const q of quads) {
      sctx.beginPath()
      q.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)))
      sctx.closePath()
      sctx.fill()
    }
    const sd = sctx.getImageData(0, 0, W, H).data
    surf = new Uint8ClampedArray(W * H)
    for (let i = 0; i < W * H; i++) surf[i] = sd[i * 4 + 3]
  }
  let obj: Uint8ClampedArray | null = null
  if (objMask) {
    const oc = canvas(W, H)
    const octx = oc.getContext('2d', { willReadFrequently: true })!
    octx.filter = `blur(${Math.max(0.5, W / 1600)}px)`
    octx.drawImage(objMask, 0, 0, W, H)
    const od = octx.getImageData(0, 0, W, H).data
    obj = new Uint8ClampedArray(W * H)
    for (let i = 0; i < W * H; i++) obj[i] = od[i * 4 + 3]
  }

  // per-surface mean light (so the new tile keeps its true colour on average)
  const surfId = new Int16Array(W * H).fill(-1)
  const sums = quads.map(() => [0, 0])
  const step = 2
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (surf[i] < 8) continue
      let id = quads.findIndex((q) => pointInQuad([x, y], q))
      if (id < 0) id = 0
      surfId[i] = id
      if (x % step === 0 && y % step === 0 && (!obj || obj[i] < 128) && quads.length) {
        sums[id][0] += 0.299 * blur[i * 4] + 0.587 * blur[i * 4 + 1] + 0.114 * blur[i * 4 + 2]
        sums[id][1]++
      }
    }
  const means = sums.map(([s, n]) => Math.max(8, n ? s / n : 128))
  const globalMean = Math.max(8, sums.reduce((a, [s]) => a + s, 0) / Math.max(1, sums.reduce((a, [, n]) => a + n, 0)))

  const matt = new ImageData(W, H)
  const gloss = new ImageData(W, H)
  const m = matt.data
  const g = gloss.data
  const p = src.data
  for (let i = 0; i < W * H; i++) {
    const k = i * 4
    const s = surf[i] / 255 // 1 = surface (tiles go here)
    const o = obj ? obj[i] / 255 : 0 // 1 = object in front
    const hole = s * (1 - o) // how much of this pixel is replaced by tiles
    // light relative to the surface mean
    const mean = surfId[i] >= 0 ? means[surfId[i]] : globalMean
    const L = 0.299 * blur[k] + 0.587 * blur[k + 1] + 0.114 * blur[k + 2]
    const r = L / mean
    const shadowA = Math.min(0.78, Math.max(0, (1 - r) * 0.95)) // darker than average → shadow
    // brighter than average: daylight patches (any finish) and, for glossy, stronger specular sheen
    const lightA = Math.min(0.32, Math.max(0, (r - 1) * 0.5))
    const sheenA = Math.min(0.6, Math.max(0, (r - 1) * 0.85))
    // matt: opaque photo outside the hole; inside, black shadow alpha + soft white light alpha
    const aPhoto = 1 - hole
    const mA = Math.min(1, aPhoto + hole * (shadowA + lightA))
    const mWhite = hole * lightA * 255
    m[k] = mA ? (p[k] * aPhoto + mWhite) / mA : 0
    m[k + 1] = mA ? (p[k + 1] * aPhoto + mWhite) / mA : 0
    m[k + 2] = mA ? (p[k + 2] * aPhoto + mWhite) / mA : 0
    m[k + 3] = mA * 255
    // glossy: shadows + white highlights
    const shade = hole * (shadowA + sheenA)
    const gA = aPhoto + shade
    const white = hole * sheenA * 255
    g[k] = gA ? (p[k] * aPhoto + white) / gA : 0
    g[k + 1] = gA ? (p[k + 1] * aPhoto + white) / gA : 0
    g[k + 2] = gA ? (p[k + 2] * aPhoto + white) / gA : 0
    g[k + 3] = Math.min(1, gA) * 255
  }
  const mc = canvas(W, H)
  mc.getContext('2d')!.putImageData(matt, 0, 0)
  const gc = canvas(W, H)
  gc.getContext('2d')!.putImageData(gloss, 0, 0)
  return { matt: mc.toDataURL('image/png'), glossy: gc.toDataURL('image/png'), source: 'generated' }
}

/** Alpha of the transparent (tile) area of an uploaded cut-out: 255 where tiles go. */
export function surfaceMaskFromCutout(cutout: CanvasImageSource, W: number, H: number) {
  const c = canvas(W, H)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(cutout, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const out = new Uint8ClampedArray(W * H)
  for (let i = 0; i < W * H; i++) out[i] = 255 - d[i * 4 + 3]
  return out
}
