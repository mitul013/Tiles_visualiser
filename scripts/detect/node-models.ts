/** Load the detection networks in Node (onnxruntime-node) from public/models (or any folder with manifest.json). */
import fs from 'node:fs'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import type { Models } from '../../src/lib/detect/core'

export async function loadModels(dir: string, threads = 4): Promise<Models> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { models: Record<string, { parts: string[]; bytes: number }> }
  const open = (key: string) => {
    const buf = Buffer.concat(manifest.models[key].parts.map((p) => fs.readFileSync(path.join(dir, p))))
    if (buf.length !== manifest.models[key].bytes) throw new Error(`model "${key}" is incomplete in ${dir}`)
    return ort.InferenceSession.create(buf, { intraOpNumThreads: threads })
  }
  const seg = await open('seg')
  const dep = await open('depth')
  return {
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
