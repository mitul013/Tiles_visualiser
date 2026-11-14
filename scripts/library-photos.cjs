// Adds photo rooms to the room library (public/library): each photo is resized, run through the room
// detector (floor / walls / ceiling at real size, furniture mask) and written next to its surfaces in
// manifest.json. The app generates its light maps from the photo, as for an uploaded room.
// Usage: node scripts/library-photos.cjs rooms.json      (rooms.json: [{ id, name, category, src }])
//        node scripts/library-photos.cjs --tidy          (re-tidy the surfaces of the photo rooms already there)
// Uses the large segmentation model when server/models/room-seg-large.onnx is present.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')

const list = process.argv[2] === '--tidy' ? [] : JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const lib = path.resolve('public/library')
const manifestFile = path.join(lib, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const large = path.resolve('server/models/room-seg-large.onnx')
const uid = () => `s-${Math.random().toString(36).slice(2, 10)}`

const inside = (x, y, poly) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** convex hull (monotone chain) */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

/** clip a polygon to the band top <= y <= bottom */
function clipBand(poly, top, bottom) {
  const cut = (pts, keep, yb) => {
    const out = []
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length]
      const at = (a, b) => [a[0] + ((yb - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), yb]
      if (keep(cur)) {
        if (!keep(prev)) out.push(at(prev, cur))
        out.push(cur)
      } else if (keep(prev)) out.push(at(prev, cur))
    })
    return out
  }
  return cut(
    cut(poly, (p) => p[1] >= top, top),
    (p) => p[1] <= bottom,
    bottom,
  )
}

/**
 * Tidy detected surfaces for a demo room: small wall pieces (cabinet sides, niches) clutter the labels.
 * In kitchens and bathrooms the small pieces between counter and upper cabinets are the backsplash,
 * which shops want to tile: they become one surface (the pieces' outline hull on the plane of the
 * largest piece; cabinets in front are in the furniture mask). Other pieces under 3% of the visible
 * photo are dropped. Walls are numbered left to right.
 */
async function tidy(entry) {
  const W = 320
  const H = 180
  const { data: alpha } = await sharp(path.join('public', entry.objMask)).extractChannel(3).resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const stats = entry.surfaces.map((s) => {
    let n = 0
    let sx = 0
    let sy = 0
    const rows = new Float32Array(H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (alpha[y * W + x] < 128 && inside((x + 0.5) / W, (y + 0.5) / H, s.area)) {
          n++
          rows[y]++
          sx += x
          sy += y
        }
    return {
      s,
      vis: n / (W * H),
      cx: n ? sx / n / W : 0.5,
      cy: n ? sy / n / H : 0.5,
      rows,
    }
  })
  const counters = /kitchen|bath/i.test(entry.category)
  const keep = []
  const splash = []
  for (const t of stats) {
    // (a backsplash from an earlier run goes through the merge again, so --tidy can be repeated)
    if (t.s.type === 'backsplash' || (t.s.type === 'wall' && t.vis < 0.03)) {
      if (t.s.type === 'backsplash' || (counters && t.vis > 0.004 && t.cy > 0.3 && t.cy < 0.62)) splash.push(t)
      continue
    }
    keep.push(t)
  }
  if (splash.length) {
    const main = splash.reduce((a, b) => (b.vis > a.vis ? b : a))
    const vis = splash.reduce((n, t) => n + t.vis, 0)
    // the backsplash band: the run of rows around the densest one (island fronts and stray bits are sparser)
    const rows = new Float32Array(H)
    for (const t of splash) t.rows.forEach((v, y) => (rows[y] += v))
    // backsplashes sit at counter height: look for the densest row there
    let peak = Math.round(H * 0.3)
    for (let y = peak; y < H * 0.65; y++) if (rows[y] > rows[peak]) peak = y
    let top = peak
    let bottom = peak
    while (top > 0 && rows[top - 1] >= rows[peak] * 0.3) top--
    while (bottom < H - 1 && rows[bottom + 1] >= rows[peak] * 0.3) bottom++
    const area = clipBand(hull(splash.flatMap((t) => t.s.area)), top / H, (bottom + 1) / H)
    keep.push({
      s: { ...main.s, type: 'backsplash', area },
      vis,
      cx: splash.reduce((n, t) => n + t.cx * t.vis, 0) / vis,
    })
  }
  const order = { floor: 0, wall: 1, backsplash: 2, ceiling: 3 }
  keep.sort((a, b) => (order[a.s.type] ?? 4) - (order[b.s.type] ?? 4) || a.cx - b.cx)
  for (const type of ['wall', 'backsplash']) {
    const list = keep.filter((t) => t.s.type === type)
    const name = type === 'wall' ? 'Wall' : 'Backsplash'
    list.forEach((t, i) => (t.s.label = list.length > 1 ? `${name} ${i + 1}` : name))
  }
  entry.surfaces = keep.map((t) => t.s)
  return entry
}

;(async () => {
  if (process.argv[2] === '--tidy') {
    for (const e of manifest.rooms) if (e.objMask) console.log('tidied', (await tidy(e)).id, e.surfaces.map((s) => s.label).join(', '))
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
    return
  }
  for (const r of list) {
    const dir = path.join(lib, r.id)
    fs.mkdirSync(dir, { recursive: true })
    const original = path.join(dir, 'original.webp')
    await sharp(r.src).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 86 }).toFile(original)
    await sharp(original).resize({ width: 640 }).webp({ quality: 78 }).toFile(path.join(dir, 'thumb.webp'))
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'libdet-'))
    const args = ['tsx', 'scripts/detect/run.ts', original, '--out', out, '--detail', '1218']
    if (fs.existsSync(large)) args.push('--seg-model', large, '--seg', '1280')
    const run = spawnSync('npx', args, { stdio: 'inherit' })
    if (run.status !== 0) throw new Error(`detection failed for ${r.id}`)
    const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
    // greyscale object mask -> the app's alpha mask
    const { data, info } = await sharp(path.join(out, 'objects.png')).greyscale().raw().toBuffer({ resolveWithObject: true })
    const rgba = Buffer.alloc(info.width * info.height * 4)
    for (let i = 0; i < info.width * info.height; i++) {
      rgba[i * 4] = 255
      rgba[i * 4 + 1] = 40
      rgba[i * 4 + 2] = 120
      rgba[i * 4 + 3] = data[i]
    }
    await sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'objects.png'))
    const surfaces = res.surfaces.map((s) => ({
      id: uid(),
      label: s.label,
      type: s.type,
      quad: s.quad,
      area: s.area,
      size: s.size,
      ...(s.openings ? { openings: s.openings } : {}),
    }))
    const entry = await tidy({
      id: `lib-${r.id}`,
      name: r.name,
      category: r.category,
      width: res.width,
      height: res.height,
      original: `library/${r.id}/original.webp`,
      thumb: `library/${r.id}/thumb.webp`,
      objMask: `library/${r.id}/objects.png`,
      surfaces,
    })
    manifest.rooms = manifest.rooms.filter((x) => x.id !== entry.id).concat(entry)
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1))
    console.log('added', entry.id, surfaces.map((s) => `${s.label} ${s.size.join('x')}m`).join(', '))
    fs.rmSync(out, { recursive: true, force: true })
  }
})()
