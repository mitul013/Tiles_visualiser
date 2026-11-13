/**
 * Room-detection backend: the same pipeline as the in-browser detector, on your own server, with a
 * larger segmentation network and finer settings than a phone can run.
 *
 *   npm run detect:server                       # http://localhost:8787
 *   PORT=9000 DETECT_ORIGIN=https://shop.example npm run detect:server
 *
 * POST /detect            body: the room photo (JPEG / PNG / WebP bytes)   ?rugs=1 tiles over rugs
 *   → { width, height, surfaces[], camera, objMask, classes }   objMask = greyscale PNG data URL (white = object)
 *   503 when the queue is full: the web app then detects in the browser instead
 * GET  /health            → { ok, model, queue }
 *
 * Point the web app at it by building with VITE_DETECT_API=https://your-host (docs/ROOM-DETECTION.md).
 * No third-party service is called: open models run locally on the CPU.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { detectRoom } from '../src/lib/detect/core'
import { loadModels } from '../scripts/detect/node-models'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const ORIGIN = process.env.DETECT_ORIGIN ?? '*'
const MAX_BYTES = 20 * 1024 * 1024
const MODEL_DIR = process.env.DETECT_MODELS ?? path.join(here, '..', 'public', 'models')
// larger segmentation network (Swin-L, 285 MB), built by: python scripts/detect/export_models.py --server
const LARGE = process.env.DETECT_SEG_MODEL ?? path.join(here, 'models', 'room-seg-large.onnx')
const useLarge = fs.existsSync(LARGE)
const THREADS = Number(process.env.DETECT_THREADS ?? Math.max(1, os.availableParallelism?.() ?? os.cpus().length))
// the large model at full size needs ~2.3 GB and ~23 s on 2 cores; smaller input on small machines
const SEG_SIZE = Number(process.env.DETECT_SEG ?? (useLarge ? (THREADS >= 4 ? 1280 : 960) : 960))
const DETAIL = Number(process.env.DETECT_DETAIL ?? 1218)
/** photos waiting or running; beyond this the server answers 503 and the browser does the work */
const MAX_QUEUE = Number(process.env.DETECT_MAX_QUEUE ?? 6)

const models = await loadModels(MODEL_DIR, THREADS, useLarge ? LARGE : undefined)
console.log(`segmentation: ${useLarge ? `large (${path.basename(LARGE)})` : 'standard (public/models)'}, ${SEG_SIZE} px; thin-object pass ${DETAIL || 'off'}; ${THREADS} threads`)

// one photo at a time: the networks already use every core
let queue: Promise<unknown> = Promise.resolve()
let waiting = 0
// the same photo uploaded again (refresh, second device) is answered from memory
const cache = new Map<string, string>()
const CACHE_MAX = 40

const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }
  const send = (code: number, body: unknown) => {
    if (res.headersSent) return
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
  if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, model: useLarge ? 'large' : 'standard', queue: waiting })
  if (req.method !== 'POST' || url.pathname !== '/detect') return send(404, { error: 'not found' })
  if (waiting >= MAX_QUEUE) return send(503, { error: 'busy' })
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BYTES) {
      send(413, { error: 'photo too large' })
      req.destroy()
    } else chunks.push(c)
  })
  req.on('end', () => {
    if (size > MAX_BYTES) return
    const body = Buffer.concat(chunks)
    const rugs = url.searchParams.get('rugs') === '1'
    const key = crypto.createHash('sha256').update(body).update(rugs ? 'r' : '').digest('hex')
    const hit = cache.get(key)
    if (hit) return send(200, hit)
    waiting++
    const job = queue.then(async () => {
      const src = sharp(body).rotate()
      const meta = await src.metadata()
      if (!meta.width || !meta.height) throw new Error('not an image')
      const k = Math.min(1, 1600 / Math.max(meta.width, meta.height))
      const W = Math.round(meta.width * k)
      const H = Math.round(meta.height * k)
      const rgba = await src.resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
      const t = Date.now()
      const r = await detectRoom({ data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), width: W, height: H }, models, { tileOverRugs: rugs, segSize: SEG_SIZE, detailSize: DETAIL })
      const png = await sharp(Buffer.from(r.objAlpha), { raw: { width: W, height: H, channels: 1 } }).png().toBuffer()
      console.log(`${new Date().toISOString()} ${W}x${H} ${r.surfaces.map((s) => s.label).join(', ')} in ${Date.now() - t} ms`)
      const json = JSON.stringify({ width: W, height: H, surfaces: r.surfaces, camera: r.camera, objMask: `data:image/png;base64,${png.toString('base64')}`, classes: { w: r.classW, h: r.classH, data: Buffer.from(r.classMap).toString('base64') } })
      cache.set(key, json)
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      send(200, json)
    })
    queue = job
      .catch((e) => {
        console.error(e)
        send(400, { error: e instanceof Error ? e.message : 'detection failed' })
      })
      .finally(() => waiting--)
  })
})
server.listen(PORT, () => console.log(`room detection service on http://localhost:${PORT} (models: ${MODEL_DIR})`))
