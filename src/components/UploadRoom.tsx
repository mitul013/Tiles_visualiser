import { useRef, useState } from 'react'
import { useStore, type PhotoSurface } from '../store'
import type { SurfaceType } from '../types'
import { Icon, Modal, toast } from './ui'
import { refineMaskCanvas } from '../lib/objectMask'
import { generateLayers, type RoomLayers } from '../lib/roomLayers'
import { detectSurfaces } from '../lib/detectSurfaces'
import { applyH, extendQuad, squareToQuad, type Pt } from '../lib/homography'

const uid = () => Math.random().toString(36).slice(2, 10)

type LayerKey = 'cutout' | 'shadow' | 'reflection' | 'highlight'
const LAYER_KEYS: LayerKey[] = ['cutout', 'shadow', 'reflection', 'highlight']
const LAYER_INFO: Record<LayerKey, [string, string]> = {
  cutout: ['Cut-out (PNG, transparent tile area)', 'Drawn on top: keeps furniture and objects pixel-perfect'],
  shadow: ['Matt light map', 'Greyscale, multiplied onto matt tiles (white = no change)'],
  reflection: ['Glossy light map', 'Greyscale, multiplied onto glossy tiles'],
  highlight: ['Highlights', 'Greyscale, added with a screen blend (black = no change)'],
}

const PRESET: Record<SurfaceType, { label: string; quad: [number, number][]; area: [number, number][]; size: [number, number] }> = {
  // quad = perspective guide (a real rectangle on the surface); area = where tiles go; size = guide's real size (m)
  floor: { label: 'Floor', quad: [[0.32, 0.68], [0.68, 0.68], [0.76, 0.86], [0.24, 0.86]], area: [[-0.05, 0.6], [1.05, 0.6], [1.05, 1.05], [-0.05, 1.05]], size: [2, 2] },
  wall: { label: 'Wall', quad: [[0.3, 0.12], [0.7, 0.12], [0.7, 0.52], [0.3, 0.52]], area: [[0.2, 0.05], [0.8, 0.05], [0.8, 0.58], [0.2, 0.58]], size: [2, 2] },
  backsplash: { label: 'Backsplash', quad: [[0.3, 0.35], [0.7, 0.35], [0.7, 0.5], [0.3, 0.5]], area: [[0.3, 0.35], [0.7, 0.35], [0.7, 0.5], [0.3, 0.5]], size: [3, 0.6] },
  countertop: { label: 'Counter Top', quad: [[0.3, 0.52], [0.7, 0.52], [0.74, 0.58], [0.26, 0.58]], area: [[0.3, 0.52], [0.7, 0.52], [0.74, 0.58], [0.26, 0.58]], size: [3, 0.6] },
  ceiling: { label: 'Ceiling', quad: [[0.3, 0.02], [0.7, 0.02], [0.66, 0.08], [0.34, 0.08]], area: [[-0.05, -0.05], [1.05, -0.05], [0.78, 0.1], [0.22, 0.1]], size: [2, 1] },
  rug: { label: 'Rug', quad: [[0.3, 0.75], [0.7, 0.75], [0.8, 0.92], [0.2, 0.92]], area: [[0.3, 0.75], [0.7, 0.75], [0.8, 0.92], [0.2, 0.92]], size: [2.3, 1.6] },
}
const COLORS: Record<SurfaceType, string> = { floor: '#ff8a3d', wall: '#1e88ff', backsplash: '#2bb673', countertop: '#c04cf0', ceiling: '#00b5c8', rug: '#e0b000' }

/** Wizard: upload a room photo, mark surfaces by dragging 4 corners each, and give their real size. */
/** Live perspective grid: the guide rectangle's plane extended, clipped to the surface area. */
function PerspectiveGrid({ quad, clipId, color }: { quad: [number, number][]; clipId: string; color: string }) {
  const Hm = squareToQuad(quad)
  const ex = extendQuad(quad, 6)
  const lines: [Pt, Pt][] = []
  const step = 0.5
  for (let u = Math.ceil(ex.u0 / step) * step; u <= ex.u1; u += step) lines.push([applyH(Hm, u, ex.v0), applyH(Hm, u, ex.v1)])
  for (let v = Math.ceil(ex.v0 / step) * step; v <= ex.v1; v += step) lines.push([applyH(Hm, ex.u0, v), applyH(Hm, ex.u1, v)])
  return (
    <g clipPath={`url(#${clipId})`} pointerEvents="none">
      {lines.map(([a, b], i) => (
        <line key={i} x1={a[0] * 1000} y1={a[1] * 1000} x2={b[0] * 1000} y2={b[1] * 1000} stroke={color} strokeOpacity={0.75} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  )
}

export default function UploadRoomModal() {
  const close = () => useStore.getState().setModal(null)
  const addRoom = useStore((s) => s.addPhotoRoom)
  const openRoom = useStore((s) => s.openRoom)
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null)
  /** files chosen on the first screen: original photo + optional prepared cut-outs */
  const [start, setStart] = useState<{ photo?: string; matt?: string; glossy?: string }>({})
  const [prepared, setPrepared] = useState<{ glossy?: string } | null>(null)
  const readFile = (f: File) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const im = new Image()
        im.src = reader.result as string
        try {
          await im.decode()
          res(im)
        } catch (e) {
          rej(e)
        }
      }
      reader.onerror = rej
      reader.readAsDataURL(f)
    })
  const pickStart = async (kind: 'photo' | 'matt' | 'glossy', f?: File) => {
    if (!f) return
    const im = await readFile(f)
    setStart((cur) => ({ ...cur, [kind]: im.src }))
  }
  /** continue from the first screen: with cut-outs, surfaces are detected automatically */
  const begin = async () => {
    // the original is optional with a prepared cut-out: the cut-out flattened on white stands in
    let photoSrc = start.photo
    if (!photoSrc && start.matt) {
      const ci = new Image()
      ci.src = start.matt
      await ci.decode()
      const fc = document.createElement('canvas')
      fc.width = ci.naturalWidth
      fc.height = ci.naturalHeight
      const fctx = fc.getContext('2d')!
      fctx.fillStyle = '#ffffff'
      fctx.fillRect(0, 0, fc.width, fc.height)
      fctx.drawImage(ci, 0, 0)
      photoSrc = fc.toDataURL('image/jpeg', 0.92)
    }
    if (!photoSrc) return
    const im = new Image()
    im.src = photoSrc
    await im.decode()
    const k = Math.min(1, 1600 / Math.max(im.width, im.height))
    const W = Math.round(im.width * k)
    const H = Math.round(im.height * k)
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    c.getContext('2d')!.drawImage(im, 0, 0, W, H)
    setImg({ src: c.toDataURL('image/jpeg', 0.9), w: W, h: H })
    if (!start.matt) {
      const copy = (t: 'floor' | 'wall') => ({ id: `s-${uid()}`, type: t, label: PRESET[t].label, quad: PRESET[t].quad.map((p) => [...p] as [number, number]), area: PRESET[t].area.map((p) => [...p] as [number, number]), size: [...PRESET[t].size] as [number, number] })
      const fl = copy('floor')
      const wl = copy('wall')
      setSurfaces([wl, fl])
      setActive(fl.id)
      setPrepared(null)
      return
    }
    // prepared room: normalise cut-outs to the photo size, detect surfaces from transparency
    const norm = async (src: string) => {
      const ci = new Image()
      ci.src = src
      await ci.decode()
      const cc = document.createElement('canvas')
      cc.width = W
      cc.height = H
      const cctx = cc.getContext('2d', { willReadFrequently: true })!
      cctx.drawImage(ci, 0, 0, W, H)
      return cc
    }
    const matt = await norm(start.matt)
    const d = matt.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data
    const alpha = new Uint8ClampedArray(W * H)
    for (let i = 0; i < W * H; i++) alpha[i] = d[i * 4 + 3]
    const found = detectSurfaces(alpha, W, H)
    const surfs: PhotoSurface[] = found.map((f) => ({ id: `s-${uid()}`, type: f.type, label: f.label, quad: f.guide, area: f.area, size: f.size }))
    setSurfaces(surfs)
    setActive(surfs[0]?.id ?? null)
    setCutout({ cutout: matt.toDataURL('image/png') })
    setPrepared({ glossy: start.glossy ? (await norm(start.glossy)).toDataURL('image/png') : undefined })
    setMode('surfaces')
    if (!surfs.length) toast('No transparent area found in the cut-out — mark the surfaces manually')
  }
  const [name, setName] = useState('My room')
  const [surfaces, setSurfaces] = useState<PhotoSurface[]>([])
  const [active, setActive] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'surfaces' | 'objects' | 'cutout'>('surfaces')
  const [brush, setBrush] = useState(28)
  const [erase, setErase] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [snap, setSnap] = useState(true)
  /** optional uploaded cut-out overlays (transparent where tiles go) */
  const [cutout, setCutout] = useState<Partial<Record<LayerKey, string>>>({})
  const loadCutout = (kind: LayerKey, f?: File) => {
    if (!f || !img) return
    const reader = new FileReader()
    reader.onload = async () => {
      const im = new Image()
      im.src = reader.result as string
      await im.decode()
      // normalise to the photo's size as PNG (keeps transparency)
      const c = document.createElement('canvas')
      c.width = img.w
      c.height = img.h
      c.getContext('2d')!.drawImage(im, 0, 0, img.w, img.h)
      setCutout((cur) => ({ ...cur, [kind]: kind === 'cutout' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9) }))
    }
    reader.readAsDataURL(f)
  }
  const [busy, setBusy] = useState(false)
  /** the user's rough strokes; the visible mask is these strokes snapped to object outlines */
  const roughRef = useRef<HTMLCanvasElement | null>(null)
  const photoRef = useRef<HTMLImageElement | null>(null)
  const painting = useRef(false)
  const rough = () => {
    const cv = maskRef.current!
    if (!roughRef.current || roughRef.current.width !== cv.width) {
      roughRef.current = document.createElement('canvas')
      roughRef.current.width = cv.width
      roughRef.current.height = cv.height
    }
    return roughRef.current
  }
  const finishStroke = async () => {
    const cv = maskRef.current
    if (!cv || !img) return
    const ctx = cv.getContext('2d')!
    if (!snap) {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(rough(), 0, 0)
      return
    }
    setBusy(true)
    await new Promise((r) => setTimeout(r, 20))
    if (!photoRef.current || photoRef.current.src !== img.src) {
      photoRef.current = new Image()
      photoRef.current.src = img.src
      await photoRef.current.decode()
    }
    const quads = surfaces.map((sf) => sf.quad.map(([x, y]) => [x * cv.width, y * cv.height] as [number, number]))
    const refined = refineMaskCanvas(photoRef.current, rough(), cv.width, cv.height, quads)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(refined, 0, 0)
    setBusy(false)
  }
  const last = useRef<[number, number] | null>(null)
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = maskRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * cv.width
    const y = ((e.clientY - r.top) / r.height) * cv.height
    const size = (brush / r.width) * cv.width
    const [lx, ly] = last.current ?? [x, y]
    for (const ctx of [cv.getContext('2d')!, rough().getContext('2d')!]) {
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
      ctx.strokeStyle = ctx.fillStyle = 'rgba(255,40,120,1)'
      ctx.lineCap = 'round'
      ctx.lineWidth = size
      ctx.beginPath()
      ctx.moveTo(lx, ly)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    last.current = [x, y]
    if (!erase) setHasMask(true)
  }
  const drag = useRef<{ sid: string; idx: number; kind: 'area' | 'perspective' } | null>(null)
  const [tool, setTool] = useState<'area' | 'perspective'>('area')
  /** points tapped along the floor/wall junction while splitting (null = not splitting) */
  const [split, setSplit] = useState<[number, number][] | null>(null)
  /**
   * Split the active surface along the floor/wall junction: below the line = floor (keeps its
   * perspective guide), above = one wall per segment between tapped points (corners).
   * The cut-out still decides the exact pixels, so the line only has to be roughly right.
   */
  const finishSplit = () => {
    if (!act || !split || split.length < 2) return setSplit(null)
    const pts = [...split].sort((a, b) => a[0] - b[0])
    const P: [number, number][] = [[-0.05, pts[0][1]], ...pts, [1.05, pts[pts.length - 1][1]]]
    const floorArea: [number, number][] = [...P, [1.05, 1.05], [-0.05, 1.05]]
    const ar = img ? img.w / img.h : 1.5
    const walls: PhotoSurface[] = []
    // one wall per segment between tapped points; the stretches out to the photo edges belong to
    // the first / last wall (not walls of their own)
    for (let i = 1; i < P.length - 2; i++) {
      const [a, b] = [P[i], P[i + 1]]
      if (b[0] - a[0] < 0.03) continue
      const top = -0.05
      const first = i === 1
      const last = i === P.length - 3
      const area: [number, number][] = [
        [first ? P[0][0] : a[0], top],
        [last ? P[P.length - 1][0] : b[0], top],
        ...(last ? [P[P.length - 1]] : []),
        b,
        a,
        ...(first ? [P[0]] : []),
      ]
      // guide: the wall strip just above the junction (a vertical rectangle in reality)
      const hh = Math.min(0.3, Math.max(0.08, Math.min(a[1], b[1]) * 0.45))
      const gx0 = Math.max(0.01, a[0])
      const gx1 = Math.min(0.99, b[0])
      const ya = a[1] + ((b[1] - a[1]) * (gx0 - a[0])) / (b[0] - a[0])
      const yb = a[1] + ((b[1] - a[1]) * (gx1 - a[0])) / (b[0] - a[0])
      const guide: [number, number][] = [[gx0, ya - hh], [gx1, yb - hh], [gx1, yb], [gx0, ya]]
      const widthM = +((1.2 * Math.hypot((gx1 - gx0) * ar, yb - ya)) / hh).toFixed(2)
      walls.push({ id: `s-${uid()}`, type: 'wall', label: `Wall ${walls.length + 1}`, quad: guide, area, size: [Math.max(0.3, widthM), 1.2] })
    }
    setSurfaces((ss) => [...ss.map((x) => (x.id === act.id ? { ...x, type: 'floor' as const, label: 'Floor', area: floorArea } : x)), ...walls])
    setSplit(null)
    toast(`Split into floor + ${walls.length} wall${walls.length === 1 ? '' : 's'}: check each wall's perspective guide`)
  }

  const addSurface = (t: SurfaceType) => {
    const n = surfaces.filter((s) => s.type === t).length
    const s: PhotoSurface = { id: `s-${uid()}`, type: t, label: n ? `${PRESET[t].label} ${n + 1}` : PRESET[t].label, quad: PRESET[t].quad.map((p) => [...p] as [number, number]), area: PRESET[t].area.map((p) => [...p] as [number, number]), size: [...PRESET[t].size] as [number, number] }
    setSurfaces([...surfaces, s])
    setActive(s.id)
  }
  const patch = (id: string, p: Partial<PhotoSurface>) => setSurfaces((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)))

  /** the corner layer extends 15% past each photo edge, so floors can run out of the frame */
  const PAD = 0.15
  const toNorm = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const f = (v: number) => Math.max(-1.5, Math.min(2.5, v))
    return [f(-PAD + (1 + 2 * PAD) * ((e.clientX - r.left) / r.width)), f(-PAD + (1 + 2 * PAD) * ((e.clientY - r.top) / r.height))]
  }

  const save = async () => {
    if (!img) return
    const id = `photo-${uid()}`
    const objMask = hasMask && maskRef.current ? maskRef.current.toDataURL('image/png') : undefined
    let layers: RoomLayers | undefined
    if (Object.keys(cutout).length) {
      // generate what wasn't uploaded (the uploaded cut-out defines the tile area exactly)
      const photo = new Image()
      photo.src = img.src
      await photo.decode()
      const cut = cutout.cutout ? new Image() : null
      if (cut) {
        cut.src = cutout.cutout!
        await cut.decode()
      }
      const quads = surfaces.map((sf) => sf.quad.map(([x, y]) => [x * img.w, y * img.h] as [number, number]))
      const gen = generateLayers(photo, img.w, img.h, quads, hasMask ? maskRef.current : null, cut)
      const all = LAYER_KEYS.every((k) => cutout[k])
      layers = { ...gen, ...cutout, cutoutGlossy: prepared?.glossy, source: all ? 'uploaded' : 'mixed' }
    }
    addRoom({ id, name, image: img.src, width: img.w, height: img.h, surfaces, objMask, layers, createdAt: Date.now() })
    openRoom(id, {})
    useStore.getState().select(surfaces.filter((s) => s.type === 'floor').map((s) => s.id).slice(0, 1))
    close()
    toast('Room ready — pick a tile to apply')
  }

  const act = surfaces.find((s) => s.id === active)

  return (
    <Modal
      title="Upload a picture of your room"
      onClose={close}
      wide="xl"
      footer={
        img ? (
          <>
            <label className="inline">
              Room name <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <span className="grow" />
            <button
              className="btn"
              onClick={() => {
                setImg(null)
                setPrepared(null)
                setCutout({})
              }}
            >
              Change image
            </button>
            <button className="btn primary" disabled={!surfaces.length} onClick={save}>
              <Icon name="check" /> Use this room
            </button>
          </>
        ) : null
      }
    >
      {!img ? (
        <div className="start-upload">
          <label className={`drop big${start.photo ? ' has' : ''}`}>
            {start.photo ? <img src={start.photo} alt="room" /> : (
              <>
                <Icon name="image" size={44} />
                <b>Room photo (original)</b>
                <span className="hint">Tap to choose. Everything stays in your browser.</span>
              </>
            )}
            <input type="file" accept="image/*" hidden onChange={(e) => pickStart('photo', e.target.files?.[0])} />
          </label>
          <div className="start-side">
            <p className="hint">
              <b>Have prepared cut-outs?</b> Add the <b>matt</b> (and optionally <b>glossy</b>) version of the same photo with the tile area <b>transparent</b>. Surfaces are detected automatically, objects stay intact and the cut-out's own shadows light the tiles. The original photo is optional then.
            </p>
            {(['matt', 'glossy'] as const).map((k) => (
              <label key={k} className={`drop small${start[k] ? ' has' : ''}`}>
                {start[k] ? <img src={start[k]} alt={`${k} cut-out`} /> : <span>{k === 'matt' ? 'Matt cut-out (transparent tile area)' : 'Glossy cut-out (optional)'}</span>}
                <input type="file" accept="image/png,image/webp" hidden onChange={(e) => pickStart(k, e.target.files?.[0])} />
              </label>
            ))}
            <button className="btn primary block" disabled={!start.photo && !start.matt} onClick={() => void begin()}>
              {start.matt ? 'Detect surfaces & continue' : 'Continue: mark surfaces'}
            </button>
          </div>
        </div>
      ) : (
        <div className="room-editor">
          <div className="editor-stage" style={{ aspectRatio: `${img.w} / ${img.h}` }}>
            <img src={img.src} alt="room" draggable={false} />
            <canvas
              ref={maskRef}
              width={img.w}
              height={img.h}
              className="obj-mask"
              style={{ pointerEvents: mode === 'objects' ? 'auto' : 'none', cursor: mode === 'objects' ? 'crosshair' : 'default' }}
              onPointerDown={(e) => {
                painting.current = true
                last.current = null
                e.currentTarget.setPointerCapture(e.pointerId)
                paint(e)
              }}
              onPointerMove={(e) => painting.current && paint(e)}
              onPointerUp={() => {
                painting.current = false
                last.current = null
                void finishStroke()
              }}
            />
            <svg
              className="corners"
              style={{ pointerEvents: mode === 'surfaces' ? 'auto' : 'none' }}
              ref={svgRef}
              viewBox="-150 -150 1300 1300"
              preserveAspectRatio="none"
              onPointerDown={(e) => {
                // tap on the photo in Area mode: add an outline point at the best spot
                if (split) {
                  setSplit([...split, toNorm(e)])
                  return
                }
                if (tool !== 'area' || !act || e.target !== e.currentTarget) return
                const p = toNorm(e)
                const poly = act.area ?? act.quad
                let best = 0
                let bestD = Infinity
                for (let i = 0; i < poly.length; i++) {
                  const [ax, ay] = poly[i]
                  const [bx, by] = poly[(i + 1) % poly.length]
                  const d = Math.hypot(p[0] - ax, p[1] - ay) + Math.hypot(p[0] - bx, p[1] - by) - Math.hypot(bx - ax, by - ay)
                  if (d < bestD) {
                    bestD = d
                    best = i
                  }
                }
                const next = [...poly]
                next.splice(best + 1, 0, p)
                patch(act.id, { area: next })
              }}
              onPointerMove={(e) => {
                if (!drag.current) return
                const { sid, idx, kind } = drag.current
                const p = toNorm(e)
                setSurfaces((ss) =>
                  ss.map((s) => {
                    if (s.id !== sid) return s
                    if (kind === 'area') return { ...s, area: (s.area ?? s.quad).map((q, i) => (i === idx ? p : q)) }
                    return { ...s, quad: s.quad.map((q, i) => (i === idx ? p : q)) }
                  }),
                )
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              <defs>
                {surfaces.map((s) => (
                  <clipPath key={s.id} id={`area-${s.id}`}>
                    <polygon points={(s.area ?? s.quad).map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} />
                  </clipPath>
                ))}
              </defs>
              {split && split.length > 0 && (
                <g pointerEvents="none">
                  <polyline points={[...split].sort((a, b) => a[0] - b[0]).map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill="none" stroke="#ff2878" strokeWidth={3} strokeDasharray="12 6" vectorEffect="non-scaling-stroke" />
                  {split.map(([x, y], i) => (
                    <circle key={i} cx={x * 1000} cy={y * 1000} r={10} fill="#ff2878" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              )}
              {surfaces.map((s) => {
                const on = s.id === active
                const area = s.area ?? s.quad
                return (
                  <g key={s.id} opacity={on ? 1 : 0.5} onPointerDown={() => setActive(s.id)}>
                    <polygon points={area.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill={COLORS[s.type]} fillOpacity={0.18} stroke={COLORS[s.type]} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    {on && <PerspectiveGrid quad={s.quad} clipId={`area-${s.id}`} color={COLORS[s.type]} />}
                    {on && tool === 'perspective' && (
                      <polygon points={s.quad.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="10 6" vectorEffect="non-scaling-stroke" />
                    )}
                    {on &&
                      (tool === 'area' ? area : s.quad).map(([x, y], i) => (
                        <circle
                          key={`${tool}-${i}`}
                          cx={x * 1000}
                          cy={y * 1000}
                          r={tool === 'area' ? 11 : 15}
                          fill={tool === 'area' ? COLORS[s.type] : '#fff'}
                          stroke={tool === 'area' ? '#fff' : COLORS[s.type]}
                          strokeWidth={4}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            ;(e.target as Element).setPointerCapture?.(e.pointerId)
                            drag.current = { sid: s.id, idx: i, kind: tool }
                          }}
                          onDoubleClick={() => {
                            if (tool !== 'area' || area.length <= 3) return
                            patch(s.id, { area: area.filter((_, k) => k !== i) })
                          }}
                        />
                      ))}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="editor-side">
            <div className="seg">
              <button className={mode === 'surfaces' ? 'on' : ''} onClick={() => setMode('surfaces')}>
                1. Surfaces
              </button>
              {!prepared && (
                <>
                  <button className={mode === 'objects' ? 'on' : ''} onClick={() => setMode('objects')}>
                    2. Objects in front
                  </button>
                  <button className={mode === 'cutout' ? 'on' : ''} onClick={() => setMode('cutout')}>
                    3. Cut-out layers
                  </button>
                </>
              )}
            </div>
            {mode === 'cutout' && (
              <div className="cutout-panel">
                <p className="hint">
                  Optional, most precise: upload prepared room layers. The <b>cut-out</b> is the same photo with the tile area <b>transparent</b> and everything else kept. The light maps are greyscale images of the room's lighting on the tile area.
                </p>
                <div className="layer-grid">
                  {LAYER_KEYS.map((k) => (
                    <label key={k} className="drop small" title={LAYER_INFO[k][1]}>
                      {cutout[k] ? <img src={cutout[k]} alt={LAYER_INFO[k][0]} /> : <span>{LAYER_INFO[k][0]}</span>}
                      <input type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => loadCutout(k, e.target.files?.[0])} />
                    </label>
                  ))}
                </div>
                <p className="hint">Hover a slot for what it does. Any layer you don't upload is generated from the photo.</p>
                {Object.keys(cutout).length > 0 && (
                  <button className="btn sm" onClick={() => setCutout({})}>
                    Remove uploaded layers
                  </button>
                )}
              </div>
            )}
            {mode === 'cutout' ? null : mode === 'objects' ? (
              <>
                <p className="hint">Roughly paint over anything standing in front of the floor or walls (sofa, bed, taps, plants, window frames). The outline is detected automatically and those pixels stay on top, untouched, whatever tiles or colours you apply.</p>
                <label className="inline">
                  Brush <input type="range" min={6} max={90} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                </label>
                <div className="seg">
                  <button className={!erase ? 'on' : ''} onClick={() => setErase(false)}>
                    Paint
                  </button>
                  <button className={erase ? 'on' : ''} onClick={() => setErase(true)}>
                    Erase
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to object edges (paint roughly, we follow the outline)
                </label>
                {busy && <span className="hint">Finding object edges…</span>}
                <button
                  className="btn sm"
                  onClick={() => {
                    for (const cv of [maskRef.current, roughRef.current]) cv?.getContext('2d')!.clearRect(0, 0, cv.width, cv.height)
                    setHasMask(false)
                  }}
                >
                  Clear objects
                </button>
              </>
            ) : (
              <>
            {split ? (
              <div className="split-box">
                <p className="hint">
                  Tap points along the line where the <b>floor meets the walls</b>, left to right, including each room corner ({split.length} tapped).
                </p>
                <div className="row">
                  <button className="btn sm" onClick={() => setSplit(null)}>
                    Cancel
                  </button>
                  <button className="btn sm" disabled={!split.length} onClick={() => setSplit(split.slice(0, -1))}>
                    Undo point
                  </button>
                  <button className="btn sm primary" disabled={split.length < 2} onClick={finishSplit}>
                    Finish split
                  </button>
                </div>
              </div>
            ) : (
              act &&
              act.type === 'floor' && (
                <button className="btn sm" onClick={() => setSplit([])} title="Floor and walls are one connected area? Separate them here.">
                  Split floor / walls
                </button>
              )
            )}
            <div className="seg tool-seg">
              <button className={tool === 'area' ? 'on' : ''} onClick={() => setTool('area')}>
                Area (where tiles go)
              </button>
              <button className={tool === 'perspective' ? 'on' : ''} onClick={() => setTool('perspective')}>
                Perspective guide
              </button>
            </div>
            <p className="hint tool-hint">
              {tool === 'area'
                ? 'Drag the coloured points along the edge of the floor/wall. Tap on the photo to add a point (e.g. around pillars), double-tap a point to remove it. Points may sit on or past the photo edge.'
                : 'Place the 4 white handles on any rectangle lying on this surface, e.g. along plank or tile joints, until the grid lines follow the photo. It does not need to cover the whole floor: the plane is extended automatically. Width/depth below = that rectangle\'s real size.'}
            </p>
            <p className="hint">
              {prepared
                ? 'Surfaces were detected from your cut-out: the tile area and objects come from the cut-out itself. Check the perspective guide follows the floor lines and set its real size for correct tile scale.'
                : 'Each surface has an area and a perspective guide. Floors that run out of the frame are fine: outline the visible part; the plane extends under it.'}
            </p>
            <div className="chips">
              {(Object.keys(PRESET) as SurfaceType[]).map((t) => (
                <button key={t} onClick={() => addSurface(t)}>
                  <Icon name="plus" size={13} /> {PRESET[t].label}
                </button>
              ))}
            </div>
            <div className="surf-list">
              {surfaces.map((s) => (
                <div key={s.id} className={`surf-item${s.id === active ? ' on' : ''}`} onClick={() => setActive(s.id)}>
                  <i style={{ background: COLORS[s.type] }} />
                  <input value={s.label} onChange={(e) => patch(s.id, { label: e.target.value })} />
                  <button
                    className="btn sm danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSurfaces(surfaces.filter((x) => x.id !== s.id))
                    }}
                    aria-label="Remove surface"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
            {act && (
              <div className="row">
                <label>
                  Guide width (m)
                  <input type="number" min={0.2} step={0.1} value={act.size[0]} onChange={(e) => patch(act.id, { size: [Number(e.target.value) || 0.2, act.size[1]] })} />
                </label>
                <label>
                  Guide {act.type === 'floor' || act.type === 'countertop' ? 'depth' : 'height'} (m)
                  <input type="number" min={0.2} step={0.1} value={act.size[1]} onChange={(e) => patch(act.id, { size: [act.size[0], Number(e.target.value) || 0.2] })} />
                </label>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
