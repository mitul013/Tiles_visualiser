/**
 * Send the catalogue over WhatsApp, with no server and no paid API.
 *
 * - Phones (Android Chrome, iPhone Safari) hand the PDF file itself to WhatsApp through the system
 *   share sheet (Web Share API).
 * - Elsewhere (desktop browsers) the PDF is downloaded and WhatsApp opens (app or WhatsApp Web)
 *   with a ready-written message; the customer attaches the downloaded file.
 * - "Send to the shop" opens a chat with the shop's number (public/brand.json `whatsapp`) with the
 *   designs and quantities written out, so the shop gets the lead even without the file.
 *
 * Browsers only allow sharing and opening new windows right after a tap, and building the PDF
 * takes a few seconds, so the catalogue is prepared first and the share / chat actions are then
 * called directly from the next tap.
 */
import type { CatalogEntry } from '../types'
import { brand } from './brand'
import { money } from './calc'
import { buildCatalogPdf, saveBlob, type CatalogSummary } from './pdf'

/** wa.me wants the number as digits only, with the country code */
export const shopWhatsApp = () => brand.whatsapp.replace(/\D/g, '')

export interface PreparedCatalog {
  file: File
  name: string
  /** message for anyone (friends, family, the customer themselves) */
  text: string
  /** message to the shop, asking for a quote */
  shopText: string
}

const m2 = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`

function message(s: CatalogSummary, toShop: boolean) {
  const lines: string[] = []
  lines.push(toShop ? `Hello ${brand.name}, I would like a quote for ${s.designs.length > 1 ? 'these designs' : 'this design'}:` : `My tile design${s.designs.length > 1 ? 's' : ''} from ${brand.name}:`)
  lines.push('')
  s.designs.forEach((d, i) => lines.push(`${i + 1}. ${d.name}${d.link ? `\n${d.link}` : ''}`))
  if (s.products.length) {
    lines.push('', 'Products:')
    for (const p of s.products) lines.push(`• ${p.name} (${p.sku}): ${m2(p.area)}, ${p.boxes} box${p.boxes === 1 ? '' : 'es'}`)
    lines.push('', `Estimated total: ${money(s.cost)}`)
  }
  if (toShop) lines.push('', 'I can send the catalogue PDF as well.')
  return lines.join('\n')
}

const fileName = (entries: CatalogEntry[]) => `${(entries.length === 1 ? entries[0].name : `${brand.name} catalogue`).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'tile-catalog'}.pdf`

/** Build the PDF and the messages (slow: do this before the user's "share" tap). */
export async function prepareCatalog(entries: CatalogEntry[]): Promise<PreparedCatalog> {
  const name = fileName(entries)
  const { blob, summary } = await buildCatalogPdf(entries, name)
  return { file: new File([blob], name, { type: 'application/pdf' }), name, text: message(summary, false), shopText: message(summary, true) }
}

/** Whether this browser can hand a PDF file to other apps (WhatsApp) */
export function canShareFiles() {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  try {
    return !!nav.share && !!nav.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })
  } catch {
    return false
  }
}

const openChat = (number: string, text: string) => window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')

/**
 * Call from a tap. Shares the PDF through the system share sheet where possible ('shared' or
 * 'cancelled'), otherwise downloads it and opens WhatsApp with the message ('downloaded').
 */
export async function sharePrepared(p: PreparedCatalog): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [p.file], title: p.name, text: p.text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // refused here (e.g. inside an iframe without permission): download + chat instead
    }
  }
  saveBlob(p.file, p.name)
  openChat('', `${p.text}\n\n(The catalogue PDF ${p.name} is attached.)`)
  return 'downloaded'
}

/** Call from a tap: a chat with the shop, the designs and quantities written out. */
export function sendToShop(p: PreparedCatalog) {
  openChat(shopWhatsApp(), p.shopText)
}
