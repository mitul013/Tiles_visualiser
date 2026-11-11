import { useRef, useState } from 'react'
import { useStore, type PhotoSurface } from '../store'
import type { SurfaceType } from '../types'
import { Icon, Modal, toast } from './ui'

const uid = () => Math.random().toString(36).slice(2, 10)

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

  const save = () => {
    if (!img) return
    const id = `photo-${uid()}`
    addRoom({ id, name, image: img.src, width: img.w, height: img.h, surfaces, createdAt: Date.now() })
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
            <svg
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
          </div>
        </div>
      )}
    </Modal>
  )
}
