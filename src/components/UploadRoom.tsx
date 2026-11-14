import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, type PhotoSurface } from '../store'
import type { SurfaceType } from '../types'
import { Icon, Modal, toast } from './ui'
import { refineMaskCanvas } from '../lib/objectMask'
import { generateLayers, type RoomLayers } from '../lib/roomLayers'
import { detectSurfaces } from '../lib/detectSurfaces'
import { classesFromB64, detectRoomPhoto, type ObjClasses } from '../lib/detect'
import { applyH, extendQuad, squareToQuad, type Pt } from '../lib/homography'
import { enterLandscape, exitLandscape, useViewport } from '../lib/fullscreen'

const uid = () => Math.random().toString(36).slice(2, 10)

/** An entry of public/library/manifest.json (see scripts/library.cjs). */
interface LibraryRoom {
  id: string
  name: string
  category: string
  width: number
  height: number
  original: string
  matt: string
  glossy?: string
  surfaces: PhotoSurface[]
}

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
  /** first-screen source: the user's own files, or the bundled room library */
  const [source, setSource] = useState<'device' | 'library'>('device')
  const [library, setLibrary] = useState<LibraryRoom[] | null>(null)
  useEffect(() => {
    if (source !== 'library' || library) return
    fetch(`${import.meta.env.BASE_URL}library/manifest.json`)
      .then((r) => r.json())
      .then((m: { rooms: LibraryRoom[] }) => setLibrary(m.rooms))
      .catch(() => setLibrary([]))
  }, [source, library])
  /** Library rooms are fully prepared: cut-outs carry objects + lighting, surfaces carry exact planes. */
  const openLibraryRoom = (r: LibraryRoom) => {
    const st = useStore.getState()
    const url = (f: string) => `${import.meta.env.BASE_URL}${f}`
    const flat = (color: string) => {
      const c = document.createElement('canvas')
      c.width = c.height = 2
      const x = c.getContext('2d')!
      x.fillStyle = color
      x.fillRect(0, 0, 2, 2)
      return c.toDataURL('image/png')
    }
    // a copy saved earlier keeps its designs but takes the library's current surfaces (sizes get corrected)
    if (st.photoRooms.some((x) => x.id === r.id)) st.updatePhotoRoom(r.id, { surfaces: r.surfaces })
    else
      addRoom({
        id: r.id,
        name: r.name,
        image: url(r.original),
        width: r.width,
        height: r.height,
        surfaces: r.surfaces,
        // the cut-out's own semi-transparent pixels light the tiles: generated light maps stay neutral
        layers: { cutout: url(r.matt), cutoutGlossy: r.glossy ? url(r.glossy) : undefined, shadow: flat('#ffffff'), reflection: flat('#ffffff'), highlight: flat('#000000'), source: 'uploaded' },
        createdAt: Date.now(),
      })
    openRoom(r.id, {})
    close()
    toast(`${r.name} ready: pick a tile to apply`)
  }
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
  /** automatic detection in progress (stage text + 0..1) */
  const [detecting, setDetecting] = useState<{ stage: string; fraction: number } | null>(null)
  /** object layer of a room just detected automatically (shown in the editor for finishing touches) */
  const [detected, setDetected] = useState<string | null>(null)
  /** prepared cut-outs are an advanced option: shown open on roomy screens, folded away on phones */
  const [advOpen, setAdvOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 901px) and (min-height: 601px)').matches)
  /** tile over rugs instead of keeping them on top of the new floor */
  const [overRugs, setOverRugs] = useState(false)
  /**
   * Continue from the first screen.
   * auto = find floor, walls, ceiling and every object in front of them with the room-detection
   * models and open the visualiser straight away; otherwise mark surfaces by hand (or, with
   * prepared cut-outs, read the surfaces from their transparency).
   */
  const begin = async (auto = false) => {
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
    const src = c.toDataURL('image/jpeg', 0.9)
    if (auto && !start.matt) {
      setDetecting({ stage: 'Starting', fraction: 0 })
      try {
        const det = await detectRoomPhoto(c, (stage, fraction) => setDetecting({ stage, fraction }), { tileOverRugs: overRugs })
        if (!det.surfaces.length) throw new Error('No floor or wall was found in this photo')
        const surfs: PhotoSurface[] = det.surfaces.map((f) => ({ id: `s-${uid()}`, type: f.type, label: f.label, quad: f.quad, area: f.area, size: f.size, ...(f.openings && { openings: f.openings }) }))
        // open the editor with everything filled in: the user checks it, gives it finishing
        // touches if needed (areas, perspective guide, object brush) and presses "Use this room"
        setImg({ src, w: W, h: H })
        setSurfaces(surfs)
        setActive((surfs.find((x) => x.type === 'floor') ?? surfs[0]).id)
        setPrepared(null)
        setCutout({})
        setMode('surfaces')
        // strokes add to / erase from the detected object layer exactly as painted
        setSnap(false)
        setDetected(det.objMask)
        setObjClasses(det.classes ?? null)
        const walls = surfs.filter((x) => x.type === 'wall').length
        const parts = [surfs.some((x) => x.type === 'floor') && 'floor', walls && `${walls} wall${walls > 1 ? 's' : ''}`, surfs.some((x) => x.type === 'ceiling') && 'ceiling'].filter(Boolean)
        toast(`Detected: ${parts.join(', ')} and the objects in front. Check it, then press Use this room.`)
        return
      } catch (e) {
        // fall through to marking by hand, with the photo already loaded
        toast(`Automatic detection failed (${e instanceof Error ? e.message : 'unknown error'}). Mark the surfaces by hand.`)
      } finally {
        setDetecting(null)
      }
    }
    setImg({ src, w: W, h: H })
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
  /** editing an existing photo room (opened from the visualiser's "Surfaces" button) */
  const editingId = useStore((s) => s.editingRoomId)
  const editing = useStore((s) => s.photoRooms.find((r) => r.id === s.editingRoomId))
  useEffect(() => {
    if (!editing) return
    setImg({ src: editing.image, w: editing.width, h: editing.height })
    setName(editing.name)
    const surfs = structuredClone(editing.surfaces)
    setSurfaces(surfs)
    const sel = useStore.getState().selected
    setActive(surfs.find((x) => sel.includes(x.id))?.id ?? surfs[0]?.id ?? null)
    // a prepared cut-out already decides objects + lighting: hide the object / layer steps
    setPrepared(editing.layers && editing.layers.source !== 'generated' ? { glossy: editing.layers.cutoutGlossy } : null)
    // detected rooms already have a precise object layer: strokes add to / erase from it as painted
    // (colour snapping would re-segment the whole layer and lose objects coloured like the wall)
    if (editing.auto) setSnap(false)
    setObjClasses(editing.objClasses ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])
  const svgRef = useRef<SVGSVGElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'surfaces' | 'objects' | 'cutout'>('surfaces')
  const [brush, setBrush] = useState(28)
  /**
   * object tools: paint = add to the object layer, erase = rub out only what the brush touches,
   * remove = one tap removes that whole object, move = drag the zoomed photo around
   */
  const [objTool, setObjTool] = useState<'paint' | 'erase' | 'remove'>('paint')
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
  const photoRef = useRef<HTMLImageElement | null>(null)
  const painting = useRef(false)
  /**
   * The mask canvas is the single source of truth for the object layer. Every action changes only
   * the pixels it touches: a paint stroke adds (optionally snapped to the object's outline), the
   * eraser removes what it rubs, "remove object" clears one object. Nothing else is recomputed, so
   * an edit can never wipe the rest of the selection.
   */
  /** the stroke being painted, kept apart so that only this stroke is snapped to object edges */
  const strokeRef = useRef<HTMLCanvasElement | null>(null)
  const undoRef = useRef<ImageData[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const pushUndo = () => {
    const cv = maskRef.current
    if (!cv) return
    undoRef.current.push(cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height))
    if (undoRef.current.length > 8) undoRef.current.shift()
    setUndoCount(undoRef.current.length)
  }
  const refreshHasMask = () => {
    const cv = maskRef.current
    if (!cv) return
    const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data
    let any = false
    for (let i = 3; i < d.length; i += 16) if (d[i] > 20) {
      any = true
      break
    }
    setHasMask(any)
  }
  const undo = () => {
    const cv = maskRef.current
    const snapShot = undoRef.current.pop()
    if (!cv || !snapShot) return
    cv.getContext('2d')!.putImageData(snapShot, 0, 0)
    setUndoCount(undoRef.current.length)
    refreshHasMask()
  }
  /** detected class of every pixel (when the room was detected automatically) */
  const [objClasses, setObjClasses] = useState<ObjClasses | null>(null)
  /** Remove the whole object under a tap: the connected pink region of the same detected kind. */
  const removeObjectAt = (x: number, y: number) => {
    const cv = maskRef.current
    if (!cv) return
    const W = cv.width
    const H = cv.height
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const im = ctx.getImageData(0, 0, W, H)
    const d = im.data
    const px = Math.min(W - 1, Math.max(0, Math.round(x)))
    const py = Math.min(H - 1, Math.max(0, Math.round(y)))
    if (d[(py * W + px) * 4 + 3] <= 40) return toast('Tap on a pink object to remove it')
    const cls = objClasses ? classesFromB64(objClasses) : null
    const kind = (i: number) => (cls && objClasses ? cls[Math.min(objClasses.h - 1, Math.floor((((i / W) | 0) * objClasses.h) / H)) * objClasses.w + Math.min(objClasses.w - 1, Math.floor(((i % W) * objClasses.w) / W))] : 0)
    const start = py * W + px
    const want = kind(start)
    pushUndo()
    const seen = new Uint8Array(W * H)
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      d[i * 4 + 3] = 0
      const cx = i % W
      for (const n of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= W * H || seen[n]) continue
        seen[n] = 1
        // soft edge pixels belong to the object whatever their class; solid ones must be the same kind
        const al = d[n * 4 + 3]
        if (al > 40 && (al < 200 || kind(n) === want)) stack.push(n)
      }
    }
    ctx.putImageData(im, 0, 0)
    refreshHasMask()
  }
  const finishStroke = async () => {
    const cv = maskRef.current
    const stroke = strokeRef.current
    if (!cv || !img) return
    if (objTool !== 'paint' || !snap || !stroke) return refreshHasMask()
    // snap just this stroke to the object's outline, then add it to what was there before
    setBusy(true)
    await new Promise((r) => setTimeout(r, 20))
    if (!photoRef.current || photoRef.current.src !== img.src) {
      photoRef.current = new Image()
      photoRef.current.src = img.src
      await photoRef.current.decode()
    }
    const quads = surfaces.map((sf) => sf.quad.map(([x, y]) => [x * cv.width, y * cv.height] as [number, number]))
    const refined = refineMaskCanvas(photoRef.current, stroke, cv.width, cv.height, quads)
    const ctx = cv.getContext('2d')!
    const before = undoRef.current[undoRef.current.length - 1]
    if (before) ctx.putImageData(before, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(refined, 0, 0)
    stroke.getContext('2d')!.clearRect(0, 0, stroke.width, stroke.height)
    setBusy(false)
    refreshHasMask()
  }
  const last = useRef<[number, number] | null>(null)
  const toMask = (e: React.PointerEvent<HTMLCanvasElement>): [number, number, number] => {
    const cv = maskRef.current!
    const q = local(cv, e.clientX, e.clientY)
    return [(q.x / q.w) * cv.width, (q.y / q.h) * cv.height, (brush / q.w) * cv.width]
  }
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = maskRef.current
    if (!cv || pinch.current) return
    const [x, y, size] = toMask(e)
    const [lx, ly] = last.current ?? [x, y]
    const targets = [cv.getContext('2d')!]
    if (objTool === 'paint' && snap) {
      if (!strokeRef.current || strokeRef.current.width !== cv.width) {
        strokeRef.current = document.createElement('canvas')
        strokeRef.current.width = cv.width
        strokeRef.current.height = cv.height
      }
      targets.push(strokeRef.current.getContext('2d')!)
    }
    targets.forEach((ctx, k) => {
      ctx.globalCompositeOperation = objTool === 'erase' && k === 0 ? 'destination-out' : 'source-over'
      ctx.strokeStyle = ctx.fillStyle = 'rgba(255,40,120,1)'
      ctx.lineCap = 'round'
      ctx.lineWidth = size
      ctx.beginPath()
      ctx.moveTo(lx, ly)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    })
    last.current = [x, y]
    if (objTool === 'paint') setHasMask(true)
  }
  /** cursor that shows the tool and the real brush size */
  const brushCursor = (() => {
    if (mode !== 'objects') return 'default'
    if (objTool === 'remove') return 'crosshair'
    const d = Math.max(8, Math.min(100, Math.round(brush)))
    const c = d / 2 + 1
    const er = objTool === 'erase'
    // ring = the real brush size; a small brush / eraser picture beside it says which tool is active
    const ring = `<circle cx='${c}' cy='${c}' r='${d / 2}' fill='${er ? 'rgba(255,255,255,0.3)' : 'rgba(255,40,120,0.25)'}' stroke='black' stroke-width='2.4'/><circle cx='${c}' cy='${c}' r='${d / 2}' fill='none' stroke='${er ? 'white' : '%23ff2878'}' stroke-width='1.2' ${er ? "stroke-dasharray='4 3'" : ''}/>`
    const o = d * 0.85 + 2
    const icon = er
      ? `<g transform='translate(${o} ${o}) rotate(-45 9 9)'><rect x='1' y='5' width='16' height='9' rx='2' fill='white' stroke='black' stroke-width='1.3'/><rect x='1' y='5' width='6' height='9' rx='2' fill='%23ff8fb8' stroke='black' stroke-width='1.3'/></g>`
      : `<g transform='translate(${o} ${o})'><path d='M16 2L8 10' stroke='black' stroke-width='5' stroke-linecap='round'/><path d='M16 2L8 10' stroke='%23c98a4b' stroke-width='3' stroke-linecap='round'/><path d='M8 10L3 15' stroke='black' stroke-width='7' stroke-linecap='round'/><path d='M8 10L3 15' stroke='%23ff2878' stroke-width='5' stroke-linecap='round'/></g>`
    const size = Math.ceil(o + 20)
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${ring}${icon}</svg>`
    return `url("data:image/svg+xml,${svg}") ${c} ${c}, crosshair`
  })()

  // ── focus mode: the photo fills the screen, tools shrink to a slim bar, the rest sits in a drawer
  const vp = useViewport()
  const [focus, setFocus] = useState(false)
  const [drawer, setDrawer] = useState(false)
  /**
   * The editor box is drawn rotated a quarter turn: a landscape photo on a screen that is still
   * upright. Where the browser can turn the screen itself the viewport becomes landscape and this
   * switches off on its own, so it is decided from the real viewport, never from the lock call.
   */
  const rot = focus && !!img && img.w > img.h && vp.h > vp.w
  const rotRef = useRef(rot)
  rotRef.current = rot
  /** pointer position inside an element in that element's own (un-rotated) pixels */
  const local = (el: Element, cx: number, cy: number) => {
    const r = el.getBoundingClientRect()
    return rotRef.current ? { x: cy - r.top, y: r.right - cx, w: r.height, h: r.width } : { x: cx - r.left, y: cy - r.top, w: r.width, h: r.height }
  }
  const enterFocus = () => {
    setFocus(true)
    setDrawer(false)
    void enterLandscape(!!img && img.w > img.h)
  }
  const exitFocus = () => {
    setFocus(false)
    setDrawer(false)
    exitLandscape()
  }
  useEffect(() => () => exitLandscape(), [])
  // a phone held sideways has no room for the side panel: open straight into focus mode
  const autoFocused = useRef(false)
  useEffect(() => {
    if (!img) {
      autoFocused.current = false
      if (focus) exitFocus()
      return
    }
    if (!autoFocused.current && window.innerHeight <= 560 && window.innerWidth > window.innerHeight) {
      autoFocused.current = true
      setFocus(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img?.src])

  // ── zoom & pan: work precisely on a corner or a thin edge
  const viewRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [hand, setHand] = useState(false)
  const anchor = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null)
  const zoomTo = (z: number, clientX?: number, clientY?: number) => {
    const v = viewRef.current
    z = Math.min(8, Math.max(1, +z.toFixed(2)))
    if (v) {
      const c = v.getBoundingClientRect()
      const q = local(v, clientX ?? c.left + c.width / 2, clientY ?? c.top + c.height / 2)
      const px = q.x
      const py = q.y
      anchor.current = { fx: (v.scrollLeft + px) / v.scrollWidth, fy: (v.scrollTop + py) / v.scrollHeight, px, py }
    }
    setZoom(z)
    if (z === 1) setHand(false)
  }
  useLayoutEffect(() => {
    const v = viewRef.current
    const a = anchor.current
    if (!v || !a) return
    v.scrollLeft = a.fx * v.scrollWidth - a.px
    v.scrollTop = a.fy * v.scrollHeight - a.py
    anchor.current = null
  }, [zoom])
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    // Ctrl / ⌘ + wheel (and trackpad pinch) zooms around the pointer; plain wheel scrolls
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY)
    }
    v.addEventListener('wheel', onWheel, { passive: false })
    return () => v.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img?.src])
  const panFrom = useRef<{ x: number; y: number; l: number; t: number } | null>(null)
  /** touch screens: bigger corner handles, and two fingers on the photo pinch-zoom / pan it */
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number; mx: number; my: number; l: number; t: number } | null>(null)
  const pinchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size !== 2) return
    const [a, b] = [...touches.current.values()]
    const v = viewRef.current!
    pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoomRef.current, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, l: v.scrollLeft, t: v.scrollTop }
    // a second finger means "zoom", not "paint": drop the stroke the first finger started
    if (painting.current) {
      painting.current = false
      last.current = null
      strokeRef.current?.getContext('2d')!.clearRect(0, 0, strokeRef.current.width, strokeRef.current.height)
      undo()
    }
    drag.current = null
  }
  const pinchMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinch.current
    if (!p || touches.current.size !== 2) return
    const [a, b] = [...touches.current.values()]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const z = Math.min(8, Math.max(1, p.z * (Math.hypot(a.x - b.x, a.y - b.y) / p.d)))
    if (Math.abs(z - zoomRef.current) > 0.02) zoomTo(z, mx, my)
    else {
      const v = viewRef.current!
      const [dx, dy] = rotRef.current ? [my - p.my, -(mx - p.mx)] : [mx - p.mx, my - p.my]
      v.scrollLeft -= dx
      v.scrollTop -= dy
    }
    p.mx = mx
    p.my = my
  }
  const pinchUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
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
    const q = local(svgRef.current!, e.clientX, e.clientY)
    const f = (v: number) => Math.max(-1.5, Math.min(2.5, v))
    return [f(-PAD + (1 + 2 * PAD) * (q.x / q.w)), f(-PAD + (1 + 2 * PAD) * (q.y / q.h))]
  }

  useEffect(() => {
    const mask = editing?.objMask ?? detected
    if (!mask || !img) return
    const im = new Image()
    im.onload = () => {
      const cv = maskRef.current
      if (!cv) return
      cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height)
      undoRef.current = []
      setUndoCount(0)
      setHasMask(true)
    }
    im.src = mask
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, img?.src, detected])

  /** Save edits to an existing room in place; applied tiles stay on surfaces that still exist. */
  const saveEdit = async () => {
    if (!editing || !img) return
    const objMask = hasMask && maskRef.current ? maskRef.current.toDataURL('image/png') : undefined
    let layers = editing.layers
    if (Object.keys(cutout).length && !prepared) {
      const photo = new Image()
      photo.src = img.src
      await photo.decode()
      const cut = cutout.cutout ? new Image() : null
      if (cut) {
        cut.src = cutout.cutout!
        await cut.decode()
      }
      const quads = surfaces.map((sf) => (sf.area ?? sf.quad).map(([x, y]) => [x * img.w, y * img.h] as [number, number]))
      const gen = generateLayers(photo, img.w, img.h, quads, hasMask ? maskRef.current : null, cut)
      layers = { ...gen, ...cutout, source: LAYER_KEYS.every((k) => cutout[k]) ? 'uploaded' : 'mixed' }
    } else if (!layers || layers.source === 'generated') {
      // generated light maps depend on the surfaces / objects: rebuild them
      layers = undefined
    }
    useStore.getState().updatePhotoRoom(editing.id, { name, surfaces, objMask, layers })
    const st = useStore.getState()
    const ids = new Set(surfaces.map((x) => x.id))
    if (st.roomId === editing.id) {
      st.setApplied(Object.fromEntries(Object.entries(st.applied).filter(([k]) => ids.has(k))))
      const keep = st.selected.filter((x) => ids.has(x))
      st.select(keep.length ? keep : surfaces.slice(0, 1).map((x) => x.id))
    }
    close()
    toast('Surfaces updated')
  }

  const save = async () => {
    if (editing) return saveEdit()
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
    addRoom({ id, name, image: img.src, width: img.w, height: img.h, surfaces, objMask, layers, auto: detected ? true : undefined, objClasses: objClasses ?? undefined, createdAt: Date.now() })
    openRoom(id, {})
    useStore.getState().select(surfaces.filter((s) => s.type === 'floor').map((s) => s.id).slice(0, 1))
    close()
    toast('Room ready — pick a tile to apply')
  }

  const act = surfaces.find((s) => s.id === active)

  return (
    <Modal
      title={editing ? `Adjust surfaces · ${editing.name}` : 'Upload a picture of your room'}
      onClose={close}
      wide="xl"
      footer={
        img ? (
          <>
            <label className="inline">
              Room name <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <span className="grow" />
            {editing ? (
              <button className="btn" onClick={close}>
                Cancel
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  setImg(null)
                  setPrepared(null)
                  setCutout({})
                  setDetected(null)
                  setHasMask(false)
                  setObjClasses(null)
                  undoRef.current = []
                  setUndoCount(0)
                  zoomTo(1)
                }}
              >
                Change image
              </button>
            )}
            <button className="btn primary" disabled={!surfaces.length} onClick={save}>
              <Icon name="check" /> {editing ? 'Save changes' : 'Use this room'}
            </button>
          </>
        ) : null
      }
    >
      {!img && (
        <div className="seg source-seg">
          <button className={source === 'device' ? 'on' : ''} onClick={() => setSource('device')}>
            <Icon name="upload" size={15} /> From your device
          </button>
          <button className={source === 'library' ? 'on' : ''} onClick={() => setSource('library')}>
            <Icon name="grid" size={15} /> Library
          </button>
        </div>
      )}
      {!img && source === 'library' ? (
        <div className="library-grid">
          {library === null && <p className="hint">Loading library…</p>}
          {library?.length === 0 && <p className="hint">No library rooms available.</p>}
          {library?.map((r) => (
            <button key={r.id} className="room-card lib-card" onClick={() => openLibraryRoom(r)}>
              <img src={`${import.meta.env.BASE_URL}${r.original}`} alt={r.name} loading="lazy" />
              <span className="rc-cat">{r.category}</span>
              <div className="rc-foot">
                <b>{r.name}</b>
                <small>{r.surfaces.map((x) => x.label).join(' · ')}</small>
              </div>
            </button>
          ))}
        </div>
      ) : !img ? (
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
            <details className="adv-cutouts" open={advOpen} onToggle={(e) => setAdvOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Have prepared cut-outs? (optional)</summary>
            <p className="hint">
              Add the <b>matt</b> (and optionally <b>glossy</b>) version of the same photo with the tile area <b>transparent</b>. Surfaces are detected automatically, objects stay intact and the cut-out's own shadows light the tiles. The original photo is optional then.
            </p>
            {(['matt', 'glossy'] as const).map((k) => (
              <label key={k} className={`drop small${start[k] ? ' has' : ''}`}>
                {start[k] ? <img src={start[k]} alt={`${k} cut-out`} /> : <span>{k === 'matt' ? 'Matt cut-out (transparent tile area)' : 'Glossy cut-out (optional)'}</span>}
                <input type="file" accept="image/png,image/webp" hidden onChange={(e) => pickStart(k, e.target.files?.[0])} />
              </label>
            ))}
            </details>
            {start.matt ? (
              <button className="btn primary block" disabled={!start.photo && !start.matt} onClick={() => void begin()}>
                Detect surfaces & continue
              </button>
            ) : (
              <>
                <button className="btn primary block" disabled={!start.photo || !!detecting} onClick={() => void begin(true)}>
                  <Icon name="layers" size={15} /> {detecting ? 'Detecting…' : 'Detect room automatically'}
                </button>
                {detecting ? (
                  <div className="detect-progress" role="status" aria-live="polite">
                    <div className="bar">
                      <i style={{ width: `${Math.round(detecting.fraction * 100)}%` }} />
                    </div>
                    <span className="hint">{detecting.stage}</span>
                  </div>
                ) : (
                  <>
                    <p className="hint">
                      Finds the <b>floor, walls and ceiling</b>, splits walls at the room's corners, fits the perspective and keeps <b>furniture, plants, curtains and decor</b> on top. You can check and adjust the result before using the room.
                    </p>
                    <label className="check">
                      <input type="checkbox" checked={overRugs} onChange={(e) => setOverRugs(e.target.checked)} /> Tile over rugs (otherwise rugs stay on the new floor)
                    </label>
                    <button className="btn block" disabled={!start.photo} onClick={() => void begin()}>
                      Mark surfaces by hand instead
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={`room-editor${focus ? ' focus' : ''}${rot ? ' rot' : ''}`}>
          <div className="editor-main">
          {focus && (
            <>
              <button className="focus-btn exit" onClick={exitFocus} aria-label="Exit full screen" title="Exit full screen">
                <Icon name="close" size={18} /> Done
              </button>
              <button className="focus-btn gear" onClick={() => setDrawer(!drawer)} aria-label="Steps and options" title="Steps and options">
                <Icon name="settings" size={18} /> {mode === 'objects' ? 'Objects' : mode === 'surfaces' ? 'Surfaces' : 'Layers'}
              </button>
              <div className="focus-tools">
                {mode === 'objects' ? (
                  <>
                    <div className="seg">
                      <button className={objTool === 'paint' ? 'on' : ''} onClick={() => setObjTool('paint')} title="Paint">
                        <span className="lbl">Paint</span>
                      </button>
                      <button className={objTool === 'erase' ? 'on' : ''} onClick={() => setObjTool('erase')} title="Erase">
                        <span className="lbl">Erase</span>
                      </button>
                      <button className={objTool === 'remove' ? 'on' : ''} onClick={() => setObjTool('remove')} title="Remove a whole object">
                        <span className="lbl">Remove</span>
                      </button>
                    </div>
                    <input className="brush-range" type="range" min={6} max={90} value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label="Brush size" title="Brush size" />
                    <button className="btn sm" disabled={!undoCount} onClick={undo} aria-label="Undo" title="Undo">
                      <Icon name="undo" size={15} />
                    </button>
                  </>
                ) : mode === 'surfaces' ? (
                  <>
                    <select value={active ?? ''} onChange={(e) => setActive(e.target.value)} aria-label="Surface">
                      {surfaces.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <div className="seg">
                      <button className={tool === 'area' ? 'on' : ''} onClick={() => setTool('area')}>
                        Area
                      </button>
                      <button className={tool === 'perspective' ? 'on' : ''} onClick={() => setTool('perspective')}>
                        Guide
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          )}
          <div className="zoom-bar">
            <button className="btn sm" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out">
              −
            </button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="btn sm" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= 8} aria-label="Zoom in" title="Zoom in">
              +
            </button>
            <button className="btn sm" onClick={() => zoomTo(1)} disabled={zoom === 1}>
              Fit
            </button>
            <button className={`btn sm${hand ? ' primary' : ''}`} onClick={() => setHand(!hand)} disabled={zoom === 1} title="Drag the photo to move around while zoomed in">
              ✋ Move
            </button>
            <span className="hint">{coarse ? 'Pinch with two fingers to zoom' : 'Zoom in to work on small details (Ctrl + scroll also zooms)'}</span>
          </div>
          <div
            className={`editor-view${zoom > 1 ? ' zoomed' : ''}`}
            ref={viewRef}
            style={{ '--ar': img.w / img.h, '--zoom': zoom } as React.CSSProperties}
            onPointerDownCapture={pinchDown}
            onPointerMoveCapture={pinchMove}
            onPointerUpCapture={pinchUp}
            onPointerCancelCapture={pinchUp}
          >
          <div className="editor-stage" style={{ aspectRatio: `${img.w} / ${img.h}` }}>
            <img src={img.src} alt="room" draggable={false} />
            <canvas
              ref={maskRef}
              width={img.w}
              height={img.h}
              className="obj-mask"
              style={{ pointerEvents: mode === 'objects' ? 'auto' : 'none', cursor: brushCursor }}
              onPointerDown={(e) => {
                if (busy) return
                if (objTool === 'remove') {
                  const [x, y] = toMask(e)
                  return removeObjectAt(x, y)
                }
                pushUndo()
                painting.current = true
                last.current = null
                e.currentTarget.setPointerCapture(e.pointerId)
                paint(e)
              }}
              onPointerMove={(e) => painting.current && paint(e)}
              onPointerUp={() => {
                if (!painting.current) return
                painting.current = false
                last.current = null
                void finishStroke()
              }}
              onPointerCancel={() => {
                if (!painting.current) return
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
                if (!drag.current || pinch.current) return
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
                    <circle key={i} cx={x * 1000} cy={y * 1000} r={(coarse ? 16 : 10) / zoom} fill="#ff2878" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
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
                          r={(coarse ? (tool === 'area' ? 17 : 21) : tool === 'area' ? 11 : 15) / zoom}
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
            {hand && zoom > 1 && (
              <div
                className="pan-layer"
                onPointerDown={(e) => {
                  const v = viewRef.current!
                  e.currentTarget.setPointerCapture(e.pointerId)
                  panFrom.current = { x: e.clientX, y: e.clientY, l: v.scrollLeft, t: v.scrollTop }
                }}
                onPointerMove={(e) => {
                  const v = viewRef.current
                  const f = panFrom.current
                  if (!v || !f) return
                  const [dx, dy] = rotRef.current ? [e.clientY - f.y, -(e.clientX - f.x)] : [e.clientX - f.x, e.clientY - f.y]
                  v.scrollLeft = f.l - dx
                  v.scrollTop = f.t - dy
                }}
                onPointerUp={() => (panFrom.current = null)}
                onPointerCancel={() => (panFrom.current = null)}
              />
            )}
          </div>
          </div>
          {!focus && (
            <button className="fs-btn" onClick={enterFocus} aria-label="Full screen" title="Edit full screen">
              <Icon name="full" size={18} />
            </button>
          )}
          </div>
          {focus && drawer && <div className="drawer-back" onClick={() => setDrawer(false)} />}
          <div className={`editor-side${focus && drawer ? ' open' : ''}`}>
            {focus && (
              <div className="drawer-head">
                <b>Steps and options</b>
                <button className="x" onClick={() => setDrawer(false)} aria-label="Close options">
                  <Icon name="close" />
                </button>
              </div>
            )}
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
                <p className="hint">Pink marks everything standing in front of the floor or walls (sofa, bed, taps, plants, window frames). Those pixels stay on top, untouched, whatever tiles or colours you apply.</p>
                <label className="inline">
                  Brush <input type="range" min={6} max={90} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                </label>
                <div className="seg obj-tools">
                  <button className={objTool === 'paint' ? 'on' : ''} onClick={() => setObjTool('paint')} title="Paint: keep something on top of the tiles">
                    🖌 Paint
                  </button>
                  <button className={objTool === 'erase' ? 'on' : ''} onClick={() => setObjTool('erase')} title="Erase: rub out only the part you touch">
                    ◌ Erase
                  </button>
                  <button className={objTool === 'remove' ? 'on' : ''} onClick={() => setObjTool('remove')} title="Remove object: one tap removes that whole object">
                    ✕ Remove object
                  </button>
                </div>
                <p className="hint tool-hint">
                  {objTool === 'paint'
                    ? 'Paint over anything that should stay on top of the tiles. Only what you paint is added.'
                    : objTool === 'erase'
                      ? 'Rub out a part of the pink layer. Only what the eraser touches is removed; everything else stays.'
                      : 'Tap a pink object to remove all of it at once (tiles will then cover it). Other objects stay.'}
                </p>
                {objTool === 'paint' && (
                  <label className="check">
                    <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap my stroke to the object's edges (paint roughly, we follow the outline)
                  </label>
                )}
                {busy && <span className="hint">Finding object edges…</span>}
                <div className="row">
                  <button className="btn sm" disabled={!undoCount} onClick={undo}>
                    <Icon name="undo" size={14} /> Undo
                  </button>
                  <button
                    className="btn sm"
                    disabled={!hasMask}
                    onClick={() => {
                      const cv = maskRef.current
                      if (!cv) return
                      pushUndo()
                      cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height)
                      setHasMask(false)
                    }}
                  >
                    Clear all objects
                  </button>
                </div>
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
              {detected
                ? 'Everything here was detected automatically: each coloured area is a surface, pink is the object layer that stays on top. Adjust an area or its perspective guide here, fix objects in step 2 (paint to keep something on top, erase to tile over it), then press Use this room.'
                : prepared
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
