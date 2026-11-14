/**
 * Build a 360° demo room from an equirectangular photo (e.g. a CC0 Poly Haven interior):
 *   npx tsx scripts/pano/build.ts <pano.jpg> --id <id> --name "<name>" --category <cat> [--yaw deg] [--cam 1.6] [--seg-model large.onnx]
 *
 * 1. the panorama is cut into 16 perspective views; each is segmented (same networks as the photo
 *    detector) and the class probabilities are projected back onto the sphere
 * 2. floor / wall / ceiling masks are refined against the photo's edges (guided filter)
 * 3. the room is fitted as a box (Manhattan layout) from the floor-wall and ceiling-wall lines:
 *    camera height + 4 wall distances + rotation; the ceiling height follows. Tiles are then mapped
 *    onto that geometry at real size
 * 4. a shading map (photo brightness / the surface's typical brightness) carries the room's light,
 *    shadows and reflections onto the new tiles
 *
 * Writes public/library/<id>/{pano.webp, mask.webp, shade.webp, thumb.webp} and adds the room to
 * public/library/manifest.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { loadModels } from '../detect/node-models'
import { boxBlur, guidedFilterColor, toTensor } from '../../src/lib/detect/imageops'

const args = process.argv.slice(2)
const flag = (k: string, d?: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const src = args[0]
const id = flag('--id')!
const name = flag('--name', id)!
const category = flag('--category', 'Living Room')!
const segModel = flag('--seg-model', fs.existsSync('server/models/room-seg-large.onnx') ? 'server/models/room-seg-large.onnx' : undefined)
const CAM = Number(flag('--cam', '1.6'))

// ADE20K classes
const C_WALL = 0
const C_FLOOR = [3, 11, 52]
const C_CEILING = 5

const PW = 4096 // panorama width shipped
const MW = 2048 // mask / analysis width
const MH = MW / 2

import { dirOf, dot, renderView, view, type V3, type View } from './geom'

async function main() {
  const t0 = Date.now()
  const outDir = path.resolve('public/library', id)
  fs.mkdirSync(outDir, { recursive: true })
  const base = sharp(src, { limitInputPixels: false }).removeAlpha()
  await base.clone().resize(PW, PW / 2).webp({ quality: 84 }).toFile(path.join(outDir, 'pano.webp'))
  const big = await sharp(src, { limitInputPixels: false }).removeAlpha().resize(PW, PW / 2).raw().toBuffer()
  const small = await sharp(src, { limitInputPixels: false }).removeAlpha().resize(MW, MH).raw().toBuffer()

  // ── 1. segment views, accumulate class probabilities on the sphere (MW x MH)
  const models = await loadModels('public/models', 4, segModel)
  const N = 1024
  const views: View[] = []
  for (let k = 0; k < 8; k++) views.push(view(k * 45, -35))
  for (let k = 0; k < 6; k++) views.push(view(k * 60 + 30, 32))
  views.push(view(0, -89.9), view(0, 89.9))
  const acc = { f: new Float32Array(MW * MH), w: new Float32Array(MW * MH), c: new Float32Array(MW * MH), n: new Float32Array(MW * MH) }
  const dirs: V3[] = new Array(MW * MH)
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) dirs[y * MW + x] = dirOf(((x + 0.5) / MW - 0.5) * 2 * Math.PI, (0.5 - (y + 0.5) / MH) * Math.PI)
  for (const [vi, v] of views.entries()) {
    const rgba = renderView(big, PW, PW / 2, 3, v, N)
    const seg = await models.segment(toTensor(rgba, N, N, N, N), N, N)
    const sw = seg.width
    const sh = seg.height
    const sn = sw * sh
    const nc = Math.round(seg.data.length / sn)
    const pf = new Float32Array(sn)
    const pw = new Float32Array(sn)
    const pc = new Float32Array(sn)
    for (let i = 0; i < sn; i++) {
      let mx = -Infinity
      for (let c = 0; c < nc; c++) mx = Math.max(mx, seg.data[c * sn + i])
      let sum = 0
      for (let c = 0; c < nc; c++) sum += Math.exp(seg.data[c * sn + i] - mx)
      const p = (c: number) => Math.exp(seg.data[c * sn + i] - mx) / sum
      pf[i] = C_FLOOR.reduce((s, c) => s + p(c), 0)
      pw[i] = p(C_WALL)
      pc[i] = p(C_CEILING)
    }
    for (let i = 0; i < MW * MH; i++) {
      const d = dirs[i]
      const z = dot(d, v.F)
      if (z <= 0.2) continue
      const x = dot(d, v.R) / z / v.t
      const y = dot(d, v.U) / z / v.t
      if (Math.abs(x) >= 0.98 || Math.abs(y) >= 0.98) continue
      const px = Math.min(sw - 1.001, Math.max(0, ((x + 1) / 2) * sw - 0.5))
      const py = Math.min(sh - 1.001, Math.max(0, ((1 - y) / 2) * sh - 0.5))
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const fx = px - x0
      const fy = py - y0
      const s = (a: Float32Array) => (a[y0 * sw + x0] * (1 - fx) + a[y0 * sw + x0 + 1] * fx) * (1 - fy) + (a[(y0 + 1) * sw + x0] * (1 - fx) + a[(y0 + 1) * sw + x0 + 1] * fx) * fy
      const wgt = z ** 4 * (1 - Math.max(Math.abs(x), Math.abs(y)) ** 6)
      acc.f[i] += s(pf) * wgt
      acc.w[i] += s(pw) * wgt
      acc.c[i] += s(pc) * wgt
      acc.n[i] += wgt
    }
    process.stdout.write(`\r  segmented view ${vi + 1}/${views.length}`)
  }
  console.log()
  for (let i = 0; i < MW * MH; i++) {
    const n = acc.n[i] || 1
    acc.f[i] /= n
    acc.w[i] /= n
    acc.c[i] /= n
  }

  // ── 2. refine against the photo, classify: 0 object, 1 floor, 2 wall, 3 ceiling
  const R = new Float32Array(MW * MH)
  const G = new Float32Array(MW * MH)
  const B = new Float32Array(MW * MH)
  for (let i = 0; i < MW * MH; i++) {
    R[i] = small[i * 3] / 255
    G[i] = small[i * 3 + 1] / 255
    B[i] = small[i * 3 + 2] / 255
  }
  const ref = (p: Float32Array) => guidedFilterColor([R, G, B], p, MW, MH, 4, 1e-3)
  const f = ref(acc.f)
  const w = ref(acc.w)
  const c = ref(acc.c)
  const cls = new Uint8Array(MW * MH)
  for (let i = 0; i < MW * MH; i++) {
    const o = 1 - f[i] - w[i] - c[i]
    cls[i] = o >= f[i] && o >= w[i] && o >= c[i] ? 0 : f[i] >= w[i] && f[i] >= c[i] ? 1 : c[i] >= w[i] ? 3 : 2
  }

  // ── 3. layout: floor-wall and ceiling-wall lines -> Manhattan box
  const latOf = (y: number) => (0.5 - (y + 0.5) / MH) * Math.PI
  const lonOf = (x: number) => ((x + 0.5) / MW - 0.5) * 2 * Math.PI
  const floorPts: { lon: number; r: number; x: number }[] = []
  const ceilPts: { lon: number; tanE: number }[] = []
  for (let x = 0; x < MW; x++) {
    for (let y = MH / 2 + 2; y < MH - 2; y++) {
      const k = cls[y * MW + x]
      if (k === 1) {
        if (cls[(y - 2) * MW + x] === 2 && cls[(y - 4) * MW + x] === 2) {
          const r = CAM / Math.tan(-latOf(y - 0.5))
          if (r < 15 * CAM) floorPts.push({ lon: lonOf(x), r, x })
        }
        break
      }
      if (k !== 2) break
    }
    for (let y = MH / 2 - 2; y > 2; y--) {
      const k = cls[y * MW + x]
      if (k === 3) {
        if (cls[(y + 2) * MW + x] === 2 && cls[(y + 4) * MW + x] === 2) ceilPts.push({ lon: lonOf(x), tanE: Math.tan(latOf(y + 0.5)) })
        break
      }
      if (k !== 2) break
    }
  }
  if (floorPts.length < 40) throw new Error(`too little visible floor-wall line (${floorPts.length} columns)`)
  const P = floorPts.map((p) => [p.r * Math.sin(p.lon), p.r * Math.cos(p.lon)] as [number, number])
  // dominant direction from the line's local tangents (mod 90°)
  let sx = 0
  let sy = 0
  const seg: { a: number; i: number }[] = []
  for (let i = 0; i + 3 < P.length; i++) {
    if (floorPts[i + 3].x - floorPts[i].x > 6) continue
    const dx = P[i + 3][0] - P[i][0]
    const dz = P[i + 3][1] - P[i][1]
    const len = Math.hypot(dx, dz)
    if (len < 0.02 || len > 0.6) continue
    const a = Math.atan2(dz, dx)
    sx += Math.cos(4 * a) * len
    sy += Math.sin(4 * a) * len
    seg.push({ a, i })
  }
  const phi = Math.atan2(sy, sx) / 4
  const rot = ([x, z]: [number, number]) => [x * Math.cos(-phi) - z * Math.sin(-phi), x * Math.sin(-phi) + z * Math.cos(-phi)] as [number, number]
  const sides: Record<'x0' | 'x1' | 'z0' | 'z1', number[]> = { x0: [], x1: [], z0: [], z1: [] }
  for (const s of seg) {
    const rel = s.a - phi
    const [x, z] = rot(P[s.i])
    if (Math.abs(Math.cos(rel)) > 0.94) (z > 0 ? sides.z1 : sides.z0).push(z)
    else if (Math.abs(Math.sin(rel)) > 0.94) (x > 0 ? sides.x1 : sides.x0).push(x)
  }
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
  const RP = P.map(rot)
  const far = (k: 0 | 1, sign: number) => {
    const v = RP.map((p) => p[k] * sign).filter((q) => q > 0).sort((p, q) => p - q)
    return sign * (v[Math.floor(v.length * 0.97)] ?? 2)
  }
  const box = {
    phi,
    x0: sides.x0.length > 8 ? med(sides.x0) : far(0, -1),
    x1: sides.x1.length > 8 ? med(sides.x1) : far(0, 1),
    z0: sides.z0.length > 8 ? med(sides.z0) : far(1, -1),
    z1: sides.z1.length > 8 ? med(sides.z1) : far(1, 1),
    h: CAM,
    H: 2.7,
  }
  // distance to the box walls along a horizontal direction
  const rBox = (lon: number) => {
    const dx = Math.sin(lon) * Math.cos(-phi) - Math.cos(lon) * Math.sin(-phi)
    const dz = Math.sin(lon) * Math.sin(-phi) + Math.cos(lon) * Math.cos(-phi)
    return Math.min(dx > 0 ? box.x1 / dx : dx < 0 ? box.x0 / dx : Infinity, dz > 0 ? box.z1 / dz : dz < 0 ? box.z0 / dz : Infinity)
  }
  const hs = ceilPts.map((p) => rBox(p.lon) * p.tanE).filter((v) => v > 0.3 && v < 6)
  const above = hs.length > 30 ? med(hs) : 1.1
  // camera height is unknown: keep 1.6 m unless that makes the ceiling implausible
  let k = 1
  const Hc = CAM + above
  if (Hc < 2.4) k = 2.4 / Hc
  if (Hc > 3.4) k = 3.4 / Hc
  box.x0 *= k
  box.x1 *= k
  box.z0 *= k
  box.z1 *= k
  box.h = CAM * k
  box.H = Hc * k
  console.log(`  box ${(box.x1 - box.x0).toFixed(2)} x ${(box.z1 - box.z0).toFixed(2)} m, ceiling ${box.H.toFixed(2)} m, camera ${box.h.toFixed(2)} m, rotation ${((phi * 180) / Math.PI).toFixed(1)}°; sides x0 ${sides.x0.length} x1 ${sides.x1.length} z0 ${sides.z0.length} z1 ${sides.z1.length}, ceiling pts ${hs.length}`)

  // ── 4. shading: brightness / the surface's typical brightness, lightly smoothed
  const lum = new Float32Array(MW * MH)
  for (let i = 0; i < MW * MH; i++) lum[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]
  const L = boxBlur(lum, MW, MH, 2)
  const typical = [1, 2, 3].map((k) => {
    const v: number[] = []
    for (let i = 0; i < MW * MH; i += 7) if (cls[i] === k) v.push(L[i])
    return v.length ? med(v) : 0.5
  })
  const shade = Buffer.alloc(MW * MH)
  for (let i = 0; i < MW * MH; i++) {
    const t = cls[i] ? typical[cls[i] - 1] : 0.5
    shade[i] = Math.max(0, Math.min(255, Math.round((L[i] / Math.max(0.03, t)) * 127.5)))
  }
  await sharp(shade, { raw: { width: MW, height: MH, channels: 1 } }).webp({ quality: 90 }).toFile(path.join(outDir, 'shade.webp'))

  // mask: R floor, G wall, B ceiling coverage (soft edges); objects are the rest
  const mask = Buffer.alloc(MW * MH * 3)
  const soft = (a: Float32Array, i: number, k: number) => {
    // hard class, softened over a pixel at class borders
    const v = cls[i] === k ? 1 : 0
    return Math.round(Math.max(0, Math.min(1, v * 0.85 + Math.max(0, Math.min(1, (a[i] - 0.35) / 0.3)) * 0.15)) * 255)
  }
  for (let i = 0; i < MW * MH; i++) {
    mask[i * 3] = soft(f, i, 1)
    mask[i * 3 + 1] = soft(w, i, 2)
    mask[i * 3 + 2] = soft(c, i, 3)
  }
  await sharp(mask, { raw: { width: MW, height: MH, channels: 3 } }).blur(0.6).webp({ lossless: true }).toFile(path.join(outDir, 'mask.webp'))

  // ── 5. surfaces (box faces), ordered round the room; thumbnail
  const yaw = Number(flag('--yaw', '0'))
  const faces = [
    { face: 'z1', w: box.x1 - box.x0, at: Math.atan2(0, 1) },
    { face: 'x1', w: box.z1 - box.z0, at: Math.PI / 2 },
    { face: 'z0', w: box.x1 - box.x0, at: Math.PI },
    { face: 'x0', w: box.z1 - box.z0, at: -Math.PI / 2 },
  ].map((q) => ({ ...q, lon: (((q.at + phi - (yaw * Math.PI) / 180 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) }))
  faces.sort((a, b) => a.lon - b.lon)
  const uid = () => `s-${Math.random().toString(36).slice(2, 10)}`
  const r2 = (v: number) => Math.round(v * 100) / 100
  const surfaces = [
    { id: uid(), label: 'Floor', type: 'floor', face: 'floor', quad: [], size: [r2(box.x1 - box.x0), r2(box.z1 - box.z0)] },
    ...faces.map((q, i) => ({ id: uid(), label: `Wall ${i + 1}`, type: 'wall', face: q.face, quad: [], size: [r2(q.w), r2(box.H)] })),
    { id: uid(), label: 'Ceiling', type: 'ceiling', face: 'ceiling', quad: [], size: [r2(box.x1 - box.x0), r2(box.z1 - box.z0)] },
  ]
  const tv = view(yaw, -12, 100)
  const thumb = renderView(big, PW, PW / 2, 3, tv, 960, 600)
  await sharp(Buffer.from(thumb), { raw: { width: 960, height: 600, channels: 4 } }).removeAlpha().resize(640, 400).webp({ quality: 80 }).toFile(path.join(outDir, 'thumb.webp'))

  const manifestFile = path.resolve('public/library/manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  const entry = {
    id: `lib-${id}`,
    name,
    category,
    width: PW,
    height: PW / 2,
    original: `library/${id}/pano.webp`,
    thumb: `library/${id}/thumb.webp`,
    pano: { mask: `library/${id}/mask.webp`, shade: `library/${id}/shade.webp`, box: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), yaw, source: 'Poly Haven (CC0)' },
    surfaces,
  }
  manifest.rooms = manifest.rooms.filter((r: { id: string }) => r.id !== entry.id).concat(entry)
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
  console.log(`  ${entry.id}: ${surfaces.map((s) => `${s.label} ${s.size.join('x')}`).join(', ')} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
