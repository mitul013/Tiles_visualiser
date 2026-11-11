// Downloads the reference sample images listed in tests/visual/fixtures.json into the
// git-ignored test-fixtures/ folder (resized / cropped as listed) and copies the case file.
// The images are third-party and are never committed; this makes the tests reproducible.
// Usage: npm run fixtures
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const out = path.join(root, 'test-fixtures')
const { files } = JSON.parse(fs.readFileSync(path.join(root, 'tests/visual/fixtures.json'), 'utf8'))
fs.mkdirSync(out, { recursive: true })

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const f of files) {
    // download through the browser (honours system proxy settings)
    const res = await page.goto(f.url)
    if (!res || !res.ok()) throw new Error(`${f.url}: HTTP ${res?.status()}`)
    const src = `data:${res.headers()['content-type'] ?? 'image/webp'};base64,${(await res.body()).toString('base64')}`
    await page.goto('about:blank')
    // decode/resize/crop with the browser's canvas (no native image dependencies)
    const jpg = await page.evaluate(
      async ({ src, size, crop }) => {
        const im = new Image()
        im.src = src
        await im.decode()
        const [sx, sy, sw, sh] = crop ?? [0, 0, im.naturalWidth, im.naturalHeight]
        const [w, h] = size ?? [sw, sh]
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h)
        return c.toDataURL('image/jpeg', 0.93)
      },
      { src, size: f.size, crop: f.crop },
    )
    fs.writeFileSync(path.join(out, f.out), Buffer.from(jpg.split(',')[1], 'base64'))
    console.log('saved', f.out)
  }
  fs.copyFileSync(path.join(root, 'tests/visual/cases.json'), path.join(out, 'cases.json'))
  console.log(`fixtures ready in ${out}`)
  await browser.close()
})()
