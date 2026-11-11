import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import type { CatalogEntry, Product } from '../types'
import { findPaint, findProduct, roomName, surfacesForRoom, useStore } from '../store'
import { getSwatch } from './tileArt'
import { calculate, money } from './calc'
import { sizeLabel } from '../data/products'
import { LAYOUTS } from './layout'
import { shareUrl } from './share'

const BRAND = 'Tiles Visualiser'

/** Build a PDF with one page per catalog entry: room render, QR link and the products used. */
export async function downloadCatalogPdf(entries: CatalogEntry[], filename = 'tile-catalog.pdf') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const photoRooms = useStore.getState().photoRooms

  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e]
    if (e > 0) doc.addPage()
    doc.setFillColor(1, 42, 56)
    doc.rect(0, 0, W, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13)
    doc.text(BRAND, 12, 11.5)
    doc.setFontSize(9)
    doc.text(new Date(entry.createdAt).toLocaleDateString(), W - 12, 11.5, { align: 'right' })

    doc.setTextColor(20, 20, 20)
    doc.setFontSize(16)
    doc.text(entry.name, 12, 29)
    doc.setFontSize(10)
    doc.setTextColor(110, 110, 110)
    doc.text(roomName(entry.design.roomId), 12, 35)

    // room image
    const imgW = W - 24
    const img = new Image()
    img.src = entry.image
    await img.decode().catch(() => undefined)
    const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 9 / 16
    const imgH = Math.min(120, imgW * ratio)
    doc.addImage(entry.image, 'JPEG', 12, 40, imgH / ratio, imgH)

    // QR
    const qr = await QRCode.toDataURL(shareUrl(entry.design), { margin: 0, width: 240 })
    doc.addImage(qr, 'PNG', W - 12 - 26, 40 + imgH + 6, 26, 26)
    doc.setFontSize(7)
    doc.text('Scan to open this design', W - 12 - 13, 40 + imgH + 36, { align: 'center' })

    // products table
    let y = 40 + imgH + 10
    doc.setFontSize(12)
    doc.setTextColor(20, 20, 20)
    doc.text('Applied products', 12, y)
    y += 5
    const surfaces = surfacesForRoom(entry.design.roomId, photoRooms)
    for (const s of surfaces) {
      const app = entry.design.applied[s.id]
      if (!app) continue
      if (y > 270) {
        doc.addPage()
        y = 20
      }
      const area = s.size[0] * s.size[1]
      doc.setDrawColor(230, 230, 230)
      doc.line(12, y, W - 50, y)
      y += 2
      if (app.kind === 'tile') {
        const p = findProduct(app.productId)
        if (!p) continue
        const sw = await getSwatch(p)
        doc.addImage(sw, 'JPEG', 12, y, 14, 14)
        const c = calculate(p, area, 10, app.settings.groutMm)
        doc.setFontSize(10)
        doc.setTextColor(20, 20, 20)
        doc.text(`${p.name}  (${p.sku})`, 30, y + 4)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(`${s.label} · ${sizeLabel(p.size)} · ${p.material} · ${app.settings.finish} · ${LAYOUTS.find((l) => l.id === app.settings.layout)?.label} · grout ${app.settings.groutMm}mm`, 30, y + 9)
        doc.text(`${area.toFixed(1)} m² → ${c.boxes} boxes (${c.tiles} pcs) · est. ${money(c.cost)}`, 30, y + 13)
      } else {
        const paint = findPaint(app.paintId)
        if (!paint) continue
        doc.setFillColor(paint.hex)
        doc.rect(12, y, 14, 14, 'F')
        doc.setFontSize(10)
        doc.setTextColor(20, 20, 20)
        doc.text(`Paint: ${paint.name} (${paint.hex})`, 30, y + 4)
        doc.setFontSize(8)
        doc.setTextColor(100, 100, 100)
        doc.text(`${s.label} · ${area.toFixed(1)} m²`, 30, y + 9)
      }
      y += 17
    }
  }
  doc.save(filename)
}

export async function downloadProductPdf(p: Product) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFillColor(1, 42, 56)
  doc.rect(0, 0, 210, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.text(BRAND, 12, 11.5)
  doc.setTextColor(20, 20, 20)
  doc.setFontSize(18)
  doc.text(p.name, 12, 32)
  doc.addImage(await getSwatch(p), 'JPEG', 12, 40, 90, 90)
  const rows: [string, string][] = [
    ['SKU', p.sku],
    ['Material', p.material],
    ['Size', sizeLabel(p.size)],
    ['Thickness', `${p.thicknessMm} mm`],
    ['Finish', p.finish],
    ['Colour', p.color],
    ['Application', p.application.join(', ')],
    ['Pieces / box', String(p.piecesPerBox)],
    ['Price', `${money(p.price)} / m²`],
  ]
  doc.setFontSize(10)
  rows.forEach(([k, v], i) => {
    doc.setTextColor(120, 120, 120)
    doc.text(k, 110, 46 + i * 9)
    doc.setTextColor(20, 20, 20)
    doc.text(v, 145, 46 + i * 9)
  })
  doc.setTextColor(60, 60, 60)
  doc.text(doc.splitTextToSize(p.description, 186), 12, 142)
  doc.save(`${p.sku}.pdf`)
}
