import { useRef, useState } from 'react'
import { useStore, type PhotoSurface } from '../store'
import type { SurfaceType } from '../types'
import { Icon, Modal, toast } from './ui'
import { refineMaskCanvas } from '../lib/objectMask'
import { generateLayers, type RoomLayers } from '../lib/roomLayers'

const uid = () => Math.random().toString(36).slice(2, 10)

type LayerKey = 'cutout' | 'shadow' | 'reflection' | 'highlight'
const LAYER_KEYS: LayerKey[] = ['cutout', 'shadow', 'reflection', 'highlight']
const LAYER_INFO: Record<LayerKey, [string, string]> = {
  cutout: ['Cut-out (PNG, transparent tile area)', 'Drawn on top: keeps furniture and objects pixel-perfect'],
  shadow: ['Matt light map', 'Greyscale, multiplied onto matt tiles (white = no change)'],
  reflection: ['Glossy light map', 'Greyscale, multiplied onto glossy tiles'],
  highlight: ['Highlights', 'Greyscale, added with a screen blend (black = no change)'],
}

const PRESET: Record<SurfaceType, { label: string; quad: [number, number][]; size: [number, number] }> = {
  floor: { label: 'Floor', quad: [[0.22, 0.62], [0.78, 0.62], [1, 0.98], [0, 0.98]], size: [4, 4] },
  wall: { label: 'Wall', quad: [[0.22, 0.06], [0.78, 0.06], [0.78, 0.6], [0.22, 0.6]], size: [4, 2.7] },
  backsplash: { label: 'Backsplash', quad: [[0.3, 0.35], [0.7, 0.35], [0.7, 0.5], [0.3, 0.5]], size: [3, 0.6] },
  countertop: { label: 'Counter Top', quad: [[0.3, 0.52], [0.7, 0.52], [0.74, 0.58], [0.26, 0.58]], size: [3, 0.6] },
}
const COLORS: Record<SurfaceType, string> = { floor: '#ff8a3d', wall: '#1e88ff', backsplash: '#2bb673', countertop: '#c04cf0' }

/** Wizard: upload a room photo, mark surfaces by dragging 4 corners each, and give their real size. */
export default function UploadRoomModal() {
  const close = () => useStore.getState().setModal(null)
  const addRoom = useStore((s) => s.addPhotoRoom)
  const openRoom = useStore((s) => s.openRoom)
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null)
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
  const drag = useRef<{ sid: string; idx: number } | null>(null)

  const onFile = (f?: File) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      const im = new Image()
      im.src = reader.result as string
      await im.decode()
      const k = Math.min(1, 1600 / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * k)
      c.height = Math.round(im.height * k)
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      setImg({ src: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height })
      const fl = { id: `s-${uid()}`, type: 'floor' as const, ...PRESET.floor }
      const wl = { id: `s-${uid()}`, type: 'wall' as const, ...PRESET.wall }
      setSurfaces([wl, fl])
      setActive(fl.id)
    }
    reader.readAsDataURL(f)
  }

  const addSurface = (t: SurfaceType) => {
    const n = surfaces.filter((s) => s.type === t).length
    const s: PhotoSurface = { id: `s-${uid()}`, type: t, label: n ? `${PRESET[t].label} ${n + 1}` : PRESET[t].label, quad: PRESET[t].quad.map((p) => [...p] as [number, number]), size: [...PRESET[t].size] as [number, number] }
    setSurfaces([...surfaces, s])
    setActive(s.id)
  }
  const patch = (id: string, p: Partial<PhotoSurface>) => setSurfaces((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)))

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]
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
      layers = { ...gen, ...cutout, source: all ? 'uploaded' : 'mixed' }
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
            <button className="btn" onClick={() => setImg(null)}>
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
        <label
          className="drop big"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onFile(e.dataTransfer.files[0])
          }}
        >
          <Icon name="image" size={48} />
          <b>Drag &amp; drop a room photo, or click to choose</b>
          <span className="hint">Tip: shoot straight on, with the floor and walls clearly visible. Everything stays in your browser.</span>
          <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
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
              style={{ pointerEvents: mode === 'surfaces' ? 'auto' : 'none' }}
              ref={svgRef}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              onPointerMove={(e) => {
                if (!drag.current) return
                const { sid, idx } = drag.current
                const p = toNorm(e)
                setSurfaces((ss) => ss.map((s) => (s.id === sid ? { ...s, quad: s.quad.map((q, i) => (i === idx ? p : q)) } : s)))
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              {surfaces.map((s) => (
                <g key={s.id} opacity={s.id === active ? 1 : 0.55} onPointerDown={() => setActive(s.id)}>
                  <polygon points={s.quad.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill={COLORS[s.type]} fillOpacity={0.22} stroke={COLORS[s.type]} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  {s.id === active &&
                    s.quad.map(([x, y], i) => (
                      <circle
                        key={i}
                        cx={x * 1000}
                        cy={y * 1000}
                        r={14}
                        fill="#fff"
                        stroke={COLORS[s.type]}
                        strokeWidth={4}
                        vectorEffect="non-scaling-stroke"
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          ;(e.target as Element).setPointerCapture?.(e.pointerId)
                          drag.current = { sid: s.id, idx: i }
                        }}
                      />
                    ))}
                </g>
              ))}
            </svg>
          </div>
          <div className="editor-side">
            <div className="seg">
              <button className={mode === 'surfaces' ? 'on' : ''} onClick={() => setMode('surfaces')}>
                1. Surfaces
              </button>
              <button className={mode === 'objects' ? 'on' : ''} onClick={() => setMode('objects')}>
                2. Objects in front
              </button>
              <button className={mode === 'cutout' ? 'on' : ''} onClick={() => setMode('cutout')}>
                3. Cut-out layers
              </button>
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
            <p className="hint">Drag the 4 white corners of each surface onto its real corners in the photo (top-left, top-right, bottom-right, bottom-left). Enter the real size so tiles render at the right scale.</p>
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
                  Width (m)
                  <input type="number" min={0.2} step={0.1} value={act.size[0]} onChange={(e) => patch(act.id, { size: [Number(e.target.value) || 0.2, act.size[1]] })} />
                </label>
                <label>
                  {act.type === 'floor' || act.type === 'countertop' ? 'Depth' : 'Height'} (m)
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
