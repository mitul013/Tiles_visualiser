import { useEffect, useRef, useState } from 'react'
import { findPaint, findProduct, useStore, type PhotoRoom } from '../store'
import { renderPaint, renderTiledSurface } from '../lib/layout'
import { loadImage } from '../lib/tileArt'
import { drawPerspective, pointInQuad, quadPath, type Pt } from '../lib/homography'
import { generateLayers, type RoomLayers } from '../lib/roomLayers'
import type { Application, LightTheme } from '../types'

const TINT: Record<LightTheme, string | null> = { daylight: null, warm: 'rgba(255,170,80,0.10)', soft: 'rgba(255,220,180,0.08)', crystal: 'rgba(150,190,255,0.08)' }

const layerCache = new Map<string, Promise<RoomLayers>>()
/** The room's cut-out overlays: uploaded/saved ones, or generated once from surfaces + objects. */
function getLayers(room: PhotoRoom, photo: HTMLImageElement): Promise<RoomLayers> {
  if (room.layers) return Promise.resolve(room.layers)
  const key = `${room.id}:${room.objMask?.length ?? 0}:${JSON.stringify(room.surfaces.map((s) => s.quad))}`
  let p = layerCache.get(key)
  if (!p) {
    p = (async () => {
      const obj = room.objMask ? await loadImage(room.objMask) : null
      const quads = room.surfaces.map((s) => s.quad.map(([x, y]) => [x * room.width, y * room.height] as Pt))
      const layers = generateLayers(photo, room.width, room.height, quads, obj)
      // persist so the room loads instantly next time
      useStore.setState((st) => ({ photoRooms: st.photoRooms.map((r) => (r.id === room.id ? { ...r, layers } : r)) }))
      return layers
    })()
    layerCache.set(key, p)
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
      cv.dataset.ready = '0'
      cv.dataset.room = room.id
      const tiles: { q: Pt[]; img: HTMLCanvasElement; id: string; glossy: boolean }[] = []
      for (const sf of quads) {
        const app = applied[sf.id]
        if (!app) continue
        const img = await surfaceImage(app, sf.size)
        if (img) tiles.push({ q: sf.q, img, id: sf.id, glossy: (app.kind === 'tile' ? app.settings.finish : app.finish) === 'glossy' })
      }
      const layers = await getLayers(room, photo)
      const [matt, glossy] = await Promise.all([loadImage(layers.matt), loadImage(layers.glossy)])
      if (cancelled) return
      const ctx = cv.getContext('2d')!
      ctx.globalCompositeOperation = 'source-over'
      // 1. original photo
      ctx.drawImage(photo, 0, 0, W, H)
      if (!useStore.getState().originalShot) setOriginal(cv.toDataURL('image/jpeg', 0.85))
      // 2. tiles in perspective (slightly overscanned; the cut-out overlay defines the exact edge)
      for (const t of tiles) {
        ctx.save()
        quadPath(ctx, t.q)
        ctx.clip()
        drawPerspective(ctx, t.img, t.q)
        ctx.restore()
      }
      // 3. cut-out overlay: matt everywhere, glossy variant inside glossy surfaces
      const ov = document.createElement('canvas')
      ov.width = W
      ov.height = H
      const octx = ov.getContext('2d')!
      octx.drawImage(matt, 0, 0, W, H)
      for (const t of tiles.filter((x) => x.glossy)) {
        octx.save()
        quadPath(octx, t.q)
        octx.clip()
        octx.clearRect(0, 0, W, H)
        octx.drawImage(glossy, 0, 0, W, H)
        octx.restore()
      }
      ctx.drawImage(ov, 0, 0)
      cv.dataset.ready = '1'
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
  }, [applied, theme, room.id, room.objMask, room.layers])

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
