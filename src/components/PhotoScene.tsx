import { useEffect, useRef, useState } from 'react'
import { findPaint, findProduct, useStore, type PhotoRoom } from '../store'
import { renderPaint, renderTiledSurface } from '../lib/layout'
import { loadImage } from '../lib/tileArt'
import { drawPerspective, pointInQuad, quadPath, type Pt } from '../lib/homography'
import type { Application, LightTheme } from '../types'

const TINT: Record<LightTheme, string | null> = { daylight: null, warm: 'rgba(255,170,80,0.10)', soft: 'rgba(255,220,180,0.08)', crystal: 'rgba(150,190,255,0.08)' }

interface Shading {
  x0: number
  y0: number
  w: number
  h: number
  /** per-pixel light factor; 1 = the surface's average light */
  f: Float32Array
}

/**
 * Lighting of one surface taken from the photo: luminance blurred slightly (to drop the old
 * tile's texture/grout) and normalised to the surface mean, so shadows darken and highlights
 * brighten the new tile while its average colour stays true.
 */
function shadingFor(photo: HTMLImageElement, q: Pt[], W: number, H: number, strength = 0.9): Shading {
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)))
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)))
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = `blur(${Math.max(2, W / 200)}px)`
  ctx.drawImage(photo, 0, 0, W, H)
  const d = ctx.getImageData(x0, y0, w, h).data
  const L = new Float32Array(w * h)
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
      if ((x % 2 === 0 && y % 2 === 0) && pointInQuad([x0 + x, y0 + y], q)) {
        sum += L[i]
        n++
      }
    }
  const mean = Math.max(8, n ? sum / n : 128)
  const f = new Float32Array(w * h)
  for (let i = 0; i < f.length; i++) f[i] = Math.min(1.8, 1 + strength * (L[i] / mean - 1))
  return { x0, y0, w, h, f }
}

function applyShading(lc: CanvasRenderingContext2D, s: Shading) {
  const img = lc.getImageData(s.x0, s.y0, s.w, s.h)
  const d = img.data
  for (let i = 0; i < s.f.length; i++) {
    const k = s.f[i]
    d[i * 4] = Math.min(255, d[i * 4] * k)
    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * k)
    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * k)
  }
  lc.putImageData(img, s.x0, s.y0)
}

function featherMask(q: Pt[], W: number, H: number) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.filter = `blur(${Math.max(0.6, W / 1400)}px)`
  quadPath(ctx, q)
  ctx.fillStyle = '#000'
  ctx.fill()
  return c
}

const objLayerCache = new Map<string, Promise<HTMLCanvasElement>>()
/** Photo pixels inside the object mask (with a slightly softened edge), ready to draw over the tiles. */
function objectLayer(photo: HTMLImageElement, mask: string, W: number, H: number) {
  const key = `${photo.src.length}:${mask.length}:${mask.slice(-64)}`
  let p = objLayerCache.get(key)
  if (!p) {
    p = loadImage(mask).then((m) => {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d')!
      ctx.filter = `blur(${Math.max(0.5, W / 1600)}px)`
      ctx.drawImage(m, 0, 0, W, H)
      ctx.filter = 'none'
      ctx.globalCompositeOperation = 'source-in'
      ctx.drawImage(photo, 0, 0, W, H)
      return c
    })
    objLayerCache.set(key, p)
  }
  return p
}

async function surfaceImage(app: Application, size: [number, number]) {
  if (app.kind === 'tile') {
    const p = findProduct(app.productId)
    return p ? renderTiledSurface(p, app.settings, size, 1600) : null
  }
  const paint = findPaint(app.paintId)
  if (!paint) return null
  const c = document.createElement('canvas')
  c.width = 512
  c.height = Math.round((512 * size[1]) / size[0])
  const ctx = c.getContext('2d')!
  ctx.fillStyle = ctx.createPattern(renderPaint(paint), 'repeat')!
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

export default function PhotoScene({ room }: { room: PhotoRoom }) {
  const applied = useStore((s) => s.applied)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.theme)
  const setCapture = useStore((s) => s.setCapture)
  const setOriginal = useStore((s) => s.setOriginalShot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const shading = useRef<Map<string, Shading>>(new Map())
  const [hover, setHover] = useState<string | null>(null)

  const W = room.width
  const H = room.height
  const quads = room.surfaces.map((s) => ({ ...s, q: s.quad.map(([x, y]) => [x * W, y * H] as Pt) }))

  // main composite
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const photo = await loadImage(room.image)
      const cv = canvasRef.current
      if (!cv || cancelled) return
      const layers: { q: Pt[]; img: HTMLCanvasElement; id: string; glossy: boolean }[] = []
      for (const s of quads) {
        const app = applied[s.id]
        if (!app) continue
        const img = await surfaceImage(app, s.size)
        if (img) layers.push({ q: s.q, img, id: s.id, glossy: (app.kind === 'tile' ? app.settings.finish : app.finish) === 'glossy' })
      }
      if (cancelled) return
      const ctx = cv.getContext('2d')!
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(photo, 0, 0, W, H)
      if (!useStore.getState().originalShot) setOriginal(cv.toDataURL('image/jpeg', 0.85))
      for (const l of layers) {
        const layer = document.createElement('canvas')
        layer.width = W
        layer.height = H
        const lc = layer.getContext('2d', { willReadFrequently: true })!
        drawPerspective(lc, l.img, l.q)
        let sh = shading.current.get(l.id)
        if (!sh) {
          sh = shadingFor(photo, l.q, W, H)
          shading.current.set(l.id, sh)
        }
        applyShading(lc, sh)
        if (l.glossy) {
          lc.globalCompositeOperation = 'screen'
          const g = lc.createLinearGradient(0, 0, W, H)
          g.addColorStop(0, 'rgba(255,255,255,0.10)')
          g.addColorStop(0.5, 'rgba(255,255,255,0)')
          g.addColorStop(1, 'rgba(255,255,255,0.06)')
          lc.fillStyle = g
          lc.fillRect(0, 0, W, H)
        }
        // feathered surface mask: soft 1-2px edge instead of a hard polygon cut
        lc.globalCompositeOperation = 'destination-in'
        lc.drawImage(featherMask(l.q, W, H), 0, 0)
        ctx.drawImage(layer, 0, 0)
      }
      // foreground objects go back on top of every new surface
      if (room.objMask) {
        const objs = await objectLayer(photo, room.objMask, W, H)
        ctx.drawImage(objs, 0, 0)
      }
      const tint = TINT[theme]
      if (tint) {
        ctx.fillStyle = tint
        ctx.fillRect(0, 0, W, H)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, theme, room.id, room.objMask])

  // selection overlay
  useEffect(() => {
    const ov = overlayRef.current
    if (!ov) return
    const ctx = ov.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    for (const s of quads) {
      const sel = selected.includes(s.id)
      if (!sel && hover !== s.id) continue
      quadPath(ctx, s.q)
      ctx.lineWidth = Math.max(2, W / 400)
      ctx.setLineDash(sel ? [] : [10, 8])
      ctx.strokeStyle = sel ? '#1e88ff' : 'rgba(255,255,255,0.9)'
      ctx.stroke()
      if (sel) {
        ctx.fillStyle = 'rgba(30,136,255,0.08)'
        ctx.fill()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hover, room.id])

  useEffect(() => {
    const capture = () => {
      const cv = canvasRef.current
      return cv ? cv.toDataURL('image/jpeg', 0.9) : ''
    }
    setCapture(capture)
    return () => {
      if (useStore.getState().capture === capture) setCapture(null)
    }
  }, [setCapture])

  const toImg = (e: React.MouseEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]
  }
  const hit = (p: Pt) => [...quads].reverse().find((s) => pointInQuad(p, s.q))

  return (
    <div className="scene-wrap photo">
      <div className="photo-stage" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvasRef} width={W} height={H} />
        <canvas
          ref={overlayRef}
          width={W}
          height={H}
          className="overlay"
          onMouseMove={(e) => setHover(hit(toImg(e))?.id ?? null)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const s = hit(toImg(e))
            if (!s) return
            const cur = useStore.getState().selected
            if (e.shiftKey || e.metaKey || e.ctrlKey) select(cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id])
            else select([s.id])
          }}
          style={{ cursor: hover ? 'pointer' : 'default' }}
        />
      </div>
      {hover && <div className="hover-tag">{room.surfaces.find((s) => s.id === hover)?.label} · click to select</div>}
    </div>
  )
}
