// Adds prepared cut-out rooms to the room library (public/library): each room folder holds
// original.webp + matt.webp + glossy.webp (tile surfaces transparent, shadows baked in) and optionally
// thumbnail.webp. The original runs through the room detector for each surface's perspective guide and
// real size; the cut-out decides what shows, so surfaces with (almost) no transparent pixels are dropped.
// Usage: node scripts/library-cutouts.cjs <rooms dir> [category]
//   <rooms dir>/<id> - <name>/{original,matt,glossy}.webp; folders missing one of the three are skipped.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')

const root = process.argv[2]
const category = process.argv[3] ?? 'Living Room'
if (!root) throw new Error('usage: node scripts/library-cutouts.cjs <rooms dir> [category]')
const lib = path.resolve('public/library')
const manifestFile = path.join(lib, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const uid = () => `s-${Math.random().toString(36).slice(2, 10)}`
const WIDTH = 2000

const inside = (x, y, poly) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** share of the photo that is a hole in the cut-out and inside the surface's area */
function holeShare(alpha, W, H, area) {
  let n = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] < 128 && inside((x + 0.5) / W, (y + 0.5) / H, area)) n++
  return n / (W * H)
}

;(async () => {
  const added = []
  for (const folder of fs.readdirSync(root).sort((a, b) => parseInt(a) - parseInt(b))) {
    const src = path.join(root, folder)
    const has = (f) => fs.existsSync(path.join(src, f))
    if (!['original.webp', 'matt.webp', 'glossy.webp'].every(has)) {
      console.log('skipped', folder, '(needs original, matt and glossy)')
      continue
    }
    const m = /^(\d+)\s*-\s*(.+)$/.exec(folder)
    const num = m ? m[1] : folder
    const name = m ? m[2].trim() : folder
    const id = `room-${num}`
    const dir = path.join(lib, id)
    fs.mkdirSync(dir, { recursive: true })
    const resize = (f, q) => sharp(path.join(src, f)).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: q }).toFile(path.join(dir, f))
    await resize('original.webp', 86)
    await resize('matt.webp', 86)
    await resize('glossy.webp', 86)
    await sharp(path.join(src, has('thumbnail.webp') ? 'thumbnail.webp' : 'original.webp'))
      .resize({ width: 640 })
      .webp({ quality: 78 })
      .toFile(path.join(dir, 'thumb.webp'))

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'libcut-'))
    const run = spawnSync('npx', ['tsx', 'scripts/detect/run.ts', path.join(dir, 'original.webp'), '--out', out, '--detail', '1218'], { stdio: 'inherit', shell: true })
    if (run.status !== 0) throw new Error(`detection failed for ${folder}`)
    const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
    fs.rmSync(out, { recursive: true, force: true })

    const meta = await sharp(path.join(dir, 'original.webp')).metadata()
    const AW = 400
    const AH = Math.round((AW * meta.height) / meta.width)
    const alpha = await sharp(path.join(dir, 'matt.webp')).ensureAlpha().extractChannel(3).resize(AW, AH, { fit: 'fill' }).raw().toBuffer()
    const kept = res.surfaces
      .map((s) => ({ s, share: holeShare(alpha, AW, AH, s.area) }))
      .filter((t) => t.share >= 0.01)
      .map((t) => t.s)
    const order = { floor: 0, wall: 1, backsplash: 2, ceiling: 3 }
    const cx = (s) => s.area.reduce((n, p) => n + p[0], 0) / s.area.length
    kept.sort((a, b) => (order[a.type] ?? 4) - (order[b.type] ?? 4) || cx(a) - cx(b))
    const walls = kept.filter((s) => s.type === 'wall')
    walls.forEach((s, i) => (s.label = walls.length > 1 ? `Wall ${i + 1}` : 'Wall'))
    const surfaces = kept.map((s) => ({
      id: uid(),
      label: s.label,
      type: s.type,
      quad: s.quad,
      area: s.area,
      size: s.size,
      ...(s.openings ? { openings: s.openings } : {}),
    }))
    const entry = {
      id: `lib-${id}`,
      name,
      category,
      width: meta.width,
      height: meta.height,
      original: `library/${id}/original.webp`,
      matt: `library/${id}/matt.webp`,
      glossy: `library/${id}/glossy.webp`,
      surfaces,
      thumb: `library/${id}/thumb.webp`,
    }
    added.push(entry)
    console.log('added', entry.id, surfaces.map((s) => `${s.label} ${s.size.join('x')}m`).join(', '))
  }
  // the prepared cut-out rooms are listed first; new ones follow the existing cut-out rooms
  const ids = new Set(added.map((e) => e.id))
  const rest = manifest.rooms.filter((r) => !ids.has(r.id))
  const lastCut = rest.reduce((n, r, i) => (r.matt ? i : n), -1)
  manifest.rooms = [...rest.slice(0, lastCut + 1), ...added, ...rest.slice(lastCut + 1)]
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
})()
