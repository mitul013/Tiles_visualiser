import type { Product, TileArt } from '../types'

/** Deterministic PRNG so the same product always looks the same. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

export const hashStr = (str: string) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const mkCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, maxR: number, alpha: number, r: () => number) {
  ctx.save()
  for (let i = 0; i < count; i++) {
    const x = r() * w
    const y = r() * h
    const rad = maxR * (0.3 + r() * 0.7)
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    ctx.globalAlpha = alpha * (0.4 + r() * 0.6)
    g.addColorStop(0, color)
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  ctx.restore()
}

function veins(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, width: number, alpha: number, r: () => number) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  for (let v = 0; v < count; v++) {
    let x = r() * w
    let y = r() < 0.5 ? -10 : r() * h
    let ang = Math.PI * (0.15 + r() * 0.7)
    const steps = 40 + Math.floor(r() * 60)
    const stepLen = Math.max(w, h) / 45
    let lw = width * (0.4 + r() * 1.2)
    ctx.globalAlpha = alpha * (0.5 + r() * 0.5)
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let i = 0; i < steps; i++) {
      ang += (r() - 0.5) * 0.7
      x += Math.cos(ang) * stepLen
      y += Math.sin(ang) * stepLen
      ctx.lineTo(x, y)
      // occasional branch
      if (r() < 0.04) {
        ctx.stroke()
        ctx.lineWidth = lw * 0.5
        ctx.beginPath()
        ctx.moveTo(x, y)
        let bx = x
        let by = y
        let ba = ang + (r() - 0.5) * 2
        for (let j = 0; j < 12; j++) {
          ba += (r() - 0.5) * 0.6
          bx += Math.cos(ba) * stepLen * 0.7
          by += Math.sin(ba) * stepLen * 0.7
          ctx.lineTo(bx, by)
        }
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, y)
      }
      lw = Math.max(0.4, lw + (r() - 0.5) * 0.4)
      ctx.lineWidth = lw
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawMarble(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = a.base
  ctx.fillRect(0, 0, w, h)
  blotches(ctx, w, h, a.accent, 10, Math.max(w, h) * 0.5, 0.12, r)
  ctx.filter = `blur(${Math.max(1, w / 160)}px)`
  veins(ctx, w, h, a.accent, 5, w / 90, 0.35, r)
  ctx.filter = 'none'
  veins(ctx, w, h, a.accent, 4, w / 260, 0.7, r)
  if (a.accent2) veins(ctx, w, h, a.accent2, 2, w / 300, 0.6, r)
  noise(ctx, w, h, 8, r)
}

function drawWood(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  // grain runs along the long axis; we always draw vertically then the caller rotates
  const vertical = h >= w
  ctx.save()
  if (!vertical) {
    ctx.translate(w, 0)
    ctx.rotate(Math.PI / 2)
    ;[w, h] = [h, w]
  }
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, a.base)
  g.addColorStop(0.5, shade(a.base, (r() - 0.5) * 18))
  g.addColorStop(1, a.base)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = a.accent
  const lines = Math.round(w / 2.2)
  for (let i = 0; i < lines; i++) {
    let x = r() * w
    ctx.globalAlpha = 0.08 + r() * 0.25
    ctx.lineWidth = 0.4 + r() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, 0)
    const amp = r() * 3
    const freq = 0.002 + r() * 0.01
    const ph = r() * 10
    for (let y = 0; y <= h; y += 8) {
      ctx.lineTo(x + Math.sin(y * freq + ph) * amp, y)
    }
    ctx.stroke()
    x += 1
  }
  // knots
  const knots = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0
  for (let k = 0; k < knots; k++) {
    const kx = w * (0.2 + r() * 0.6)
    const ky = r() * h
    for (let ring = 0; ring < 6; ring++) {
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(kx, ky, 2 + ring * 2.2, 5 + ring * 6, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
  noise(ctx, ctx.canvas.width, ctx.canvas.height, 10, r)
}

function drawStone(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = a.base
  ctx.fillRect(0, 0, w, h)
  blotches(ctx, w, h, a.accent, 30, Math.max(w, h) * 0.25, 0.35, r)
  blotches(ctx, w, h, shade(a.base, 25), 20, Math.max(w, h) * 0.2, 0.25, r)
  // pits / speckles
  for (let i = 0; i < (w * h) / 220; i++) {
    ctx.globalAlpha = 0.15 + r() * 0.3
    ctx.fillStyle = r() < 0.5 ? a.accent : shade(a.base, 30)
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2)
  }
  ctx.globalAlpha = 1
  noise(ctx, w, h, 22, r)
}

function drawConcrete(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = a.base
  ctx.fillRect(0, 0, w, h)
  blotches(ctx, w, h, a.accent, 18, Math.max(w, h) * 0.45, 0.2, r)
  blotches(ctx, w, h, shade(a.base, 15), 12, Math.max(w, h) * 0.35, 0.2, r)
  noise(ctx, w, h, 16, r)
}

function drawTerrazzo(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = a.base
  ctx.fillRect(0, 0, w, h)
  const chips = Math.round((w * h) / 260)
  const cols = [a.accent, a.accent2 ?? a.accent, shade(a.base, -25), shade(a.base, 20)]
  for (let i = 0; i < chips; i++) {
    const cx = r() * w
    const cy = r() * h
    const size = (r() < 0.9 ? 1.5 + r() * 4 : 5 + r() * 9) * (w / 300)
    ctx.fillStyle = cols[Math.floor(r() * cols.length)]
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    const pts = 5 + Math.floor(r() * 3)
    for (let p = 0; p < pts; p++) {
      const an = (p / pts) * Math.PI * 2
      const rad = size * (0.6 + r() * 0.5)
      const px = cx + Math.cos(an) * rad
      const py = cy + Math.sin(an) * rad
      if (p === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
  noise(ctx, w, h, 8, r)
}

function drawSolid(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, shade(a.base, 6 + r() * 4))
  g.addColorStop(1, a.accent)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  blotches(ctx, w, h, a.accent, 4, Math.max(w, h) * 0.6, 0.25, r)
  // soft bevel
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.02)
  ctx.strokeRect(0, 0, w, h)
  noise(ctx, w, h, 5, r)
}

function drawMosaic(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = '#d9d6cf'
  ctx.fillRect(0, 0, w, h)
  const n = 12
  const cw = w / n
  const ch = h / n
  const cols = [a.base, a.accent, a.accent2 ?? a.base]
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = shade(cols[Math.floor(r() * cols.length)], (r() - 0.5) * 20)
      ctx.fillRect(i * cw + cw * 0.06, j * ch + ch * 0.06, cw * 0.88, ch * 0.88)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(i * cw + cw * 0.1, j * ch + ch * 0.1, cw * 0.3, ch * 0.15)
    }
  noise(ctx, w, h, 6, r)
}

function drawPattern(ctx: CanvasRenderingContext2D, w: number, h: number, a: TileArt, r: () => number) {
  ctx.fillStyle = a.base
  ctx.fillRect(0, 0, w, h)
  const s = Math.min(w, h)
  const c = s / 2
  ctx.save()
  ctx.fillStyle = a.accent
  ctx.strokeStyle = a.accent
  const a2 = a.accent2 ?? a.accent
  switch (a.motif) {
    case 'star': {
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) {
        ctx.beginPath()
        ctx.arc(x, y, s * 0.32, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = a2
      ctx.beginPath()
      for (let i = 0; i < 16; i++) {
        const rad = i % 2 ? s * 0.16 : s * 0.36
        const an = (i / 16) * Math.PI * 2
        ctx.lineTo(c + Math.cos(an) * rad, c + Math.sin(an) * rad)
      }
      ctx.fill()
      ctx.fillStyle = a.base
      ctx.beginPath()
      ctx.arc(c, c, s * 0.08, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'flower': {
      ctx.fillStyle = a2
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2
        ctx.beginPath()
        ctx.ellipse(c + Math.cos(an) * s * 0.2, c + Math.sin(an) * s * 0.2, s * 0.14, s * 0.06, an, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = a.accent
      ctx.beginPath()
      ctx.arc(c, c, s * 0.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = s * 0.03
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) {
        ctx.beginPath()
        ctx.arc(x, y, s * 0.22, 0, Math.PI * 2)
        ctx.stroke()
      }
      break
    }
    case 'diamond': {
      ctx.beginPath()
      ctx.moveTo(c, 0)
      ctx.lineTo(s, c)
      ctx.lineTo(c, s)
      ctx.lineTo(0, c)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = a2
      ctx.beginPath()
      ctx.moveTo(c, s * 0.2)
      ctx.lineTo(s * 0.8, c)
      ctx.lineTo(c, s * 0.8)
      ctx.lineTo(s * 0.2, c)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = a.base
      ctx.fillRect(c - s * 0.07, c - s * 0.07, s * 0.14, s * 0.14)
      break
    }
    case 'arc': {
      ctx.lineWidth = s * 0.05
      for (let i = 1; i <= 4; i++) {
        ctx.strokeStyle = i % 2 ? a.accent : a2
        ctx.beginPath()
        ctx.arc(0, s, s * 0.22 * i, -Math.PI / 2, 0)
        ctx.stroke()
      }
      ctx.fillStyle = a2
      ctx.beginPath()
      ctx.arc(s, 0, s * 0.25, Math.PI / 2, Math.PI)
      ctx.lineTo(s, 0)
      ctx.fill()
      break
    }
    case 'cross':
    default: {
      ctx.fillRect(c - s * 0.08, 0, s * 0.16, s)
      ctx.fillRect(0, c - s * 0.08, s, s * 0.16)
      ctx.fillStyle = a2
      for (const [x, y] of [[c * 0.5, c * 0.5], [c * 1.5, c * 0.5], [c * 0.5, c * 1.5], [c * 1.5, c * 1.5]]) {
        ctx.beginPath()
        ctx.moveTo(x, y - s * 0.12)
        ctx.lineTo(x + s * 0.12, y)
        ctx.lineTo(x, y + s * 0.12)
        ctx.lineTo(x - s * 0.12, y)
        ctx.fill()
      }
      break
    }
  }
  ctx.restore()
  noise(ctx, w, h, 12, r)
}

export function shade(hex: string, amt: number) {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((x) => x + x).join('') : m, 16)
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const R = cl(((n >> 16) & 255) + amt)
  const G = cl(((n >> 8) & 255) + amt)
  const B = cl((n & 255) + amt)
  return `#${((R << 16) | (G << 8) | B).toString(16).padStart(6, '0')}`
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(src: string) {
  let p = imageCache.get(src)
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => res(img)
      img.onerror = rej
      img.src = src
    })
    imageCache.set(src, p)
  }
  return p
}

const VARIANTS = 4
const variantCache = new Map<string, Promise<HTMLCanvasElement[]>>()

/**
 * Returns several face variants for a product, each sized so the longest side
 * is `res` pixels and the aspect matches the real tile.
 */
export function getTileVariants(p: Product, res = 384): Promise<HTMLCanvasElement[]> {
  const key = `${p.id}:${res}:${p.art.imageUrl?.length ?? 0}`
  let v = variantCache.get(key)
  if (v) return v
  v = (async () => {
    const [cw, ch] = p.size
    const k = res / Math.max(cw, ch)
    const w = cw * k
    const h = ch * k
    const out: HTMLCanvasElement[] = []
    const img = p.art.kind === 'image' && p.art.imageUrl ? await loadImage(p.art.imageUrl) : null
    for (let i = 0; i < (img ? 1 : VARIANTS); i++) {
      const c = mkCanvas(w, h)
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      const r = rng(hashStr(p.name) + i * 7919)
      const a = p.art
      if (img) ctx.drawImage(img, 0, 0, c.width, c.height)
      else if (a.kind === 'marble') drawMarble(ctx, c.width, c.height, a, r)
      else if (a.kind === 'wood') drawWood(ctx, c.width, c.height, a, r)
      else if (a.kind === 'stone') drawStone(ctx, c.width, c.height, a, r)
      else if (a.kind === 'concrete') drawConcrete(ctx, c.width, c.height, a, r)
      else if (a.kind === 'terrazzo') drawTerrazzo(ctx, c.width, c.height, a, r)
      else if (a.kind === 'mosaic') drawMosaic(ctx, c.width, c.height, a, r)
      else if (a.kind === 'pattern') drawPattern(ctx, c.width, c.height, a, r)
      else if (a.kind === 'hexagon') {
        const base = a.accent2 && i % 2 ? a.accent : a.base
        drawSolid(ctx, c.width, c.height, { ...a, base, accent: shade(base, -8) }, r)
        if (a.accent2) veins(ctx, c.width, c.height, a.accent2, 2, c.width / 150, 0.5, r)
      } else drawSolid(ctx, c.width, c.height, a, r)
      out.push(c)
    }
    return out
  })()
  variantCache.set(key, v)
  return v
}

const swatchCache = new Map<string, Promise<string>>()
/** Small square-ish preview image (data URL) for UI lists. */
export function getSwatch(p: Product): Promise<string> {
  const key = `${p.id}:${p.art.imageUrl?.length ?? 0}`
  let s = swatchCache.get(key)
  if (!s) {
    // a real mini-layout of the tile (with grout) so proportions read correctly
    s = (async () => {
      const { renderTiledSurface, DEFAULT_SETTINGS } = await import('./layout')
      const [w, h] = p.size.map((x) => x / 100)
      const side = Math.max(0.3, Math.min(1.25, 2.5 * Math.min(w, h)))
      const plank = p.material === 'Wood' || p.material === 'Subway'
      const c = await renderTiledSurface(p, { ...DEFAULT_SETTINGS, layout: plank ? 'brick' : 'grid', groutMm: p.material === 'Wood' ? 1 : 2 }, [side, side], 320)
      return c.toDataURL('image/jpeg', 0.85)
    })()
    swatchCache.set(key, s)
  }
  return s
}
