/**
 * Load the detection networks in Node (onnxruntime-node) from public/models (or any folder with
 * manifest.json). `segModel` swaps in a larger segmentation network (server only, see
 * scripts/detect/export_models.py --server); it reads the same input and gives the same 150 classes.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import type { Models } from '../../src/lib/detect/core'

export async function loadModels(dir: string, threads = 4, segModel?: string): Promise<Models> {
  // memory: without these the runtime keeps every run's peak allocation reserved per model
  // (5+ GB with the large model); with them a server needs about half (see docs/ROOM-DETECTION.md)
  const lean = process.env.DETECT_LEAN !== '0'
  const opts: ort.InferenceSession.SessionOptions = { intraOpNumThreads: threads, ...(lean && { enableCpuMemArena: false, enableMemPattern: false }) }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { models: Record<string, { parts: string[]; bytes: number }> }
  const open = (key: string) => {
    const buf = Buffer.concat(manifest.models[key].parts.map((p) => fs.readFileSync(path.join(dir, p))))
    if (buf.length !== manifest.models[key].bytes) throw new Error(`model "${key}" is incomplete in ${dir}`)
    return ort.InferenceSession.create(buf, opts)
  }
  const seg = segModel ? await ort.InferenceSession.create(segModel, opts) : await open('seg')
  const dep = await open('depth')
  const sc = manifest.models.scale ? await open('scale') : null
  return {
    ...(sc && {
      async scale(input: Float32Array, w: number, h: number) {
        const t = (await sc.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) }, ['predicted_depth'])).predicted_depth
        return { data: t.data as Float32Array, width: t.dims[2], height: t.dims[1] }
      },
    }),
    async segment(input, w, h) {
      const t = (await seg.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) })).logits
      return { data: t.data as Float32Array, width: t.dims[3], height: t.dims[2] }
    },
    async depth(input, w, h) {
      const t = (await dep.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, h, w]) })).predicted_depth
      return { data: t.data as Float32Array, width: t.dims[2], height: t.dims[1] }
    },
  }
}
