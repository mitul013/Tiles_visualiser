import { useEffect, useRef, useState } from 'react'
import { findPaint, findProduct, useStore, type PhotoRoom } from '../store'
import { renderPaint, renderTiledSurface, renderTileBlock } from '../lib/layout'
import { PhotoGL, webglAvailable, type GLSurface } from '../lib/photoGL'
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

/** repeating layout blocks for the GPU renderer, shared between renders (a few products at a time) */
const blockCache = new Map<string, Promise<{ canvas: HTMLCanvasElement; size: [number, number] } | null>>()
function tileBlock(app: Extract<Application, { kind: 'tile' }>) {
  const p = findProduct(app.productId)
  if (!p) return Promise.resolve(null)
  const key = `${p.id}:${p.art.imageUrl?.length ?? 0}:${JSON.stringify(app.settings)}`
  let b = blockCache.get(key)
  if (!b) {
    b = renderTileBlock(p, app.settings, 2048)
    blockCache.set(key, b)
    while (blockCache.size > 10) blockCache.delete(blockCache.keys().next().value!)
  }
  return b
}
const rgba = (css: string | null): [number, number, number, number] | null => {
  const m = css?.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, Number(m[4])] : null
}
// ?nogl forces the canvas renderer (comparisons, old devices)
const useGL = typeof document !== 'undefined' && webglAvailable() && !new URLSearchParams(location.search).has('nogl')

export default function PhotoScene({ room, pins = false }: { room: PhotoRoom; pins?: boolean }) {
  const applied = useStore((s) => s.applied)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.theme)
  const setCapture = useStore((s) => s.setCapture)
  const setOriginal = useStore((s) => s.setOriginalShot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** GPU renderer (sharp at the screen's resolution); null = canvas renderer */
  const glRef = useRef<PhotoGL | null>(null)
  const [glOn, setGlOn] = useState(false)

  // GPU renderer: its canvas sits under the selection overlay and follows the stage's size
  useEffect(() => {
    if (!useGL) return
    const stage = stageRef.current
    if (!stage) return
    let gl: PhotoGL
    try {
      gl = new PhotoGL(room.width, room.height)
    } catch {
      return
    }
    glRef.current = gl
    gl.canvas.className = 'gl'
    stage.insertBefore(gl.canvas, overlayRef.current)
    const ro = new ResizeObserver(() => glRef.current === gl && gl.render(stage.clientWidth, stage.clientHeight, Math.min(2, window.devicePixelRatio || 1)))
    ro.observe(stage)
    setGlOn(true)
    return () => {
      ro.disconnect()
      gl.canvas.remove()
      gl.dispose()
      if (glRef.current === gl) glRef.current = null
      setGlOn(false)
    }
  }, [room.id, room.width, room.height])
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
      const tiles: { q: Pt[]; ext: Pt[]; img: HTMLCanvasElement; id: string; glossy: boolean; cover: [number, number, number, number] }[] = []
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
        // the GPU renderer repeats a small block instead: the whole-surface image is only its fallback
        const needImg = !glRef.current || (app.kind === 'tile' && !(await tileBlock(app)))
        const img = needImg ? await surfaceImage(app, size, extend ? 3600 : 2048) : document.createElement('canvas')
        const clip = sf.area ? sf.area.map(([x, y]) => [x * W, y * H] as Pt) : extend ? ex.quad : sf.q
        if (img) tiles.push({ q: clip, ext: ex.quad, img, id: sf.id, glossy: (app.kind === 'tile' ? app.settings.finish : app.finish) === 'glossy', cover: [ex.u0, ex.u1, ex.v0, ex.v1] })
      }
      const [cutout, shadow, reflection, highlight] = await Promise.all([layers.cutout, layers.shadow, layers.reflection, layers.highlight].map(loadImage))
      if (cancelled) return
      const gl = glRef.current
      if (gl) {
        // GPU: the untouched photo for "compare", then every surface as a repeating block
        if (!useStore.getState().originalShot) {
          const o = document.createElement('canvas')
          o.width = W
          o.height = H
          o.getContext('2d')!.drawImage(photo, 0, 0, W, H)
          setOriginal(o.toDataURL('image/jpeg', 0.85))
        }
        const surfaces: GLSurface[] = []
        for (const sf of quads) {
          const app = applied[sf.id]
          if (!app) continue
          const t = tiles.find((x) => x.id === sf.id)
          if (!t) continue
          const glossy = t.glossy
          if (app.kind === 'paint') {
            const pt = findPaint(app.paintId)
            if (!pt) continue
            surfaces.push({ clip: t.q, guide: sf.q, size: sf.size, tex: renderPaint(pt), texSize: [0.6, 0.6], repeat: true, glossy })
            continue
          }
          const block = await tileBlock(app)
          if (block) surfaces.push({ clip: t.q, guide: sf.q, size: sf.size, tex: block.canvas, texSize: block.size, repeat: true, glossy })
          else surfaces.push({ clip: t.q, guide: sf.q, size: sf.size, tex: t.img, texSize: [sf.size[0] * (t.cover[1] - t.cover[0]), sf.size[1] * (t.cover[3] - t.cover[2])], repeat: false, cover: t.cover, glossy })
        }
        if (cancelled || glRef.current !== gl) return
        const glossyCut = layers.cutoutGlossy ? await loadImage(layers.cutoutGlossy) : null
        if (cancelled || glRef.current !== gl) return
        gl.setScene({ photo, cutout, cutoutGlossy: glossyCut, shadow, reflection, highlight }, surfaces, rgba(TINT[theme]))
        const stage = stageRef.current
        if (stage) gl.render(stage.clientWidth, stage.clientHeight, Math.min(2, window.devicePixelRatio || 1))
        cv.dataset.ready = '1'
        return
      }
      const ctx = cv.getContext('2d')!
      ctx.globalCompositeOperation = 'source-over'
      // 0. original photo
      ctx.drawImage(photo, 0, 0, W, H)
      if (!useStore.getState().originalShot) setOriginal(cv.toDataURL('image/jpeg', 0.85))
      // 1. tiles in perspective, drawn at twice the size and scaled down (every pixel averages 4
      //    samples): far-away tiles stay smooth instead of breaking into streaks
      const SS = 2
      const tl = document.createElement('canvas')
      tl.width = W * SS
      tl.height = H * SS
      const tctx = tl.getContext('2d')!
      tctx.scale(SS, SS)
      for (const t of tiles) {
        tctx.save()
        quadPath(tctx, t.q)
        tctx.clip()
        drawPerspective(tctx, t.img, t.ext, 40, SS)
        tctx.restore()
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tl, 0, 0, W, H)
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
  }, [applied, theme, room.id, room.objMask, room.layers, room.surfaces, glOn])

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
    const capture = (hd?: boolean) => {
      // GPU: render the room at a set size (HD: twice the photo, sharper tiles in PDFs and downloads)
      const gl = glRef.current
      if (gl) return gl.snapshot(hd ? Math.min(4096, W * 2) : W)
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
      <div className="photo-stage" ref={stageRef} style={{ aspectRatio: `${W} / ${H}`, ['--ar' as string]: W / H }}>
        <canvas ref={canvasRef} width={W} height={H} style={glOn ? { visibility: 'hidden' } : undefined} />
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
