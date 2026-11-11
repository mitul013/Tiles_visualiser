import { useEffect, useRef, useState } from 'react'
import { findPaint, findProduct, useStore, type PhotoRoom } from '../store'
import { renderPaint, renderTiledSurface } from '../lib/layout'
import { loadImage } from '../lib/tileArt'
import { drawPerspective, pointInQuad, quadPath, type Pt } from '../lib/homography'
import type { Application, LightTheme } from '../types'

const TINT: Record<LightTheme, string | null> = { daylight: null, warm: 'rgba(255,170,80,0.10)', soft: 'rgba(255,220,180,0.08)', crystal: 'rgba(150,190,255,0.08)' }

/** Grayscale "lighting" layer for one surface: photo luminance normalised to the surface mean. */
function shadingFor(photo: HTMLImageElement, q: Pt[], W: number, H: number) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(photo, 0, 0, W, H)
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)))
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)))
  const bw = Math.max(1, x1 - x0)
  const bh = Math.max(1, y1 - y0)
  const img = ctx.getImageData(x0, y0, bw, bh)
  const d = img.data
  let sum = 0
  let n = 0
  for (let y = 0; y < bh; y += 3)
    for (let x = 0; x < bw; x += 3) {
      if (!pointInQuad([x0 + x, y0 + y], q)) continue
      const i = (y * bw + x) * 4
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      n++
    }
  const mean = n ? sum / n : 128
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    // keep shadows, cap highlights; blend toward neutral so texture stays visible
    const s = Math.min(1, l / (mean * 1.08))
    const v = Math.round(255 * (0.3 + 0.7 * s))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  out.getContext('2d')!.putImageData(img, x0, y0)
  return out
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
  const shading = useRef<Map<string, HTMLCanvasElement>>(new Map())
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
        const lc = layer.getContext('2d')!
        drawPerspective(lc, l.img, l.q)
        let sh = shading.current.get(l.id)
        if (!sh) {
          sh = shadingFor(photo, l.q, W, H)
          shading.current.set(l.id, sh)
        }
        lc.globalCompositeOperation = 'multiply'
        lc.drawImage(sh, 0, 0)
        if (l.glossy) {
          lc.globalCompositeOperation = 'screen'
          const g = lc.createLinearGradient(0, 0, W, H)
          g.addColorStop(0, 'rgba(255,255,255,0.10)')
          g.addColorStop(0.5, 'rgba(255,255,255,0)')
          g.addColorStop(1, 'rgba(255,255,255,0.06)')
          lc.fillStyle = g
          lc.fillRect(0, 0, W, H)
        }
        lc.globalCompositeOperation = 'destination-in'
        quadPath(lc, l.q)
        lc.fillStyle = '#000'
        lc.fill()
        ctx.drawImage(layer, 0, 0)
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
  }, [applied, theme, room.id])

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
    setCapture(() => {
      const cv = canvasRef.current
      return cv ? cv.toDataURL('image/jpeg', 0.9) : ''
    })
    return () => setCapture(null)
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
