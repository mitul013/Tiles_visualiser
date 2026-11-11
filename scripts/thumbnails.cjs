// Renders each demo room with its default finishes and saves public/rooms/<id>.jpg.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/thumbnails.cjs
const { chromium } = require('playwright')
const { mkdirSync } = require('node:fs')

const base = process.env.BASE_URL ?? 'http://localhost:4173/'
const rooms = (process.argv[2] ?? 'living,bedroom,kitchen,bathroom,outdoor,lobby').split(',')
const out = process.env.OUT_DIR ?? 'public/rooms'
mkdirSync(out, { recursive: true })

;(async () => {
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.error('pageerror', e.message))
for (const id of rooms) {
  await page.goto(`${base}?thumb=${id}`)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(Number(process.env.WAIT ?? 6000))
  await page.screenshot({ path: `${out}/${id}.jpg`, type: 'jpeg', quality: 82 })
  console.log('saved', id)
}
await browser.close()
})()
