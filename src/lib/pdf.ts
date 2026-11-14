import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import type { CatalogEntry, Product } from '../types'
import { findPaint, findProduct, roomName, surfacesForRoom, useStore } from '../store'
import { getSwatch } from './tileArt'
import { calculate, money } from './calc'
import { sizeLabel } from '../data/products'
import { DEFAULT_SETTINGS, LAYOUTS, renderTiledSurface } from './layout'
import { shareUrl } from './share'
import { notifyHost } from './host'
import { brand, contactLines, logoUrl } from './brand'

/** the shop's logo as a PNG data URL (any image format the browser reads), or null */
async function logoPng(): Promise<{ data: string; ratio: number } | null> {
  const url = logoUrl()
  if (!url) return null
  try {
    const im = await loadImg(url)
    const c = document.createElement('canvas')
    const k = Math.min(1, 600 / Math.max(im.naturalWidth || 600, im.naturalHeight || 600))
    c.width = Math.max(1, Math.round((im.naturalWidth || 600) * k))
    c.height = Math.max(1, Math.round((im.naturalHeight || 200) * k))
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
    return { data: c.toDataURL('image/png'), ratio: c.width / c.height }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- design system
type RGB = [number, number, number]
const INK: RGB = [1, 42, 56]
const INK_2: RGB = [14, 90, 115]
const GOLD: RGB = [201, 162, 74]
const PAPER: RGB = [246, 245, 242]
const TEXT: RGB = [28, 34, 38]
const MUTED: RGB = [107, 115, 120]
const LINE: RGB = [229, 227, 222]
const WHITE: RGB = [255, 255, 255]
const PW = 210
const PH = 297
const M = 14 // page margin

type Face = 'light' | 'regular' | 'semibold' | 'xbold'
const FONT_FILES: Record<Face, string> = { light: 'Inter-Light.ttf', regular: 'Inter-Regular.ttf', semibold: 'Inter-SemiBold.ttf', xbold: 'Inter-ExtraBold.ttf' }
let fontData: Promise<Record<Face, string> | null> | null = null
/** Inter (SIL OFL) from public/fonts, loaded once; null = fall back to the built-in Helvetica */
function loadFonts() {
  fontData ??= (async () => {
    try {
      const out = {} as Record<Face, string>
      for (const [face, file] of Object.entries(FONT_FILES) as [Face, string][]) {
        const r = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`)
        if (!r.ok) return null
        const bytes = new Uint8Array(await r.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        out[face] = btoa(bin)
      }
      return out
    } catch {
      return null
    }
  })()
  return fontData
}

/** A jsPDF document with the house fonts registered and small drawing helpers. */
async function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const fonts = await loadFonts()
  if (fonts)
    for (const [face, data] of Object.entries(fonts) as [Face, string][]) {
      doc.addFileToVFS(FONT_FILES[face], data)
      doc.addFont(FONT_FILES[face], `Inter-${face}`, 'normal')
    }
  const font = (face: Face, size: number, color: RGB = TEXT, spacing = 0) => {
    if (fonts) doc.setFont(`Inter-${face}`, 'normal')
    else doc.setFont('helvetica', face === 'semibold' || face === 'xbold' ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    // tracking given in points-ish units; jsPDF applies it in document units (mm)
    doc.setCharSpace(spacing * 0.18)
  }
  const fill = (c: RGB) => doc.setFillColor(...c)
  /** draw with transparency (0..1) */
  const alpha = (o: number, draw: () => void) => {
    const G = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState
    doc.saveGraphicsState()
    ;(doc as unknown as { setGState: (g: unknown) => void }).setGState(new G({ opacity: o }))
    draw()
    doc.restoreGraphicsState()
  }
  return { doc, font, fill, alpha }
}
type Kit = Awaited<ReturnType<typeof newDoc>>

const loadImg = async (src: string) => {
  const im = new Image()
  im.src = src
  await im.decode()
  return im
}
/** crop an image to fill a box of the given aspect (like CSS object-fit: cover) */
async function cover(src: string, aspect: number, maxW = 2000): Promise<string> {
  const im = await loadImg(src)
  const iw = im.naturalWidth
  const ih = im.naturalHeight
  let sw = iw
  let sh = iw / aspect
  if (sh > ih) {
    sh = ih
    sw = ih * aspect
  }
  const c = document.createElement('canvas')
  c.width = Math.min(maxW, Math.round(sw))
  c.height = Math.round(c.width / aspect)
  c.getContext('2d')!.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.9)
}
/** a close-up of the tile as laid (layout, grout, rotation): 1.2 m x 1.2 m of the surface */
async function layoutCloseUp(p: Product, settings: import('../types').SurfaceSettings) {
  try {
    const c = await renderTiledSurface(p, settings, [1.2, 1.2], 640)
    return c.toDataURL('image/jpeg', 0.88)
  } catch {
    return getSwatch(p)
  }
}

interface Line {
  surface: string
  area: number
  product?: Product
  settings?: import('../types').SurfaceSettings
  calc?: ReturnType<typeof calculate>
  paint?: { name: string; hex: string }
}
function linesOf(entry: CatalogEntry): Line[] {
  const surfaces = surfacesForRoom(entry.design.roomId, useStore.getState().photoRooms)
  const out: Line[] = []
  for (const s of surfaces) {
    const app = entry.design.applied[s.id]
    if (!app) continue
    if (app.kind === 'tile') {
      const p = findProduct(app.productId)
      if (p) out.push({ surface: s.label, area: s.area, product: p, settings: app.settings, calc: calculate(p, s.area, 10, app.settings.groutMm) })
    } else {
      const paint = findPaint(app.paintId)
      if (paint) out.push({ surface: s.label, area: s.area, paint })
    }
  }
  return out
}
const m2 = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} m²`

// ---------------------------------------------------------------- pages
function footer(k: Kit, page: number, pages: number, dark = false) {
  const { doc, font } = k
  font('regular', 7.5, dark ? [190, 200, 204] : MUTED, 0.2)
  doc.text(brand.name.toUpperCase(), M, PH - 8)
  doc.text(`${page} / ${pages}`, PW - M, PH - 8, { align: 'right' })
  if (!dark) {
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.line(M, PH - 12, PW - M, PH - 12)
  }
}

async function coverPage(k: Kit, entries: CatalogEntry[], totals: { area: number; cost: number; products: number }) {
  const { doc, font, fill, alpha } = k
  fill(INK)
  doc.rect(0, 0, PW, PH, 'F')
  const heroH = 178
  doc.addImage(await cover(entries[0].image, PW / heroH), 'JPEG', 0, 0, PW, heroH)
  // soft fade from the photo into the ink panel
  for (let i = 0; i < 14; i++) alpha(0.06 + i * 0.065, () => (fill(INK), doc.rect(0, heroH - 28 + i * 2, PW, 2, 'F')))
  const logo = await logoPng()
  if (logo) {
    const h = 12
    const w = Math.min(70, h * logo.ratio)
    fill(WHITE)
    alpha(0.94, () => doc.roundedRect(M - 3, 13, w + 6, h + 6, 3, 3, 'F'))
    doc.addImage(logo.data, 'PNG', M, 16, w, h)
  } else {
    fill(GOLD)
    doc.rect(M, 26, 18, 1.2, 'F')
    font('semibold', 8, WHITE, 1.4)
    alpha(0.92, () => doc.text(brand.name.toUpperCase(), M, 22))
  }
  font('semibold', 9, GOLD, 1.8)
  doc.text('TILE SELECTION', M, heroH + 12)
  font('xbold', 34, WHITE, -0.4)
  doc.text(entries.length > 1 ? 'Your design' : entries[0].name, M, heroH + 28, { maxWidth: PW - 2 * M })
  if (entries.length > 1) doc.text('catalogue', M, heroH + 42)
  font('light', 11, [200, 210, 214])
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  doc.text(`${entries.length} room design${entries.length > 1 ? 's' : ''}  ·  ${date}`, M, heroH + (entries.length > 1 ? 52 : 38))
  // key figures
  const stats: [string, string][] = [
    [String(entries.length), entries.length > 1 ? 'Designs' : 'Design'],
    [String(totals.products), totals.products === 1 ? 'Product' : 'Products'],
    [m2(totals.area), 'Total area'],
    [money(totals.cost), 'Estimated cost'],
  ]
  const y = PH - 44
  const cw = (PW - 2 * M) / 4
  doc.setDrawColor(40, 80, 94)
  doc.setLineWidth(0.25)
  doc.line(M, y - 9, PW - M, y - 9)
  stats.forEach(([v, l], i) => {
    font('semibold', i === 3 ? 13 : 15, i === 3 ? GOLD : WHITE)
    doc.text(v, M + i * cw, y)
    font('regular', 7.5, [160, 176, 182], 0.8)
    doc.text(l.toUpperCase(), M + i * cw, y + 6)
  })
}

async function designPage(k: Kit, entry: CatalogEntry, index: number, lines: Line[]) {
  const { doc, font, fill, alpha } = k
  fill(PAPER)
  doc.rect(0, 0, PW, PH, 'F')
  // hero: the room, edge to edge, with the title on a translucent band
  const heroH = 122
  doc.addImage(await cover(entry.image, PW / heroH), 'JPEG', 0, 0, PW, heroH)
  alpha(0.78, () => (fill(INK), doc.rect(0, heroH - 30, PW, 30, 'F')))
  const badge = `DESIGN ${String(index + 1).padStart(2, '0')}`
  font('semibold', 7, INK, 1.1)
  const bw = doc.getTextWidth(badge) + 7
  fill(GOLD)
  doc.roundedRect(M, heroH - 24, bw, 6, 3, 3, 'F')
  doc.text(badge, M + 3.5, heroH - 19.9)
  const tx0 = M + bw + 5
  font('xbold', 17, WHITE, -0.2)
  doc.text(entry.name, tx0, heroH - 19.4, { maxWidth: PW - M - tx0 })
  font('light', 9.5, [205, 214, 218])
  doc.text(`${roomName(entry.design.roomId)}  ·  ${new Date(entry.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, tx0, heroH - 11.5)

  // right column: summary + QR
  const rx = 140
  const rw = PW - M - rx
  let y = heroH + 10
  const tiles = lines.filter((l) => l.calc)
  const area = lines.reduce((a, l) => a + l.area, 0)
  const cost = tiles.reduce((a, l) => a + l.calc!.cost, 0)
  const boxes = tiles.reduce((a, l) => a + l.calc!.boxes, 0)
  fill(INK)
  doc.roundedRect(rx, y, rw, 70, 3, 3, 'F')
  font('semibold', 7, GOLD, 1.2)
  doc.text('THIS DESIGN', rx + 6, y + 9)
  const rows: [string, string][] = [
    ['Surfaces', String(lines.length)],
    ['Area', m2(area)],
    ['Boxes', String(boxes)],
  ]
  rows.forEach(([kk, v], i) => {
    font('regular', 8.5, [170, 186, 192])
    doc.text(kk, rx + 6, y + 19 + i * 8)
    font('semibold', 9.5, WHITE)
    doc.text(v, rx + rw - 6, y + 19 + i * 8, { align: 'right' })
  })
  doc.setDrawColor(40, 80, 94)
  doc.line(rx + 6, y + 46, rx + rw - 6, y + 46)
  font('regular', 7.5, [170, 186, 192], 0.6)
  doc.text('ESTIMATED COST', rx + 6, y + 54)
  font('xbold', 16, GOLD)
  doc.text(money(cost), rx + 6, y + 63)
  y += 78
  fill(WHITE)
  doc.setDrawColor(...LINE)
  doc.roundedRect(rx, y, rw, 66, 3, 3, 'FD')
  const qr = await QRCode.toDataURL(shareUrl(entry.design), { margin: 0, width: 300, color: { dark: '#012a38', light: '#ffffff' } })
  doc.addImage(qr, 'PNG', rx + (rw - 38) / 2, y + 7, 38, 38)
  font('semibold', 8.5, TEXT)
  doc.text('Open this design', rx + rw / 2, y + 53, { align: 'center' })
  font('regular', 7.5, MUTED)
  doc.text('Scan to view it in the visualiser', rx + rw / 2, y + 58.5, { align: 'center' })

  // left column: material cards
  const lx = M
  const lw = rx - 6 - lx
  font('semibold', 7.5, INK_2, 1.4)
  doc.text('MATERIALS', lx, heroH + 13)
  let cy = heroH + 18
  const cardH = 36
  for (const l of lines) {
    if (cy + cardH > PH - 16) {
      doc.addPage()
      fill(PAPER)
      doc.rect(0, 0, PW, PH, 'F')
      font('semibold', 7.5, INK_2, 1.4)
      doc.text(`${entry.name.toUpperCase()}  ·  MATERIALS (CONTINUED)`, M, 20)
      cy = 26
    }
    fill(WHITE)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.25)
    doc.roundedRect(lx, cy, lw, cardH - 4, 2.5, 2.5, 'FD')
    const ix = lx + 3
    const iy = cy + 3
    const is = cardH - 10
    if (l.product) doc.addImage(await layoutCloseUp(l.product, l.settings!), 'JPEG', ix, iy, is, is)
    else {
      doc.setFillColor(l.paint!.hex)
      doc.rect(ix, iy, is, is, 'F')
    }
    const tx = ix + is + 5
    font('semibold', 6.5, GOLD, 1)
    doc.text(l.surface.toUpperCase(), tx, cy + 8)
    if (l.product) {
      const p = l.product
      const st = l.settings!
      font('semibold', 11, TEXT)
      doc.text(p.name, tx, cy + 14, { maxWidth: lw - (tx - lx) - 4 })
      font('regular', 7.5, MUTED)
      doc.text(`${p.sku}  ·  ${sizeLabel(p.size)}  ·  ${p.material}`, tx, cy + 19)
      const lay = LAYOUTS.find((x) => x.id === st.layout)?.label ?? st.layout
      // chips
      let chx = tx
      for (const chip of [st.finish === 'glossy' ? 'Glossy' : 'Matt', lay, st.groutMm ? `Grout ${st.groutMm} mm` : 'No grout']) {
        font('regular', 6.5, INK_2)
        const w = doc.getTextWidth(chip) + 4
        doc.setFillColor(233, 240, 242)
        doc.roundedRect(chx, cy + 21.6, w, 4.2, 2.1, 2.1, 'F')
        doc.text(chip, chx + 2, cy + 24.6)
        chx += w + 1.5
      }
      const c = l.calc!
      font('regular', 7.5, TEXT)
      doc.text(`${m2(l.area)}  ·  ${c.boxes} box${c.boxes === 1 ? '' : 'es'}  ·  ${c.tiles} pcs`, tx, cy + 30)
      font('semibold', 10, INK)
      doc.text(money(c.cost), lx + lw - 4, cy + 30, { align: 'right' })
    } else {
      font('semibold', 11, TEXT)
      doc.text(`${l.paint!.name}`, tx, cy + 14)
      font('regular', 7.5, MUTED)
      doc.text(`Paint  ·  ${l.paint!.hex.toUpperCase()}`, tx, cy + 19)
      font('regular', 7.5, TEXT)
      doc.text(m2(l.area), tx, cy + 30)
    }
    cy += cardH
  }
  if (!lines.length) {
    font('regular', 9, MUTED)
    doc.text('No tiles or paint applied in this design yet.', lx, cy + 6)
  }
  // featured material: the largest tiled surface, close up, in the space left under the cards
  const main = [...lines].filter((l) => l.product).sort((a, b) => b.area - a.area)[0]
  const free = PH - 18 - (cy + 4)
  if (main && free >= 60 && doc.getNumberOfPages() === doc.getCurrentPageInfo().pageNumber) {
    const fy = cy + 4
    const fh = Math.min(free, 110)
    font('semibold', 7.5, INK_2, 1.4)
    doc.text('UP CLOSE', lx, fy + 3)
    const big = await (async () => {
      try {
        const c = await renderTiledSurface(main.product!, main.settings!, [1.8, 1.8 * ((fh - 8) / lw)], 1100)
        return c.toDataURL('image/jpeg', 0.9)
      } catch {
        return getSwatch(main.product!)
      }
    })()
    doc.addImage(big, 'JPEG', lx, fy + 6, lw, fh - 8)
    alpha(0.8, () => (fill(INK), doc.roundedRect(lx + 4, fy + fh - 15, Math.min(lw - 8, 92), 9, 2, 2, 'F')))
    font('semibold', 8, WHITE)
    const lay = LAYOUTS.find((x) => x.id === main.settings!.layout)?.label ?? ''
    doc.text(`${main.product!.name}  ·  ${lay}  ·  ${main.surface}`, lx + 7, fy + fh - 9.3, { maxWidth: Math.min(lw - 14, 86) })
  }
}

function summaryPage(k: Kit, all: Line[]) {
  const { doc, font, fill } = k
  fill(PAPER)
  doc.rect(0, 0, PW, PH, 'F')
  fill(INK)
  doc.rect(0, 0, PW, 46, 'F')
  font('semibold', 8, GOLD, 1.6)
  doc.text('SUMMARY', M, 20)
  font('xbold', 22, WHITE, -0.2)
  doc.text('Your shopping list', M, 33)
  // group by product
  const map = new Map<string, { p: Product; area: number; tiles: number; boxes: number; cost: number; surfaces: number }>()
  for (const l of all) {
    if (!l.product || !l.calc) continue
    const g = map.get(l.product.id) ?? { p: l.product, area: 0, tiles: 0, boxes: 0, cost: 0, surfaces: 0 }
    g.area += l.area
    g.surfaces++
    map.set(l.product.id, g)
  }
  // quantities are recomputed on the combined area: boxes are bought per product, not per wall
  for (const g of map.values()) {
    const c = calculate(g.p, g.area)
    g.tiles = c.tiles
    g.boxes = c.boxes
    g.cost = c.cost
  }
  const groups = [...map.values()].sort((a, b) => b.cost - a.cost)
  const cols = [M, M + 76, M + 104, M + 128, M + 150]
  let y = 60
  font('semibold', 7, MUTED, 1)
  ;['PRODUCT', 'AREA', 'BOXES', 'PIECES', 'ESTIMATED'].forEach((h, i) => doc.text(h, i === 4 ? PW - M : cols[i], y, i === 4 ? { align: 'right' } : undefined))
  y += 4
  for (const g of groups) {
    if (y > PH - 70) break
    doc.setDrawColor(...LINE)
    doc.line(M, y, PW - M, y)
    font('semibold', 9.5, TEXT)
    doc.text(g.p.name, M, y + 7, { maxWidth: 74 })
    font('regular', 7, MUTED)
    doc.text(`${g.p.sku} · ${sizeLabel(g.p.size)} · ${g.surfaces} surface${g.surfaces > 1 ? 's' : ''}`, M, y + 11.5)
    font('regular', 9, TEXT)
    doc.text(m2(g.area), cols[1], y + 8)
    doc.text(String(g.boxes), cols[2], y + 8)
    doc.text(String(g.tiles), cols[3], y + 8)
    font('semibold', 9.5, INK)
    doc.text(money(g.cost), PW - M, y + 8, { align: 'right' })
    y += 15
  }
  doc.setDrawColor(...LINE)
  doc.line(M, y, PW - M, y)
  // total band
  y += 8
  fill(INK)
  doc.roundedRect(M, y, PW - 2 * M, 24, 3, 3, 'F')
  font('regular', 8, [170, 186, 192], 0.8)
  doc.text('ESTIMATED TOTAL', M + 8, y + 10)
  font('regular', 8, [170, 186, 192])
  const area = groups.reduce((a, g) => a + g.area, 0)
  doc.text(`${m2(area)}  ·  ${groups.reduce((a, g) => a + g.boxes, 0)} boxes`, M + 8, y + 17)
  font('xbold', 20, GOLD)
  doc.text(money(groups.reduce((a, g) => a + g.cost, 0)), PW - M - 8, y + 15.5, { align: 'right' })
  y += 34
  const contact = contactLines()
  if (contact.length) {
    fill(WHITE)
    doc.setDrawColor(...LINE)
    const ch = 21 + contact.length * 5.5
    doc.roundedRect(M, y, PW - 2 * M, ch, 3, 3, 'FD')
    font('semibold', 7.5, GOLD, 1.4)
    doc.text('READY TO ORDER?', M + 8, y + 9)
    font('semibold', 12, TEXT)
    doc.text(`Contact ${brand.name}`, M + 8, y + 16)
    font('regular', 9, INK_2)
    contact.forEach((c, i) => doc.text(c, M + 8, y + 23 + i * 5.5))
    y += ch + 8
  }
  font('regular', 7.5, MUTED)
  doc.text(
    doc.splitTextToSize(
      'Quantities include a 10% allowance for cuts and breakage and are rounded up to whole boxes. Areas of photo rooms are measured from the photo (walls exclude windows and doors) and are estimates: confirm them on site before ordering. Prices are indicative.',
      PW - 2 * M,
    ),
    M,
    y,
  )
}

/** Catalogue PDF: cover, one page per design, and a combined shopping list. */
export async function downloadCatalogPdf(entries: CatalogEntry[], filename = 'tile-catalog.pdf') {
  if (!entries.length) return
  const k = await newDoc()
  const { doc } = k
  const perEntry = entries.map(linesOf)
  const all = perEntry.flat()
  const products = new Set(all.filter((l) => l.product).map((l) => l.product!.id)).size
  const totals = {
    area: all.reduce((a, l) => a + l.area, 0),
    cost: all.reduce((a, l) => a + (l.calc?.cost ?? 0), 0),
    products,
  }
  await coverPage(k, entries, totals)
  for (let e = 0; e < entries.length; e++) {
    doc.addPage()
    await designPage(k, entries[e], e, perEntry[e])
  }
  if (products > 0) {
    doc.addPage()
    summaryPage(k, all)
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    footer(k, i, pages, i === 1)
  }
  notifyHost('SAVE_PDF', { fileName: filename, arrayBuffer: doc.output('arraybuffer') })
  doc.save(filename)
}

/** One-page product sheet in the catalogue's style. */
export async function downloadProductPdf(p: Product) {
  const k = await newDoc()
  const { doc, font, fill } = k
  fill(PAPER)
  doc.rect(0, 0, PW, PH, 'F')
  fill(INK)
  doc.rect(0, 0, PW, 54, 'F')
  font('semibold', 8, GOLD, 1.6)
  doc.text(`${p.material.toUpperCase()}  ·  ${p.sku}`, M, 22)
  font('xbold', 26, WHITE, -0.3)
  doc.text(p.name, M, 37, { maxWidth: PW - 2 * M })
  font('light', 10, [200, 210, 214])
  doc.text(`${sizeLabel(p.size)}  ·  ${p.finish === 'glossy' ? 'Glossy' : 'Matt'}  ·  ${money(p.price)} / m²`, M, 46)
  // swatch and a laid-out close-up side by side
  const iy = 66
  const iw = (PW - 2 * M - 6) / 2
  doc.addImage(await getSwatch(p), 'JPEG', M, iy, iw, iw)
  doc.addImage(await layoutCloseUp(p, { ...DEFAULT_SETTINGS, layout: p.material === 'Wood' || p.material === 'Subway' ? 'brick' : 'grid' }), 'JPEG', M + iw + 6, iy, iw, iw)
  font('regular', 7.5, MUTED)
  doc.text('Swatch', M, iy + iw + 5)
  doc.text('As laid (1.2 m x 1.2 m)', M + iw + 6, iy + iw + 5)
  // specifications
  let y = iy + iw + 16
  font('semibold', 7.5, INK_2, 1.4)
  doc.text('SPECIFICATIONS', M, y)
  y += 4
  const rows: [string, string][] = [
    ['SKU', p.sku],
    ['Material', p.material],
    ['Size', sizeLabel(p.size)],
    ['Thickness', `${p.thicknessMm} mm`],
    ['Finish', p.finish === 'glossy' ? 'Glossy' : 'Matt'],
    ['Colour', p.color],
    ['Suitable for', p.application.join(', ')],
    ['Pieces per box', `${p.piecesPerBox} (${(((p.size[0] * p.size[1]) / 10000) * p.piecesPerBox).toFixed(2)} m²)`],
    ['Price', `${money(p.price)} / m²`],
  ]
  const colW = (PW - 2 * M) / 2
  rows.forEach(([kk, v], i) => {
    const cx = M + (i % 2) * colW
    const ry = y + Math.floor(i / 2) * 11
    doc.setDrawColor(...LINE)
    doc.line(cx, ry, cx + colW - 6, ry)
    font('regular', 7.5, MUTED)
    doc.text(kk, cx, ry + 5)
    font('semibold', 9, TEXT)
    doc.text(v, cx, ry + 9.5, { maxWidth: colW - 8 })
  })
  y += Math.ceil(rows.length / 2) * 11 + 8
  if (p.description) {
    font('regular', 9, [60, 66, 70])
    doc.text(doc.splitTextToSize(p.description, PW - 2 * M), M, y)
  }
  footer(k, 1, 1)
  notifyHost('SAVE_PDF', { fileName: `${p.sku}.pdf`, arrayBuffer: doc.output('arraybuffer') })
  doc.save(`${p.sku}.pdf`)
}
