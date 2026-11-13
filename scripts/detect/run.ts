/**
 * Node harness for the room detector (same core as the browser):
 *   npm run detect -- <photo> [--out dir] [--models dir] [--rugs] [--seg 960] [--ref-obj mask] [--ref-ids mask]
 * Writes overlay.jpg (surfaces, corners, perspective grids), objects.png, cutout.png and result.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { loadModels } from './node-models'
import { detectRoom } from '../../src/lib/detect/core'
import { applyH, squareToQuad } from '../../src/lib/homography'

const args = process.argv.slice(2)
const flag = (k: string, d?: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const photo = args[0]
const outDir = flag('--out', 'detect-out')!
const modelDir = flag('--models', process.env.DETECT_MODELS ?? 'public/models')!

const COLORS: Record<string, string> = { floor: '#ff8a3d', ceiling: '#00b5c8', wall: '#1e88ff' }
const WALLC = ['#1e88ff', '#c04cf0', '#2bb673', '#e0b000', '#ff4d6d']

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const src = sharp(photo).rotate()
  const meta = await src.metadata()
  const k = Math.min(1, 1600 / Math.max(meta.width!, meta.height!))
  const W = Math.round(meta.width! * k)
  const H = Math.round(meta.height! * k)
  const rgba = await src.resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
  const models = await loadModels(modelDir)
  const t = Date.now()
  const res = await detectRoom({ data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), width: W, height: H }, models, {
    tileOverRugs: args.includes('--rugs'),
    segSize: Number(flag('--seg', '768')),
    depthSize: Number(flag('--depth', '770')),
    detailSize: Number(flag('--detail', '0')),
    debug: args.includes('--debug')
      ? (name, data, w, h) => {
          const buf = Buffer.alloc(w * h)
          for (let i = 0; i < w * h; i++) buf[i] = data instanceof Uint8Array ? data[i] * 255 : Math.max(0, Math.min(255, 128 + data[i] * 1200))
          void sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path.join(outDir, `debug-${name}.png`))
        }
      : undefined,
  })
  const ms = Date.now() - t

  // overlay
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  let wi = 0
  for (const s of res.surfaces) {
    const col = s.type === 'wall' ? WALLC[wi++ % WALLC.length] : COLORS[s.type]
    const id = `c${res.surfaces.indexOf(s)}`
    const pts = s.area.map(([x, y]) => `${x * W},${y * H}`).join(' ')
    svg += `<clipPath id="${id}"><polygon points="${pts}"/></clipPath><polygon points="${pts}" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="3"/>`
    const Hm = squareToQuad(s.quad.map(([x, y]) => [x * W, y * H]) as [number, number][])
    let g = `<g clip-path="url(#${id})" stroke="${col}" stroke-width="1.6" stroke-opacity="0.95">`
    for (let u = -14; u <= 15; u += 0.5)
      for (let v = -14; v < 15; v += 0.5) {
        const w0 = Hm[6] * u + Hm[7] * v + Hm[8]
        const ok = (a: number, b: number) => (Hm[6] * a + Hm[7] * b + Hm[8]) / Hm[8] > 0.12
        if (!ok(u, v) || w0 === 0) continue
        const p = applyH(Hm, u, v)
        if (ok(u + 0.5, v)) {
          const q = applyH(Hm, u + 0.5, v)
          g += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`
        }
        if (ok(u, v + 0.5)) {
          const q = applyH(Hm, u, v + 0.5)
          g += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`
        }
      }
    svg += g + '</g>'
    svg += `<polygon points="${s.quad.map(([x, y]) => `${x * W},${y * H}`).join(' ')}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="9 6"/>`
  }
  svg += '</svg>'
  const objRgba = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    objRgba[i * 4] = 255
    objRgba[i * 4 + 1] = 40
    objRgba[i * 4 + 2] = 120
    objRgba[i * 4 + 3] = Math.round(res.objAlpha[i] * 0.45)
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: Buffer.from(svg) }, { input: objRgba, raw: { width: W, height: H, channels: 4 } }])
    .jpeg({ quality: 86 })
    .toFile(path.join(outDir, 'overlay.jpg'))
  await sharp(Buffer.from(res.objAlpha), { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(outDir, 'objects.png'))
  const lab = Buffer.from(res.labels.map((v) => (v ? 60 + v * 30 : 0)))
  await sharp(lab, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(outDir, 'labels.png'))
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ width: W, height: H, camera: res.camera, timings: res.timings, surfaces: res.surfaces }, null, 1))

  console.log(`${path.basename(photo)} ${W}x${H} in ${ms} ms`, JSON.stringify(res.timings))
  console.log(`  camera f=${res.camera.f.toFixed(0)} fov=${res.camera.fovDeg.toFixed(1)}° pitch=${res.camera.pitchDeg.toFixed(1)}° scale=${res.camera.scale.toFixed(2)}`)
  for (const s of res.surfaces) console.log(`  ${s.label.padEnd(8)} cover=${(s.cover * 100).toFixed(1)}% guide=${s.size[0]}m pts=${s.area.length}`)

  // optional comparison with reference masks (white = object; surface ids as grey levels)
  const refObj = flag('--ref-obj')
  if (refObj) {
    const r = await sharp(refObj).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer()
    let inter = 0
    let uni = 0
    let diff = 0
    // the reference does not offer the ceiling as a surface: count it as "object" for a fair comparison
    const ceil = args.includes('--ref-no-ceiling')
    const ours = (i: number) => res.objAlpha[i] > 127 || (ceil && res.labels[i] === 2)
    for (let i = 0; i < W * H; i++) {
      const a = ours(i)
      const b = r[i] > 127
      if (a && b) inter++
      if (a || b) uni++
      if (a !== b) diff++
    }
    console.log(`  vs reference object mask: IoU=${(inter / uni).toFixed(4)} pixel error=${((diff / (W * H)) * 100).toFixed(2)}%`)
    const vis = Buffer.alloc(W * H * 3)
    for (let i = 0; i < W * H; i++) {
      const a = ours(i)
      const b = r[i] > 127
      vis[i * 3] = a && !b ? 255 : a ? 255 : 0
      vis[i * 3 + 1] = a && b ? 255 : 0
      vis[i * 3 + 2] = !a && b ? 255 : a && b ? 255 : 0
    }
    await sharp(vis, { raw: { width: W, height: H, channels: 3 } }).jpeg().toFile(path.join(outDir, 'diff.jpg'))
  }
  const refIds = flag('--ref-ids')
  if (refIds) {
    const r = await sharp(refIds).resize(W, H, { fit: 'fill', kernel: 'nearest' }).greyscale().raw().toBuffer()
    // best one-to-one agreement between our surface ids and the reference ids
    const pairs = new Map<string, number>()
    let n = 0
    for (let i = 0; i < W * H; i++) {
      if (!r[i] || !res.labels[i]) continue
      n++
      const key = `${r[i]}:${res.labels[i]}`
      pairs.set(key, (pairs.get(key) ?? 0) + 1)
    }
    const byRef = new Map<number, [number, number]>()
    for (const [key, c] of pairs) {
      const [a, b] = key.split(':').map(Number)
      if (!byRef.has(a) || byRef.get(a)![1] < c) byRef.set(a, [b, c])
    }
    let agree = 0
    for (const [, [, c]] of byRef) agree += c
    console.log(`  vs reference surface ids: ${((agree / n) * 100).toFixed(2)}% of shared surface pixels get the same surface (${byRef.size} reference surfaces)`)
  }
}
if (photo) main().catch((e) => (console.error(e), process.exit(1)))
