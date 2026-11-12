import type { Material, Paint, Product, SurfaceSettings } from '../types'
import { getTileVariants, hashStr, rng, shade, SLAB_GRID } from './tileArt'

export const DEFAULT_SETTINGS: SurfaceSettings = {
  layout: 'grid',
  rotation: 0,
  groutColor: '#d8d4cc',
  groutMm: 2,
  finish: 'matt',
}

export const LAYOUTS: { id: SurfaceSettings['layout']; label: string; hint: string }[] = [
  { id: 'grid', label: 'Grid', hint: 'Straight lay' },
  { id: 'brick', label: 'Brick', hint: '1/2 offset' },
  { id: 'third', label: '1/3 Offset', hint: 'Stretcher bond, 1/3 offset' },
  { id: 'random', label: 'Random', hint: 'Random plank offsets' },
  { id: 'stack', label: 'Vertical Stack', hint: 'Tiles turned 90°' },
  { id: 'checkered', label: 'Checkered', hint: 'Alternating tone' },
  { id: 'herringbone', label: 'Herringbone', hint: 'Best for planks' },
  { id: 'quarter', label: 'Quarter Turn', hint: 'Rotate each tile' },
  { id: 'diagonal', label: 'Diagonal', hint: '45° lay' },
  { id: 'bookmatch', label: 'Bookmatch', hint: 'Mirror side-by-side slabs' },
  { id: 'endmatch', label: 'Endmatch', hint: 'Mirror slabs end-to-end' },
  { id: 'quadmatch', label: '4-Slab Match', hint: 'Mirror four slabs around a centre' },
]

export const GROUT_COLORS = ['#f4f2ec', '#d8d4cc', '#a9a69f', '#6c6a66', '#2e2d2b', '#c9b48f', '#8c6f52']

/** How much the tone of individual tiles varies, per material (natural / handmade products vary more). */
const TONE: Record<Material, number> = { Marble: 0.03, Wood: 0.07, Stone: 0.06, Concrete: 0.04, Terrazzo: 0.03, Ceramic: 0.025, Mosaic: 0, Pattern: 0.02, Hexagon: 0.04, Subway: 0.09, Wallpaper: 0, Panel: 0.03, Rug: 0, Custom: 0 }
/** Materials whose tiles may be laid turned 180° to break up repetition. */
const NATURAL = new Set<Material>(['Stone', 'Concrete', 'Terrazzo', 'Wood'])
/** Handmade-look products get surface relief (wavy glaze) in the depth map. */
const HANDMADE = new Set<Material>(['Subway'])

/** pixels per metre for a surface so that its long side fits the max texture size */
export const pxPerMetre = (sizeM: [number, number], max = 2048) => Math.min(420, max / Math.max(sizeM[0], sizeM[1]))

interface Place {
  x: number
  y: number
  w: number
  h: number
  rot?: number
  flipX?: boolean
  flipY?: boolean
  darken?: number
  /** grid indices, used for continuous-vein slab cuts */
  i: number
  j: number
}

/** Enumerate tile placements for a layout inside a square of side D centred on the origin. */
function placements(layout: SurfaceSettings['layout'], tw: number, th: number, D: number, r: () => number, cb: (p: Place) => void, W = D, H = D) {
  // anchor the grid to the surface's top-left corner (as installers / the reference do), then extend
  // it to cover the whole rotated square so 45° layouts still fill the surface
  const cellW = layout === 'stack' ? Math.min(tw, th) : tw
  const cellH = layout === 'stack' ? Math.max(tw, th) : th
  const x0 = -W / 2 - Math.ceil((D - W) / 2 / cellW + 1) * cellW
  const y0 = -H / 2 - Math.ceil((D - H) / 2 / cellH + 1) * cellH
  const end = D / 2
  const rows = (fn: (y: number, j: number) => void) => {
    let j = 0
    for (let y = y0; y < end; y += th, j++) fn(y, j)
  }
  switch (layout) {
    case 'herringbone': {
      const L = Math.max(tw, th)
      const S = Math.min(tw, th)
      const portrait = th >= tw
      const span = Math.ceil(D / S) + 4
      const reps = Math.ceil((2 * D) / L) + 4
      // staircase of vertical + horizontal tiles repeated along (L, -L): verified gap/overlap free
      for (let m = -reps; m <= reps; m++)
        for (let k = -span; k <= span; k++) {
          const ox = x0 + m * L + k * S
          const oy = y0 - m * L + k * S
          cb({ x: ox, y: oy, w: S, h: L, rot: portrait ? 0 : 90, i: k, j: m })
          cb({ x: ox + S, y: oy, w: L, h: S, rot: portrait ? 90 : 0, i: k, j: m })
        }
      return
    }
    case 'stack': {
      // long side vertical, straight columns
      const S = Math.min(tw, th)
      const L = Math.max(tw, th)
      let j = 0
      for (let y = y0; y < end; y += L, j++) {
        let i = 0
        for (let x = x0; x < end; x += S, i++) cb({ x, y, w: S, h: L, rot: tw > th ? 90 : 0, i, j })
      }
      return
    }
    case 'brick':
    case 'third':
    case 'random': {
      const offset = (k: number) => (layout === 'brick' ? (k % 2) * 0.5 : layout === 'third' ? (k % 3) / 3 : r())
      if (th > tw) {
        // portrait tiles / planks: courses run along the long side, stagger the ends
        let i = 0
        for (let x = x0; x < end; x += tw, i++) {
          const off = offset(i)
          let j = 0
          for (let y = y0 - off * th; y < end; y += th, j++) cb({ x, y, w: tw, h: th, i, j })
        }
      } else
        rows((y, j) => {
          const off = offset(j)
          let i = 0
          for (let x = x0 - off * tw; x < end; x += tw, i++) cb({ x, y, w: tw, h: th, i, j })
        })
      return
    }
    case 'checkered':
      rows((y, j) => {
        let i = 0
        for (let x = x0; x < end; x += tw, i++) cb({ x, y, w: tw, h: th, darken: (i + j) % 2 ? 0.22 : 0, i, j })
      })
      return
    case 'quarter': {
      const square = Math.abs(tw - th) < 0.5
      rows((y, j) => {
        let i = 0
        for (let x = x0; x < end; x += tw, i++) cb({ x, y, w: tw, h: th, rot: square ? ((j % 2) * 2 + (i % 2)) * 90 : ((i + j) % 2) * 180, i, j })
      })
      return
    }
    case 'bookmatch':
    case 'endmatch':
    case 'quadmatch':
      rows((y, j) => {
        let i = 0
        for (let x = x0; x < end; x += tw, i++) cb({ x, y, w: tw, h: th, flipX: layout !== 'endmatch' && i % 2 === 1, flipY: layout !== 'bookmatch' && j % 2 === 1, i, j })
      })
      return
    case 'grid':
    case 'diagonal':
    default:
      rows((y, j) => {
        let i = 0
        for (let x = x0; x < end; x += tw, i++) cb({ x, y, w: tw, h: th, i, j })
      })
  }
}

export interface SurfaceMaps {
  color: HTMLCanvasElement
  /** tangent-space normal map: recessed grout, bevelled edges, handmade relief */
  normal: HTMLCanvasElement
  /** roughness map: grout rough, tile face per finish */
  roughness: HTMLCanvasElement
}

/**
 * Render a full surface (in real-world metres) covered with the given product
 * and layout settings. Returns canvases whose pixels map 1:1 onto the surface.
 */
export async function renderSurfaceMaps(product: Product, settings: SurfaceSettings, sizeM: [number, number], maxTex = 2048, withMaps = true): Promise<SurfaceMaps> {
  const ppm = pxPerMetre(sizeM, maxTex)
  const W = Math.max(2, Math.round(sizeM[0] * ppm))
  const H = Math.max(2, Math.round(sizeM[1] * ppm))
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    return c
  }
  const color = mk()
  const ctx = color.getContext('2d')!
  ctx.fillStyle = settings.groutColor
  ctx.fillRect(0, 0, W, H)
  if (settings.sparkle && settings.groutMm > 0) {
    const sr = rng(hashStr(product.id + 'sparkle'))
    const n = Math.round((W * H) / 18)
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = 0.5 + sr() * 0.5
      ctx.fillStyle = sr() < 0.7 ? settings.sparkle : '#ffffff'
      const sz = 0.6 + sr() * 1.1
      ctx.fillRect(sr() * W, sr() * H, sz, sz)
    }
    ctx.globalAlpha = 1
  }
  // height map: black = grout (recessed), white = tile face
  const height = withMaps ? mk() : null
  const hctx = height?.getContext('2d', { willReadFrequently: true }) ?? null
  if (hctx) {
    hctx.fillStyle = '#000'
    hctx.fillRect(0, 0, W, H)
  }

  const variants = await getTileVariants(product, 384)
  const seed = hashStr(product.id + settings.layout)
  const r = rng(seed)
  const tone = TONE[product.material] ?? 0
  const slab = variants.length === SLAB_GRID * SLAB_GRID && ['grid', 'diagonal', 'stack'].includes(settings.layout)
  const sameImage = ['bookmatch', 'endmatch', 'quadmatch'].includes(settings.layout)
  const turn180 = NATURAL.has(product.material) && ['grid', 'brick', 'third', 'random', 'diagonal'].includes(settings.layout)
  const handmade = HANDMADE.has(product.material)

  const tw = (product.size[0] / 100) * ppm
  const th = (product.size[1] / 100) * ppm
  const g = settings.groutMm > 0 ? Math.max(0.7, (settings.groutMm / 1000) * ppm) : 0
  // rectified / slab joints (0 mm grout) are butt-jointed: no bevel, so no visible seam in the relief
  const bevel = settings.groutMm > 0 ? Math.max(1, Math.min(tw, th) * 0.02) : 0
  const angle = (settings.layout === 'diagonal' ? 45 : 0) + settings.rotation
  const D = Math.hypot(W, H)
  const setup = (c: CanvasRenderingContext2D) => {
    c.save()
    c.translate(W / 2, H / 2)
    c.rotate((angle * Math.PI) / 180)
  }
  setup(ctx)
  if (hctx) setup(hctx)

  const inView = (x: number, y: number, w: number, h: number) => !(x > D / 2 || y > D / 2 || x + w < -D / 2 || y + h < -D / 2)

  const drawTile = (img: HTMLCanvasElement, p: Place, toneShift: number, extraRot: number) => {
    const ix = p.x + g / 2
    const iy = p.y + g / 2
    const iw = Math.max(0.5, p.w - g)
    const ih = Math.max(0.5, p.h - g)
    const rot = ((p.rot ?? 0) + extraRot) % 360
    const swap = rot % 180 !== 0
    const dw = swap ? ih : iw
    const dh = swap ? iw : ih
    ctx.save()
    const b = 1 - (p.darken ?? 0) + toneShift
    ctx.translate(ix + iw / 2, iy + ih / 2)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1)
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    // tone variation / checkered darkening as a translucent overlay (filters are very slow on CPU canvases)
    if (b !== 1) {
      ctx.globalAlpha = Math.min(1, Math.abs(1 - b))
      ctx.fillStyle = b < 1 ? '#000' : '#fff'
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh)
    }
    ctx.restore()
    if (hctx) {
      // bevelled face: dark rim fading to white
      hctx.save()
      hctx.translate(ix, iy)
      hctx.fillStyle = '#5a5a5a'
      hctx.fillRect(0, 0, iw, ih)
      hctx.fillStyle = '#b4b4b4'
      hctx.fillRect(bevel * 0.5, bevel * 0.5, iw - bevel, ih - bevel)
      hctx.fillStyle = '#ffffff'
      hctx.fillRect(bevel, bevel, iw - bevel * 2, ih - bevel * 2)
      if (handmade) {
        // gentle undulating glaze
        const rr = rng(hashStr(`${p.i},${p.j}`) + seed)
        for (let k = 0; k < 3; k++) {
          const cx = rr() * iw
          const cy = rr() * ih
          const rad = Math.max(iw, ih) * (0.4 + rr() * 0.5)
          const gr = hctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
          const v = rr() < 0.5 ? '0,0,0' : '255,255,255'
          gr.addColorStop(0, `rgba(${v},0.22)`)
          gr.addColorStop(1, `rgba(${v},0)`)
          hctx.fillStyle = gr
          hctx.fillRect(bevel, bevel, iw - bevel * 2, ih - bevel * 2)
        }
      }
      hctx.restore()
    }
  }

  if (product.material === 'Hexagon') {
    const hw = tw
    const hr = hw / Math.sqrt(3)
    const vstep = hr * 1.5
    let row = 0
    const hex = (c: CanvasRenderingContext2D, cx: number, cy: number, rr: number) => {
      c.beginPath()
      for (let i = 0; i < 6; i++) {
        const an = (Math.PI / 3) * i + Math.PI / 6
        c.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr)
      }
      c.closePath()
    }
    for (let y = -D / 2 - hr; y < D / 2 + hr; y += vstep, row++) {
      for (let x = -D / 2 - hw + (row % 2 ? hw / 2 : 0); x < D / 2 + hw; x += hw) {
        const cx = x + hw / 2
        const rr = hr - g / 1.5
        ctx.save()
        hex(ctx, cx, y, rr)
        ctx.clip()
        const t = (r() - 0.5) * 2 * tone
        ctx.drawImage(variants[Math.floor(r() * variants.length)], cx - hr, y - hr, hr * 2, hr * 2)
        if (t) {
          ctx.globalAlpha = Math.min(1, Math.abs(t))
          ctx.fillStyle = t < 0 ? '#000' : '#fff'
          ctx.fillRect(cx - hr, y - hr, hr * 2, hr * 2)
        }
        ctx.restore()
        if (hctx) {
          hctx.fillStyle = '#fff'
          hex(hctx, cx, y, rr)
          hctx.fill()
        }
      }
    }
  } else {
    const aligned = angle % 90 === 0 && settings.layout !== 'herringbone'
    placements(settings.layout, tw, th, D, r, (p) => {
      // consume random numbers in a fixed order so colour and depth agree
      const pickR = r()
      const toneR = r()
      const turnR = r()
      if (!inView(p.x, p.y, p.w, p.h)) return
      const img = sameImage ? variants[0] : slab ? variants[(((p.i % SLAB_GRID) + SLAB_GRID) % SLAB_GRID) + SLAB_GRID * (((p.j % SLAB_GRID) + SLAB_GRID) % SLAB_GRID)] : variants[Math.floor(pickR * variants.length)]
      drawTile(img, p, (toneR - 0.5) * 2 * tone, turn180 && turnR < 0.5 ? 180 : 0)
    }, aligned ? (angle % 180 === 0 ? W : H) : D, aligned ? (angle % 180 === 0 ? H : W) : D)
  }
  ctx.restore()
  hctx?.restore()

  if (!height || !hctx) return { color, normal: color, roughness: color }
  // relief maps at up to 1024px: visually identical, ~4x cheaper to generate
  const k = Math.min(1, 1024 / Math.max(W, H))
  let mctx = hctx
  let MW = W
  let MH = H
  if (k < 1) {
    MW = Math.max(2, Math.round(W * k))
    MH = Math.max(2, Math.round(H * k))
    const small = document.createElement('canvas')
    small.width = MW
    small.height = MH
    mctx = small.getContext('2d', { willReadFrequently: true })!
    mctx.drawImage(height, 0, 0, MW, MH)
  }
  return { color, normal: heightToNormal(mctx, MW, MH, (settings.groutMm > 0 ? 2.2 : 1.2) * Math.max(0.6, k)), roughness: heightToRoughness(mctx, MW, MH, settings.finish === 'glossy' ? 0.12 : 0.78) }
}

/** Convenience wrapper returning only the colour canvas. */
export async function renderTiledSurface(product: Product, settings: SurfaceSettings, sizeM: [number, number], maxTex = 2048) {
  return (await renderSurfaceMaps(product, settings, sizeM, maxTex, false)).color
}

function heightToNormal(hctx: CanvasRenderingContext2D, W: number, H: number, strength: number) {
  const src = hctx.getImageData(0, 0, W, H).data
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const octx = out.getContext('2d')!
  const img = octx.createImageData(W, H)
  const d = img.data
  const h = (x: number, y: number) => src[((Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4)] / 255
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * W + x) * 4
      d[i] = (-dx / len) * 127.5 + 127.5
      d[i + 1] = (dy / len) * 127.5 + 127.5
      d[i + 2] = (1 / len) * 127.5 + 127.5
      d[i + 3] = 255
    }
  octx.putImageData(img, 0, 0)
  return out
}

function heightToRoughness(hctx: CanvasRenderingContext2D, W: number, H: number, face: number) {
  const src = hctx.getImageData(0, 0, W, H).data
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const octx = out.getContext('2d')!
  const img = octx.createImageData(W, H)
  const d = img.data
  for (let i = 0; i < W * H; i++) {
    const t = src[i * 4] / 255 // 1 = tile face, 0 = grout
    const v = 255 * (face * t + 0.95 * (1 - t))
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  return out
}

/** A small, slightly textured canvas for paint finishes (tiled with RepeatWrapping). */
export function renderPaint(paint: Paint): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = paint.hex
  ctx.fillRect(0, 0, 128, 128)
  const r = rng(hashStr(paint.id))
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = r() < 0.5 ? shade(paint.hex, 6) : shade(paint.hex, -6)
    ctx.globalAlpha = 0.35
    ctx.fillRect(r() * 128, r() * 128, 1.5, 1.5)
  }
  return c
}
