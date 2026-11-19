/// <reference lib="webworker" />
/**
 * Room detection worker: downloads the two networks (once, then served from the browser cache),
 * runs them with ONNX Runtime (WebAssembly) and executes the detection pipeline off the UI thread.
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { detectRoom, type DetectOptions, type DetectResult, type Models } from './core'

export interface DetectRequest {
  id: number
  rgba: ArrayBuffer
  width: number
  height: number
  /** absolute URL of the folder holding manifest.json and the model parts */
  modelBase: string
  options?: Omit<DetectOptions, 'onProgress'>
}
export type DetectReply =
  | { id: number; type: 'progress'; stage: string; fraction: number }
  | { id: number; type: 'done'; result: Omit<DetectResult, 'labels'> }
  | { id: number; type: 'error'; message: string }

interface Manifest {
  version: string
  models: Record<'seg' | 'depth', { parts: string[]; bytes: number }> & { scale?: { parts: string[]; bytes: number } }
}

ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href }
// threads need a cross-origin isolated page (COOP/COEP headers); otherwise run single-threaded
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1

const CACHE = 'room-detect-models'

/** Download a model (split in parts so every file stays under static hosts' size limits). */
async function fetchModel(base: string, m: Manifest, key: 'seg' | 'depth' | 'scale', onBytes: (n: number) => void): Promise<Uint8Array> {
  const info = m.models[key]!
  const out = new Uint8Array(info.bytes)
  let cache: Cache | null = null
  try {
    cache = await caches.open(`${CACHE}-${m.version}`)
  } catch {
    cache = null // private mode / sandboxed frame: just download
  }
  let off = 0
  for (const part of info.parts) {
    const url = base + part
    let res = cache ? await cache.match(url).catch(() => undefined) : undefined
    if (!res) {
      res = await fetch(url)
      if (!res.ok) throw new Error(`Could not download the detection model (${res.status} for ${part})`)
      if (cache) await cache.put(url, res.clone()).catch(() => {})
    }
    const reader = res.body?.getReader()
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer())
      out.set(buf, off)
      off += buf.length
      onBytes(buf.length)
      continue
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.set(value, off)
      off += value.length
      onBytes(value.length)
    }
  }
  if (off !== info.bytes) throw new Error('The detection model download was incomplete. Please try again.')
  return out
}

let manifestCache: { base: string; m: Manifest } | null = null

async function run(req: DetectRequest, post: (r: DetectReply) => void) {
  const progress = (stage: string, fraction: number) => post({ id: req.id, type: 'progress', stage, fraction })
  if (!manifestCache || manifestCache.base !== req.modelBase) {
    const r = await fetch(req.modelBase + 'manifest.json')
    if (!r.ok) throw new Error('Detection models are not installed on this site (models/manifest.json is missing).')
    manifestCache = { base: req.modelBase, m: (await r.json()) as Manifest }
  }
  const m = manifestCache.m
  const total = m.models.seg.bytes + m.models.depth.bytes + (m.models.scale?.bytes ?? 0)
  let got = 0
  const onBytes = (n: number) => {
    got += n
    progress(`Loading the room-detection model (${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB, first time only)`, 0.02 + 0.28 * (got / total))
  }
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  // one network in memory at a time (phones): load, run, release
  const models: Models = {
    async segment(input, w, h) {
      const s = await ort.InferenceSession.create(await fetchModel(req.modelBase, m, 'seg', onBytes), opts)
      progress('Recognising walls, floor and furniture', 0.34)
      const o = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) })
      const t = o.logits
      const out = { data: t.data as Float32Array, width: t.dims[3], height: t.dims[2] }
      await s.release()
      return out
    },
    async depth(input, w, h) {
      const s = await ort.InferenceSession.create(await fetchModel(req.modelBase, m, 'depth', onBytes), opts)
      progress('Measuring the room in 3D', 0.5)
      const o = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) })
      const t = o.predicted_depth
      const out = { data: t.data as Float32Array, width: t.dims[2], height: t.dims[1] }
      await s.release()
      return out
    },
    ...(m.models.scale && {
      async scale(input: Float32Array, w: number, h: number) {
        const s = await ort.InferenceSession.create(await fetchModel(req.modelBase, m, 'scale', onBytes), opts)
        progress('Measuring the room size', 0.62)
        const o = await s.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) }, ['predicted_depth'])
        const t = o.predicted_depth
        const out = { data: t.data as Float32Array, width: t.dims[2], height: t.dims[1] }
        await s.release()
        return out
      },
    }),
  }
  const res = await detectRoom({ data: new Uint8ClampedArray(req.rgba), width: req.width, height: req.height }, models, {
    ...req.options,
    onProgress: (stage, f) => f > 0.85 && progress(stage, f),
  })
  const { labels: _labels, ...result } = res
  void _labels
  ;(self as unknown as Worker).postMessage({ id: req.id, type: 'done', result } satisfies DetectReply, [result.objAlpha.buffer as ArrayBuffer])
}

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const post = (r: DetectReply) => (self as unknown as Worker).postMessage(r)
  run(e.data, post).catch((err) => post({ id: e.data.id, type: 'error', message: err instanceof Error ? err.message : String(err) }))
}
