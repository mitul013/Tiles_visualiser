// End-to-end check of automatic room detection in a real browser:
//   npm run build && npx vite preview --port 4173 &
//   node scripts/detect/e2e.cjs <photo> [outDir]
// Uploads the photo through the real dialog, runs detection in the page (WebAssembly), checks the
// editor opens prefilled, accepts the room, applies a floor and a wall tile, and saves screenshots.
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const photo = path.resolve(process.argv[2])
const out = path.resolve(process.argv[3] ?? 'detect-out')
const base = process.env.BASE_URL ?? 'http://localhost:4173/'
fs.mkdirSync(out, { recursive: true })
const save = (url, f) => fs.writeFileSync(path.join(out, f), Buffer.from(url.split(',')[1], 'base64'))

;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()))
  await page.goto(`${base}?harness`)
  await page.waitForFunction(() => window.__tv)
  await page.evaluate(() => {
    const s = window.__tv.useStore.getState()
    s.setOpen(true)
    s.setModal('uploadRoom')
  })
  await page.locator('.start-upload input[type=file]').first().setInputFiles(photo)
  await page.getByRole('button', { name: /Detect room automatically/ }).click()
  const t = Date.now()
  let last = ''
  const poll = setInterval(async () => {
    const txt = await page.locator('.detect-progress .hint').textContent().catch(() => null)
    if (txt && txt !== last) console.log(`  [${((Date.now() - t) / 1000).toFixed(1)}s] ${(last = txt)}`)
  }, 400)
  // detection opens the editor with the surfaces and the object layer filled in
  const use = page.getByRole('button', { name: /Use this room/ })
  await use.waitFor({ timeout: 600000 })
  clearInterval(poll)
  console.log(`detected in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(out, 'editor.png') })
  await page.getByRole('button', { name: /Objects in front/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 'editor-objects.png') })
  await use.click()
  await page.waitForFunction(() => window.__tv.useStore.getState().roomId.startsWith('photo-'), null, { timeout: 60000 })
  const info = await page.evaluate(() => {
    const s = window.__tv.useStore.getState()
    const r = s.photoRooms.find((x) => x.id === s.roomId)
    return { id: r.id, surfaces: r.surfaces.map((x) => ({ id: x.id, type: x.type, label: x.label })), auto: r.auto }
  })
  console.log(JSON.stringify(info.surfaces.map((s) => s.label)))
  // the detected room as stored (lets tests compare browser and server results)
  fs.writeFileSync(path.join(out, 'room.json'), JSON.stringify(await page.evaluate(() => { const s = window.__tv.useStore.getState(); const r = s.photoRooms.find((x) => x.id === s.roomId); return { width: r.width, height: r.height, surfaces: r.surfaces } })))
  const ready = () => page.waitForSelector(`canvas[data-room="${info.id}"][data-ready="1"]`, { timeout: 120000 })
  const shot = async (f) => {
    await ready()
    await page.waitForTimeout(600)
    save(await page.evaluate(() => window.__tv.useStore.getState().capture()), f)
  }
  await shot('before.jpg')
  // a floor tile and a wall tile from the catalogue
  await page.evaluate((info) => {
    const { useStore, PRODUCTS } = window.__tv
    const pick = (t, re) => PRODUCTS.find((p) => p.application.includes(t) && re.test(p.name)) ?? PRODUCTS.find((p) => p.application.includes(t))
    const floor = pick('floor', /marble|carrara|statuario/i)
    const wall = pick('wall', /subway|zellige|metro/i)
    const st = { layout: 'grid', rotation: 0, groutColor: '#d8d4cc', groutMm: 2, finish: 'matt' }
    const applied = {}
    for (const s of info.surfaces) {
      if (s.type === 'floor') applied[s.id] = { kind: 'tile', productId: floor.id, settings: { ...st, finish: 'glossy' } }
      if (s.type === 'wall') applied[s.id] = { kind: 'tile', productId: wall.id, settings: { ...st, layout: 'brick' } }
    }
    useStore.getState().setApplied(applied)
    useStore.setState({ selected: [] })
    return [floor.name, wall.name]
  }, info).then((n) => console.log('applied', n.join(' + ')))
  await page.waitForTimeout(300)
  await shot('after.jpg')
  await page.screenshot({ path: path.join(out, 'app.png') })
  await browser.close()
})().catch((e) => (console.error(e), process.exit(1)))
