/**
 * Automatic room detection for uploaded photos (browser entry point).
 *
 * By default everything runs in the visitor's browser (no server, photos never leave the device).
 * Set VITE_DETECT_API to the URL of the bundled Node service (server/detect-server.ts) to run the
 * same pipeline on your own backend instead: faster on phones, and nothing to download.
 */
import type { DetectedSurface, DetectResult } from './core'
import type { DetectReply, DetectRequest } from './worker'

export type { DetectedSurface }

export interface RoomDetection {
  width: number
  height: number
  surfaces: DetectedSurface[]
  /** object layer as a PNG data URL (opaque = object in front of the surfaces) */
  objMask: string
  camera: DetectResult['camera']
  /** class id of every pixel at low resolution (base64 bytes): used by "Remove object" */
  classes?: ObjClasses
}
export interface ObjClasses {
  w: number
  h: number
  data: string
}

const toB64 = (a: Uint8Array) => {
  let s = ''
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000))
  return btoa(s)
}
export const classesFromB64 = (c: ObjClasses) => Uint8Array.from(atob(c.data), (ch) => ch.charCodeAt(0))

const API: string | undefined = import.meta.env.VITE_DETECT_API
const MODEL_BASE: string = import.meta.env.VITE_MODEL_BASE ?? `${import.meta.env.BASE_URL}models/`

let worker: Worker | null = null
let seq = 0

/** Paint the object alpha into the pink mask PNG the room editor works with. */
function maskToDataUrl(alpha: Uint8Array, W: number, H: number): string {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 40
    img.data[i * 4 + 2] = 120
    img.data[i * 4 + 3] = alpha[i]
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/**
 * Detect floor, walls, ceiling and objects in a room photo.
 * @param photo canvas holding the photo at the size the room will be stored at
 */
export async function detectRoomPhoto(photo: HTMLCanvasElement, onProgress: (stage: string, fraction: number) => void, options: { tileOverRugs?: boolean } = {}): Promise<RoomDetection> {
  const W = photo.width
  const H = photo.height
  if (API) {
    onProgress('Analysing the room', 0.2)
    const blob = await new Promise<Blob>((res, rej) => photo.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo'))), 'image/jpeg', 0.92))
    const r = await fetch(`${API.replace(/\/$/, '')}/detect${options.tileOverRugs ? '?rugs=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
    if (!r.ok) throw new Error(`Room detection service answered ${r.status}`)
    const j = (await r.json()) as { width: number; height: number; surfaces: DetectedSurface[]; objMask: string; camera: DetectResult['camera']; classes?: ObjClasses }
    // the service returns the mask as a greyscale PNG; convert it to the editor's alpha mask
    const im = new Image()
    im.src = j.objMask
    await im.decode()
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(im, 0, 0, W, H)
    const d = ctx.getImageData(0, 0, W, H).data
    const alpha = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) alpha[i] = d[i * 4]
    onProgress('Done', 1)
    return { width: W, height: H, surfaces: j.surfaces, objMask: maskToDataUrl(alpha, W, H), camera: j.camera, classes: j.classes }
  }
  const rgba = photo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = ++seq
  return new Promise<RoomDetection>((resolve, reject) => {
    const onMsg = (e: MessageEvent<DetectReply>) => {
      const m = e.data
      if (m.id !== id) return
      if (m.type === 'progress') return onProgress(m.stage, m.fraction)
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      if (m.type === 'error') return reject(new Error(m.message))
      resolve({ width: W, height: H, surfaces: m.result.surfaces, objMask: maskToDataUrl(m.result.objAlpha, W, H), camera: m.result.camera, classes: { w: m.result.classW, h: m.result.classH, data: toB64(m.result.classMap) } })
    }
    const onErr = (e: ErrorEvent) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      worker = null
      reject(new Error(e.message || 'Room detection could not start in this browser'))
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)
    const req: DetectRequest = { id, rgba: rgba.buffer as ArrayBuffer, width: W, height: H, modelBase: new URL(MODEL_BASE, document.baseURI).href, options }
    w.postMessage(req, [req.rgba])
  })
}
