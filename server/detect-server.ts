/**
 * Optional room-detection backend: the same pipeline as the in-browser detector, on your server.
 *
 *   npm run detect:server                       # http://localhost:8787
 *   PORT=9000 DETECT_ORIGIN=https://shop.example npm run detect:server
 *
 * POST /detect            body: the room photo (JPEG / PNG / WebP bytes)   ?rugs=1 tiles over rugs
 *   → { width, height, surfaces[], camera, objMask }   objMask = greyscale PNG data URL (white = object)
 * GET  /health            → { ok: true }
 *
 * Point the web app at it by building with VITE_DETECT_API=https://your-host (see docs/ROOM-DETECTION.md).
 * No third-party service is called: the two open models in public/models run locally on the CPU.
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { detectRoom } from '../src/lib/detect/core'
import { loadModels } from '../scripts/detect/node-models'

const PORT = Number(process.env.PORT ?? 8787)
const ORIGIN = process.env.DETECT_ORIGIN ?? '*'
const MAX_BYTES = 20 * 1024 * 1024
const MODEL_DIR = process.env.DETECT_MODELS ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')

const models = await loadModels(MODEL_DIR, Number(process.env.DETECT_THREADS ?? 4))
// one photo at a time: the networks already use every core
let queue: Promise<unknown> = Promise.resolve()

const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
  if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true })
  if (req.method !== 'POST' || url.pathname !== '/detect') return send(404, { error: 'not found' })
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
    const job = queue.then(async () => {
      const src = sharp(Buffer.concat(chunks)).rotate()
      const meta = await src.metadata()
      if (!meta.width || !meta.height) throw new Error('not an image')
      const k = Math.min(1, 1600 / Math.max(meta.width, meta.height))
      const W = Math.round(meta.width * k)
      const H = Math.round(meta.height * k)
      const rgba = await src.resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
      const t = Date.now()
      const r = await detectRoom({ data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), width: W, height: H }, models, {
        tileOverRugs: url.searchParams.get('rugs') === '1',
        // a server has the CPU for the larger settings: finer masks and the thin-object pass
        segSize: Number(process.env.DETECT_SEG ?? 960),
        detailSize: Number(process.env.DETECT_DETAIL ?? 1218),
      })
      const png = await sharp(Buffer.from(r.objAlpha), { raw: { width: W, height: H, channels: 1 } }).png().toBuffer()
      console.log(`${new Date().toISOString()} ${W}x${H} ${r.surfaces.map((s) => s.label).join(', ')} in ${Date.now() - t} ms`)
      send(200, { width: W, height: H, surfaces: r.surfaces, camera: r.camera, objMask: `data:image/png;base64,${png.toString('base64')}` })
    })
    queue = job.catch((e) => {
      console.error(e)
      send(400, { error: e instanceof Error ? e.message : 'detection failed' })
    })
  })
})
server.listen(PORT, () => console.log(`room detection service on http://localhost:${PORT} (models: ${MODEL_DIR})`))
