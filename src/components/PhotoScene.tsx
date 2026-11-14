import { useEffect, useRef, useState } from 'react'
import { findPaint, findProduct, useStore, type PhotoRoom } from '../store'
import { renderPaint, renderTiledSurface } from '../lib/layout'
import { loadImage } from '../lib/tileArt'
import { coverQuad, drawPerspective, pointInQuad, quadPath, type Pt } from '../lib/homography'
import { generateLayers, isCurrentLayers, type RoomLayers } from '../lib/roomLayers'
import type { Application, LightTheme } from '../types'

const TINT: Record<LightTheme, string | null> = { daylight: null, warm: 'rgba(255,170,80,0.10)', soft: 'rgba(255,220,180,0.08)', crystal: 'rgba(150,190,255,0.08)' }

const layerCache = new Map<string, Promise<RoomLayers>>()
/** The room's layers: uploaded/saved ones, or generated once from the photo + surfaces + objects. */
function getLayers(room: PhotoRoom, photo: HTMLImageElement): Promise<RoomLayers> {
  if (isCurrentLayers(room.layers)) return Promise.resolve(room.layers)
  const key = `${room.id}:${room.objMask?.length ?? 0}:${JSON.stringify(room.surfaces.map((s) => s.area ?? s.quad))}`
  let p = layerCache.get(key)
  if (!p) {
    p = (async () => {
      const obj = room.objMask ? await loadImage(room.objMask) : null
      const quads = room.surfaces.map((s) => (s.area ?? s.quad).map(([x, y]) => [x * room.width, y * room.height] as Pt))
      const layers = generateLayers(photo, room.width, room.height, quads, obj)
      // persist so the room loads instantly next time
      useStore.setState((st) => ({ photoRooms: st.photoRooms.map((r) => (r.id === room.id ? { ...r, layers } : r)) }))
      return layers
    })()
    layerCache.set(key, p)
  }
  return p
}

async function surfaceImage(app: Application, size: [number, number], maxTex = 1600) {
  if (app.kind === 'tile') {
    const p = findProduct(app.productId)
    return p ? renderTiledSurface(p, app.settings, size, maxTex) : null
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

/** a point to put a surface's label on: the middle of the part of its outline inside the photo */
function labelPoint(poly: Pt[], W: number, H: number): Pt {
  let pts = poly
  // clip to the frame (Sutherland–Hodgman against the four edges)
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= 0, (a, b) => { const t = a[0] / (a[0] - b[0]); return [0, a[1] + t * (b[1] - a[1])] }],
    [(p) => p[0] <= W, (a, b) => { const t = (W - a[0]) / (b[0] - a[0]); return [W, a[1] + t * (b[1] - a[1])] }],
    [(p) => p[1] >= 0, (a, b) => { const t = a[1] / (a[1] - b[1]); return [a[0] + t * (b[0] - a[0]), 0] }],
    [(p) => p[1] <= H, (a, b) => { const t = (H - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), H] }],
  ]
  for (const [inside, cut] of edges) {
    const out: Pt[] = []
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length]
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur))
        out.push(cur)
      } else if (inside(prev)) out.push(cut(prev, cur))
    })
    pts = out
    if (!pts.length) return [W / 2, H / 2]
  }
  let a = 0, cx = 0, cy = 0
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]
    const k = p[0] * q[1] - q[0] * p[1]
    a += k
    cx += (p[0] + q[0]) * k
    cy += (p[1] + q[1]) * k
  })
  const c: Pt = Math.abs(a) > 1e-6 ? [cx / (3 * a), cy / (3 * a)] : pts[0]
  return pointInQuad(c, pts) ? c : [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

export default function PhotoScene({ room, pins = false }: { room: PhotoRoom; pins?: boolean }) {
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
  const quads = room.surfaces.map((s) => ({ ...s, q: s.quad.map(([x, y]) => [x * W, y * H] as Pt), outline: (s.area ?? s.quad).map(([x, y]) => [x * W, y * H] as Pt) }))

  // main composite
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const photo = await loadImage(room.image)
      const cv = canvasRef.current
      if (!cv || cancelled) return
      cv.dataset.ready = '0'
      cv.dataset.room = room.id
      const layers = await getLayers(room, photo)
      // a prepared cut-out defines the tile area exactly, so the plane may extend freely under it
      const cutoutDefinesArea = layers.source !== 'generated'
      const tiles: { q: Pt[]; ext: Pt[]; img: HTMLCanvasElement; id: string; glossy: boolean }[] = []
      for (const sf of quads) {
        const app = applied[sf.id]
        if (!app) continue
        // extend the perspective plane beyond the guide rectangle so it covers the whole area,
        // including parts that run out of the photo; the area / cut-out decides what shows
        const extend = !!sf.area || cutoutDefinesArea
        // visible part of the area (plus the photo frame when the cut-out decides) → exact plane range
        const frame: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]]
        const coverPoly = sf.area ? sf.area.map(([x, y]) => [Math.min(W, Math.max(0, x * W)), Math.min(H, Math.max(0, y * H))] as Pt) : frame
        const ex = extend ? coverQuad(sf.q, coverPoly) : { quad: sf.q, u0: 0, u1: 1, v0: 0, v1: 1 }
        const size: [number, number] = [sf.size[0] * (ex.u1 - ex.u0), sf.size[1] * (ex.v1 - ex.v0)]
        const img = await surfaceImage(app, size, extend ? 2600 : 1600)
        const clip = sf.area ? sf.area.map(([x, y]) => [x * W, y * H] as Pt) : extend ? ex.quad : sf.q
        if (img) tiles.push({ q: clip, ext: ex.quad, img, id: sf.id, glossy: (app.kind === 'tile' ? app.settings.finish : app.finish) === 'glossy' })
      }
      const [cutout, shadow, reflection, highlight] = await Promise.all([layers.cutout, layers.shadow, layers.reflection, layers.highlight].map(loadImage))
      if (cancelled) return
      const ctx = cv.getContext('2d')!
      ctx.globalCompositeOperation = 'source-over'
      // 0. original photo
      ctx.drawImage(photo, 0, 0, W, H)
      if (!useStore.getState().originalShot) setOriginal(cv.toDataURL('image/jpeg', 0.85))
      // 1. tiles in perspective
      for (const t of tiles) {
        ctx.save()
        quadPath(ctx, t.q)
        ctx.clip()
        drawPerspective(ctx, t.img, t.ext, 32)
        ctx.restore()
      }
      // 2. room light on the tiles (multiply): matt surfaces use the shadow map,
      //    glossy surfaces the reflection map (the reference selects these per surface with a stencil)
      const lightL = document.createElement('canvas')
      lightL.width = W
      lightL.height = H
      const lctx = lightL.getContext('2d')!
      lctx.fillStyle = '#fff'
      lctx.fillRect(0, 0, W, H)
      // 3. highlights (screen): full on glossy, softer on matt
      const highL = document.createElement('canvas')
      highL.width = W
      highL.height = H
      const hctx = highL.getContext('2d')!
      hctx.fillStyle = '#000'
      hctx.fillRect(0, 0, W, H)
      for (const t of tiles) {
        for (const [c, img, alpha] of [
          [lctx, t.glossy ? reflection : shadow, 1],
          [hctx, highlight, t.glossy ? 1 : 0.45],
        ] as const) {
          c.save()
          quadPath(c, t.q)
          c.clip()
          c.globalAlpha = alpha
          c.drawImage(img, 0, 0, W, H)
          c.restore()
        }
      }
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(lightL, 0, 0)
      ctx.globalCompositeOperation = 'screen'
      ctx.drawImage(highL, 0, 0)
      // 4. cut-out on top: objects and everything untiled stay pixel-perfect.
      //    Glossy surfaces use the glossy cut-out when the room provides one.
      ctx.globalCompositeOperation = 'source-over'
      const glossyCut = layers.cutoutGlossy ? await loadImage(layers.cutoutGlossy) : null
      if (cancelled) return
      if (glossyCut && tiles.some((x) => x.glossy)) {
        const ov = document.createElement('canvas')
        ov.width = W
        ov.height = H
        const octx = ov.getContext('2d')!
        octx.drawImage(cutout, 0, 0, W, H)
        for (const t of tiles.filter((x) => x.glossy)) {
          octx.save()
          quadPath(octx, t.q)
          octx.clip()
          octx.clearRect(0, 0, W, H)
          octx.drawImage(glossyCut, 0, 0, W, H)
          octx.restore()
        }
        ctx.drawImage(ov, 0, 0)
      } else ctx.drawImage(cutout, 0, 0, W, H)
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
  }, [applied, theme, room.id, room.objMask, room.layers, room.surfaces])

  // selection overlay
  useEffect(() => {
    const ov = overlayRef.current
    if (!ov) return
    const ctx = ov.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    for (const s of quads) {
      const sel = selected.includes(s.id)
      if (!sel && hover !== s.id) continue
      quadPath(ctx, s.outline)
      ctx.lineWidth = Math.max(2, W / 400)
      ctx.setLineDash(sel ? [] : [10, 8])
      ctx.strokeStyle = pins ? 'rgba(255,255,255,0.95)' : sel ? '#1e88ff' : 'rgba(255,255,255,0.9)'
      ctx.stroke()
      if (sel) {
        ctx.fillStyle = pins ? 'rgba(255,255,255,0.14)' : 'rgba(30,136,255,0.08)'
        ctx.fill()
      }
    }
    // with labels on the photo, the outline only flashes to show what was picked
    if (pins) {
      const id = setTimeout(() => ctx.clearRect(0, 0, W, H), 900)
      return () => clearTimeout(id)
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
  const hit = (p: Pt) => [...quads].reverse().find((s) => pointInQuad(p, s.outline))

  return (
    <div className="scene-wrap photo">
      <div className="photo-stage" style={{ aspectRatio: `${W} / ${H}`, ['--ar' as string]: W / H }}>
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
        {pins &&
          quads.map((s, i) => {
            let [x, y] = labelPoint(s.outline, W, H)
            // keep labels apart when two surfaces' middles are close
            for (const o of quads.slice(0, i)) {
              const [ox, oy] = labelPoint(o.outline, W, H)
              if (Math.abs(ox - x) < W * 0.14 && Math.abs(oy - y) < H * 0.07) y = Math.min(H * 0.95, oy + H * 0.08)
            }
            return (
              <button key={s.id} className={`surf-pin${selected.includes(s.id) ? ' on' : ''}`} style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }} onClick={() => select([s.id])}>
                {s.label}
              </button>
            )
          })}
      </div>
      {hover && !pins && <div className="hover-tag">{room.surfaces.find((s) => s.id === hover)?.label} · click to select</div>}
    </div>
  )
}
