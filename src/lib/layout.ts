import type { Paint, Product, SurfaceSettings } from '../types'
import { getTileVariants, hashStr, rng, shade } from './tileArt'

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
  { id: 'stack', label: 'Vertical Stack', hint: 'Tiles turned 90°' },
  { id: 'checkered', label: 'Checkered', hint: 'Alternating tone' },
  { id: 'herringbone', label: 'Herringbone', hint: 'Best for planks' },
  { id: 'quarter', label: 'Quarter Turn', hint: 'Rotate each tile' },
  { id: 'diagonal', label: 'Diagonal', hint: '45° lay' },
]

export const GROUT_COLORS = ['#f4f2ec', '#d8d4cc', '#a9a69f', '#6c6a66', '#2e2d2b', '#c9b48f', '#8c6f52']

/** pixels per metre for a surface so that its long side fits the max texture size */
export const pxPerMetre = (sizeM: [number, number], max = 2048) => Math.min(420, max / Math.max(sizeM[0], sizeM[1]))

/**
 * Render a full surface (in real-world metres) covered with the given product
 * and layout settings. Returns a canvas whose pixels map 1:1 onto the surface.
 */
export async function renderTiledSurface(
  product: Product,
  settings: SurfaceSettings,
  sizeM: [number, number],
  maxTex = 2048,
): Promise<HTMLCanvasElement> {
  const ppm = pxPerMetre(sizeM, maxTex)
  const W = Math.max(2, Math.round(sizeM[0] * ppm))
  const H = Math.max(2, Math.round(sizeM[1] * ppm))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = settings.groutColor
  ctx.fillRect(0, 0, W, H)

  const variants = await getTileVariants(product, 384)
  const r = rng(hashStr(product.id + settings.layout))
  const pick = () => variants[Math.floor(r() * variants.length)]

  let tw = (product.size[0] / 100) * ppm
  let th = (product.size[1] / 100) * ppm
  const g = settings.groutMm > 0 ? Math.max(0.7, (settings.groutMm / 1000) * ppm) : 0

  const angle = (settings.layout === 'diagonal' ? 45 : 0) + settings.rotation
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((angle * Math.PI) / 180)
  // Cover the rotated canvas: work in a square region of side = diagonal
  const D = Math.hypot(W, H)
  const x0 = -D / 2
  const y0 = -D / 2

  const drawTile = (img: HTMLCanvasElement, x: number, y: number, w: number, h: number, rot = 0, darken = 0) => {
    if (x > D / 2 || y > D / 2 || x + w < -D / 2 || y + h < -D / 2) return
    const ix = x + g / 2
    const iy = y + g / 2
    const iw = Math.max(0.5, w - g)
    const ih = Math.max(0.5, h - g)
    ctx.save()
    if (darken) ctx.filter = `brightness(${1 - darken})`
    if (rot) {
      ctx.translate(ix + iw / 2, iy + ih / 2)
      ctx.rotate((rot * Math.PI) / 180)
      const swap = rot % 180 !== 0
      const dw = swap ? ih : iw
      const dh = swap ? iw : ih
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    } else {
      ctx.drawImage(img, ix, iy, iw, ih)
    }
    ctx.restore()
  }

  if (product.material === 'Hexagon') {
    // pointy-top hex grid; tile width = flat-to-flat
    const hw = tw
    const hr = hw / Math.sqrt(3)
    const vstep = hr * 1.5
    let row = 0
    for (let y = y0 - hr; y < D / 2 + hr; y += vstep, row++) {
      for (let x = x0 - hw + (row % 2 ? hw / 2 : 0); x < D / 2 + hw; x += hw) {
        const cx = x + hw / 2
        const cy = y
        const rr = hr - g / 1.5
        ctx.save()
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const an = (Math.PI / 3) * i + Math.PI / 6
          ctx.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr)
        }
        ctx.closePath()
        ctx.clip()
        const img = pick()
        ctx.drawImage(img, cx - hr, cy - hr, hr * 2, hr * 2)
        ctx.restore()
      }
    }
    ctx.restore()
    return canvas
  }

  switch (settings.layout) {
    case 'herringbone': {
      // Long side L, short side S. Staircase of vertical + horizontal tiles,
      // repeated along lattice vector (L, -L). Verified gap/overlap free.
      const L = Math.max(tw, th)
      const S = Math.min(tw, th)
      const img = pick
      const span = Math.ceil(D / S) + 4
      const reps = Math.ceil((2 * D) / L) + 4
      for (let m = -reps; m <= reps; m++) {
        for (let k = -span; k <= span; k++) {
          const ox = x0 + m * L + k * S
          const oy = y0 - m * L + k * S
          // vertical tile S x L
          drawTile(img(), ox, oy, S, L, th >= tw ? 0 : 90)
          // horizontal tile L x S
          drawTile(img(), ox + S, oy, L, S, th >= tw ? 90 : 0)
        }
      }
      break
    }
    case 'stack': {
      ;[tw, th] = [th, tw]
      for (let y = y0; y < D / 2; y += th) for (let x = x0; x < D / 2; x += tw) drawTile(pick(), x, y, tw, th, 90)
      break
    }
    case 'brick': {
      let row = 0
      for (let y = y0; y < D / 2; y += th, row++) {
        const off = row % 2 ? tw / 2 : 0
        for (let x = x0 - off; x < D / 2; x += tw) drawTile(pick(), x, y, tw, th)
      }
      break
    }
    case 'checkered': {
      let i = 0
      for (let y = y0; y < D / 2; y += th, i++) {
        let j = 0
        for (let x = x0; x < D / 2; x += tw, j++) drawTile(pick(), x, y, tw, th, 0, (i + j) % 2 ? 0.22 : 0)
      }
      break
    }
    case 'quarter': {
      const square = Math.abs(tw - th) < 0.5
      let i = 0
      for (let y = y0; y < D / 2; y += th, i++) {
        let j = 0
        for (let x = x0; x < D / 2; x += tw, j++) {
          const rot = square ? ((i % 2) * 2 + (j % 2)) * 90 : ((i + j) % 2) * 180
          drawTile(pick(), x, y, tw, th, rot)
        }
      }
      break
    }
    case 'grid':
    case 'diagonal':
    default: {
      for (let y = y0; y < D / 2; y += th) for (let x = x0; x < D / 2; x += tw) drawTile(pick(), x, y, tw, th)
    }
  }
  ctx.restore()
  return canvas
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
