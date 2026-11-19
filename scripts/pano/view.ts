/**
 * Set a 360° room's opening view and thumbnail without rebuilding it:
 *   npx tsx scripts/pano/view.ts <id> <yaw degrees>
 * Walls are renumbered left to right from that view.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { renderView, view } from './geom'

const [id, yawArg] = process.argv.slice(2)
const yaw = Number(yawArg)
const manifestFile = path.resolve('public/library/manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const r = manifest.rooms.find((x: { id: string }) => x.id === `lib-${id}`)
if (!r?.pano) throw new Error(`no 360° room lib-${id}`)
;(async () => {
  const W = 4096
  const big = await sharp(path.join('public', r.original)).removeAlpha().resize(W, W / 2).raw().toBuffer()
  const thumb = renderView(big, W, W / 2, 3, view(yaw, -12, 100), 960, 600)
  await sharp(Buffer.from(thumb), { raw: { width: 960, height: 600, channels: 4 } }).removeAlpha().resize(640, 400).webp({ quality: 80 }).toFile(path.join('public', r.thumb))
  r.pano.yaw = yaw
  // walls left to right as seen from the opening view
  const at: Record<string, number> = { z1: 0, x1: Math.PI / 2, z0: Math.PI, x0: -Math.PI / 2 }
  const rel = (f: string) => ((((at[f] + r.pano.box.phi - (yaw * Math.PI) / 180) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
  const walls = r.surfaces.filter((s: { type: string }) => s.type === 'wall').sort((a: { face: string }, b: { face: string }) => rel(a.face) - rel(b.face))
  walls.forEach((s: { label: string }, i: number) => (s.label = `Wall ${i + 1}`))
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
  console.log(`lib-${id}: yaw ${yaw}, walls ${walls.map((s: { face: string; label: string }) => `${s.label}=${s.face}`).join(' ')}`)
})()
