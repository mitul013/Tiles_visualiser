/**
 * Re-fit a 360° room's box from its saved mask (no new segmentation):
 *   npx tsx scripts/pano/refit.ts <id> [--debug out.jpg]
 *
 * Furniture often hides most of the floor-wall line, so the box is fitted to ALL visible floor:
 * every floor pixel is projected onto the floor plane, and the walls must stand at least as far
 * out as the farthest floor seen in each direction (a high percentile, so stray pixels don't push
 * them). The rotation is searched round the dominant direction for the tightest box. The ceiling
 * height follows from the ceiling-wall line, as in build.ts. Updates the manifest (box and sizes).
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const [id] = process.argv.slice(2)
const manifestFile = path.resolve('public/library/manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const r = manifest.rooms.find((x: { id: string }) => x.id === `lib-${id}`)
if (!r?.pano) throw new Error(`no 360° room lib-${id}`)

async function main() {
  const W = 2048
  const H = 1024
  const { data } = await sharp(path.join('public', r.pano.mask)).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  // 0 object, 1 floor, 2 wall, 3 ceiling
  const cls = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const f = data[i * 3]
    const w = data[i * 3 + 1]
    const c = data[i * 3 + 2]
    const m = Math.max(f, w, c)
    cls[i] = m < 128 ? 0 : m === f ? 1 : m === c ? 3 : 2
  }
  const old = r.pano.box
  const cam = old.h
  const latOf = (y: number) => (0.5 - (y + 0.5) / H) * Math.PI
  const lonOf = (x: number) => ((x + 0.5) / W - 0.5) * 2 * Math.PI
  // floor pixels on the floor plane (camera at the origin), not too close to the horizon
  const pts: [number, number][] = []
  for (let y = H / 2 + 8; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      if (cls[y * W + x] !== 1) continue
      const rr = cam / Math.tan(-latOf(y))
      if (rr > 9) continue
      const lon = lonOf(x)
      pts.push([rr * Math.sin(lon), rr * Math.cos(lon)])
    }
  const pct = (a: number[], q: number) => {
    const s = [...a].sort((p, v) => p - v)
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]
  }
  const fit = (phi: number) => {
    const c = Math.cos(-phi)
    const s = Math.sin(-phi)
    const xs = pts.map(([x, z]) => x * c - z * s)
    const zs = pts.map(([x, z]) => x * s + z * c)
    const b = { x0: pct(xs, 0.004), x1: pct(xs, 0.996), z0: pct(zs, 0.004), z1: pct(zs, 0.996) }
    return { phi, ...b, area: (b.x1 - b.x0) * (b.z1 - b.z0) }
  }
  let best = fit(old.phi)
  for (let d = -45; d <= 45; d += 0.5) {
    const f = fit(old.phi + (d * Math.PI) / 180)
    if (f.area < best.area) best = f
  }
  // ceiling height from the ceiling-wall line against the new box
  const rBox = (lon: number) => {
    const sx = Math.sin(lon)
    const sz = Math.cos(lon)
    const dx = sx * Math.cos(-best.phi) - sz * Math.sin(-best.phi)
    const dz = sx * Math.sin(-best.phi) + sz * Math.cos(-best.phi)
    return Math.min(dx > 0 ? best.x1 / dx : dx < 0 ? best.x0 / dx : Infinity, dz > 0 ? best.z1 / dz : dz < 0 ? best.z0 / dz : Infinity)
  }
  const hs: number[] = []
  for (let x = 0; x < W; x++)
    for (let y = H / 2 - 2; y > 2; y--) {
      const k = cls[y * W + x]
      if (k === 3) {
        if (cls[(y + 2) * W + x] === 2 && cls[(y + 4) * W + x] === 2) hs.push(rBox(lonOf(x)) * Math.tan(latOf(y + 0.5)))
        break
      }
      if (k !== 2) break
    }
  const above = hs.filter((v) => v > 0.3 && v < 6)
  let Hc = cam + (above.length > 30 ? pct(above, 0.5) : 1.1)
  Hc = Math.max(2.4, Math.min(3.4, Hc))
  const box = { phi: best.phi, x0: best.x0, x1: best.x1, z0: best.z0, z1: best.z1, h: cam, H: Hc }
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  r.pano.box = Object.fromEntries(Object.entries(box).map(([k, v]) => [k, r3(v)]))
  const r2 = (v: number) => Math.round(v * 100) / 100
  for (const s of r.surfaces) {
    if (s.face === 'floor' || s.face === 'ceiling') s.size = [r2(box.x1 - box.x0), r2(box.z1 - box.z0)]
    else s.size = [r2(s.face[0] === 'x' ? box.z1 - box.z0 : box.x1 - box.x0), r2(box.H)]
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
  console.log(
    `lib-${id}: was ${(old.x1 - old.x0).toFixed(2)} x ${(old.z1 - old.z0).toFixed(2)} m @ ${((old.phi * 180) / Math.PI).toFixed(1)}°, now ${(box.x1 - box.x0).toFixed(2)} x ${(box.z1 - box.z0).toFixed(2)} m @ ${((box.phi * 180) / Math.PI).toFixed(1)}°, ceiling ${box.H.toFixed(2)} m (${pts.length} floor points)`,
  )
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
