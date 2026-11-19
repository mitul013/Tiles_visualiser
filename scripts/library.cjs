// Builds the room library (public/library) from our own 3D rooms, in the same layered format as a
// prepared photo room: original.jpg + matt.png (tile area transparent, shadows baked in) + exact
// surface planes in manifest.json. Rooms you own/license can be added to the manifest by hand.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/library.cjs
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const base = process.env.BASE_URL ?? 'http://localhost:4173/'
const rooms = (process.argv[2] ?? 'living,bedroom,kitchen,bathroom,lobby').split(',')
const out = path.resolve('public/library')
fs.mkdirSync(out, { recursive: true })
const save = (url, file) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'))

;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  const manifest = []
  for (const id of rooms) {
    await page.goto(`${base}?libgen=${id}`)
    await page.waitForFunction(() => window.__libgen, null, { timeout: 120000 })
    const r = await page.evaluate(() => window.__libgen)
    const dir = path.join(out, id)
    fs.mkdirSync(dir, { recursive: true })
    save(r.original, path.join(dir, 'original.jpg'))
    save(r.matt, path.join(dir, 'matt.png'))
    manifest.push({ id: `lib-${id}`, name: r.name, category: r.category, width: r.width, height: r.height, original: `library/${id}/original.jpg`, matt: `library/${id}/matt.png`, surfaces: r.surfaces })
    console.log('saved', id, r.surfaces.map((s) => s.label).join(', '))
  }
  // merge into the existing library (the photo demo rooms stay)
  const file = path.join(out, 'manifest.json')
  const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { rooms: [] }
  cur.rooms = cur.rooms.filter((r) => !manifest.some((m) => m.id === r.id)).concat(manifest)
  fs.writeFileSync(file, JSON.stringify(cur, null, 1))
  await browser.close()
})()
