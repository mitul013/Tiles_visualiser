// Visual comparison harness.
//
// For each case in <fixtures>/cases.json it renders:
//   1. "photo re-tile": the reference image used as an uploaded room photo, with the
//      case's tile applied to the marked surface (tests perspective, shading carry-over, masking)
//   2. "3D equivalent": the closest demo room with the same tile + layout settings
// and writes <fixtures>/report/index.html with reference | ours side by side plus metrics.
//
// Usage: npm run build && npx vite preview --port 4173 &
//        node scripts/compare.cjs [fixturesDir]
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const dir = path.resolve(process.argv[2] ?? 'test-fixtures')
const out = path.join(dir, 'report')
const base = process.env.BASE_URL ?? 'http://localhost:4173/'
const only = process.env.ONLY?.split(',')
const { cases } = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'))
fs.mkdirSync(out, { recursive: true })

const dataUrl = (f) => `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`
const saveDataUrl = (url, f) => fs.writeFileSync(path.join(out, f), Buffer.from(url.split(',')[1], 'base64'))

;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}?harness`)
  await page.waitForFunction(() => window.__tv)
  const results = []

  for (const c of cases) {
    if (only && !only.includes(c.id)) continue
    const ref = dataUrl(c.ref)
    const tileImg = c.tile.image ? dataUrl(c.tile.image) : null

    // --- define product + application in the page
    const productId = await page.evaluate(
      ({ c, tileImg }) => {
        const { useStore, PRODUCTS } = window.__tv
        if (!tileImg) {
          const p = PRODUCTS.find((x) => x.name === c.tile.name && x.size[0] === c.tile.size[0] && x.size[1] === c.tile.size[1])
          if (!p) throw new Error(`no product ${c.tile.name} ${c.tile.size}`)
          return p.id
        }
        const id = `u-test-${c.id}`
        const s = useStore.getState()
        if (!s.customProducts.some((p) => p.id === id))
          s.addCustomProduct({ id, name: c.tile.name, sku: 'TEST', material: 'Custom', color: 'Multi', finish: c.settings.finish ?? 'glossy', size: c.tile.size, application: ['floor', 'wall', 'countertop', 'backsplash'], price: 0, piecesPerBox: 1, thicknessMm: 12, art: { kind: 'image', base: '#ccc', accent: '#aaa', imageUrl: tileImg }, createdAt: Date.now(), description: 'test', custom: true })
        return id
      },
      { c, tileImg },
    )
    const app = { kind: 'tile', productId, settings: { layout: 'grid', rotation: 0, groutColor: '#d8d4cc', groutMm: 2, finish: 'matt', ...c.settings } }

    // --- 1. photo re-tile
    const dims = await page.evaluate(async (src) => {
      const im = new Image()
      im.src = src
      await im.decode()
      return [im.naturalWidth, im.naturalHeight]
    }, ref)
    await page.evaluate(
      ({ c, ref, dims, app }) => {
        const { useStore } = window.__tv
        const s = useStore.getState()
        const id = `photo-test-${c.id}`
        s.removePhotoRoom(id)
        s.addPhotoRoom({ id, name: `Test ${c.id}`, image: ref, width: dims[0], height: dims[1], createdAt: Date.now(), surfaces: [{ id: 's1', label: c.photo.type, type: c.photo.type, quad: c.photo.quad, size: c.photo.size }] })
        useStore.setState({ originalShot: 'x' })
        s.openRoom(id, { s1: app })
        useStore.setState({ selected: [] })
      },
      { c, ref, dims, app },
    )
    const shoot = async (wait) => {
      await page.waitForTimeout(wait)
      await page.waitForFunction(() => window.__tv.useStore.getState().capture, null, { timeout: 15000 }).catch(async () => {
        console.log('no capture; state:', await page.evaluate(() => { const s = window.__tv.useStore.getState(); return JSON.stringify({ open: s.open, view: s.view, roomId: s.roomId, html: document.querySelector('.canvas-area')?.innerHTML.slice(0, 120) ?? document.body.innerHTML.slice(0, 200) }) }))
      })
      return page.evaluate(() => window.__tv.useStore.getState().capture?.() ?? '')
    }
    const photoShot = await shoot(3500)
    saveDataUrl(photoShot, `${c.id}-photo.jpg`)

    // metrics between reference and our re-tile, inside / outside the marked quad
    const m = await page.evaluate(
      async ({ ref, ours, quad }) => {
        const load = async (src) => {
          const im = new Image()
          im.src = src
          await im.decode()
          return im
        }
        const [a, b] = await Promise.all([load(ref), load(ours)])
        const W = 400
        const H = Math.round((W * a.naturalHeight) / a.naturalWidth)
        const lum = (im, blur) => {
          const cv = document.createElement('canvas')
          cv.width = W
          cv.height = H
          const ctx = cv.getContext('2d')
          if (blur) ctx.filter = `blur(${blur}px)`
          ctx.drawImage(im, 0, 0, W, H)
          const d = ctx.getImageData(0, 0, W, H).data
          const L = new Float32Array(W * H)
          for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          return L
        }
        const mask = (() => {
          const cv = document.createElement('canvas')
          cv.width = W
          cv.height = H
          const ctx = cv.getContext('2d')
          ctx.beginPath()
          quad.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)))
          ctx.fill()
          const d = ctx.getImageData(0, 0, W, H).data
          return Uint8Array.from({ length: W * H }, (_, i) => (d[i * 4 + 3] > 200 ? 1 : 0))
        })()
        const corr = (x, y, msk) => {
          let n = 0, sx = 0, sy = 0
          for (let i = 0; i < x.length; i++) if (msk[i]) (n++, (sx += x[i]), (sy += y[i]))
          const mx = sx / n, my = sy / n
          let sxy = 0, sxx = 0, syy = 0
          for (let i = 0; i < x.length; i++) if (msk[i]) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
          return { r: sxy / Math.sqrt(sxx * syy || 1), meanRef: mx, meanOurs: my }
        }
        const meanAbs = (x, y, msk, want) => {
          let n = 0, s = 0
          for (let i = 0; i < x.length; i++) if (msk[i] === want) (n++, (s += Math.abs(x[i] - y[i])))
          return n ? s / n : 0
        }
        const detail = (L, Lb, msk) => {
          let n = 0, s = 0
          for (let i = 0; i < L.length; i++) if (msk[i]) (n++, (s += (L[i] - Lb[i]) ** 2))
          return Math.sqrt(s / n)
        }
        const ra = lum(a, 0), rb = lum(b, 0), ba = lum(a, 10), bb = lum(b, 10)
        const lc = corr(ba, bb, mask)
        return {
          lightingCorrelation: lc.r,
          meanLumRef: lc.meanRef,
          meanLumOurs: lc.meanOurs,
          outsideDiff: meanAbs(ra, rb, mask, 0),
          detailRef: detail(ra, ba, mask),
          detailOurs: detail(rb, bb, mask),
          coverage: mask.reduce((s, v) => s + v, 0) / mask.length,
        }
      },
      { ref, ours: photoShot, quad: c.photo.quad },
    )

    // --- 2. 3D equivalent
    let threeShot = ''
    if (c.room) {
      await page.evaluate(
        ({ c, app }) => {
          const { useStore } = window.__tv
          const s = useStore.getState()
          s.openRoom(c.room.id)
          const applied = { ...useStore.getState().applied }
          for (const sid of c.room.surfaces) applied[sid] = app
          useStore.setState({ applied, selected: [], panorama: false })
        },
        { c, app },
      )
      threeShot = await shoot(7000)
      saveDataUrl(threeShot, `${c.id}-3d.jpg`)
    }
    fs.copyFileSync(path.join(dir, c.ref), path.join(out, `${c.id}-ref.jpg`))
    results.push({ ...c, metrics: m })
    console.log(c.id, JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(3)]))))
  }

  // --- report
  const pct = (v) => `${(v * 100).toFixed(0)}%`
  const row = (r) => {
    const m = r.metrics
    const lightOk = m.lightingCorrelation >= 0.6
    const maskOk = m.outsideDiff <= 2
    const lumOk = Math.abs(m.meanLumOurs - m.meanLumRef) <= 45
    const detailOk = m.detailOurs >= m.detailRef * 0.4
    const badge = (ok) => `<b class="${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'CHECK'}</b>`
    return `<tr><td colspan="3"><h3>${r.id} — ${r.feature}</h3><code>${r.tile.name} ${r.tile.size.join('×')} cm · ${JSON.stringify(r.settings)}</code></td></tr>
<tr><td><img src="${r.id}-ref.jpg"><p>Reference</p></td><td><img src="${r.id}-photo.jpg"><p>Ours — photo re-tile</p></td><td>${fs.existsSync(path.join(out, `${r.id}-3d.jpg`)) ? `<img src="${r.id}-3d.jpg"><p>Ours — 3D room (${r.room.id})</p>` : ''}</td></tr>
<tr><td colspan="3"><ul>
<li>${badge(lightOk)} Lighting / shadow carry-over (correlation of low-frequency luminance): <b>${m.lightingCorrelation.toFixed(2)}</b> (≥ 0.60)</li>
<li>${badge(maskOk)} Area outside the surface untouched: mean diff <b>${m.outsideDiff.toFixed(2)}</b> (≤ 2)</li>
<li>${badge(lumOk)} Overall brightness on the surface: ref <b>${m.meanLumRef.toFixed(0)}</b> vs ours <b>${m.meanLumOurs.toFixed(0)}</b></li>
<li>${badge(detailOk)} Texture detail (high-frequency energy): ref <b>${m.detailRef.toFixed(1)}</b> vs ours <b>${m.detailOurs.toFixed(1)}</b></li>
<li>Surface coverage in frame: ${pct(m.coverage)}</li></ul></td></tr>`
  }
  fs.writeFileSync(
    path.join(out, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Visual comparison</title><style>body{font:14px system-ui;margin:24px;color:#1c2226}table{border-collapse:collapse;width:100%}td{vertical-align:top;padding:6px;width:33%}img{width:100%;border-radius:8px;border:1px solid #ddd}p{margin:4px 0 0;color:#666}h3{margin:18px 0 4px}code{color:#555}.ok{color:#1b873f}.bad{color:#b26a00}ul{margin:4px 0 18px}</style>
<h1>Tiles Visualiser — visual comparison report</h1><p>Generated ${new Date().toISOString()} · ${results.length} cases · page errors: ${errors.length ? errors.join('; ') : 'none'}</p><table>${results.map(row).join('')}</table>`,
  )
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results.map((r) => ({ id: r.id, metrics: r.metrics })), null, 2))
  console.log(errors.length ? `page errors: ${errors.join('; ')}` : 'no page errors')
  console.log(`report: ${path.join(out, 'index.html')}`)
  await browser.close()
})()
