/**
 * Shop branding and money format, read at start-up from public/brand.json (editable on the server
 * without rebuilding). Defaults apply when the file is missing or a field is empty.
 */
export interface Brand {
  name: string
  tagline: string
  logo: string
  website: string
  phone: string
  email: string
  whatsapp: string
  address: string
  currency: string
  locale: string
}

export const brand: Brand = {
  name: 'Tiles Visualiser',
  tagline: 'Try tiles & colours in any room',
  logo: '',
  website: '',
  phone: '',
  email: '',
  whatsapp: '',
  address: '',
  currency: 'USD',
  locale: '',
}

export async function loadBrand() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}brand.json`, { cache: 'no-cache' })
    if (r.ok) {
      const j = (await r.json()) as Partial<Brand>
      for (const k of Object.keys(brand) as (keyof Brand)[]) {
        const v = j[k]
        if (typeof v === 'string' && v.trim()) brand[k] = v.trim()
      }
      formatter = null
    }
  } catch {
    // keep the defaults
  }
  document.title = `${brand.name} — ${brand.tagline}`
}

/** absolute URL of the logo (relative paths are taken from the site's base) */
export const logoUrl = () => (!brand.logo ? '' : /^(https?:|data:)/.test(brand.logo) ? brand.logo : `${import.meta.env.BASE_URL}${brand.logo.replace(/^\//, '')}`)

let formatter: Intl.NumberFormat | null = null
/** a price in the shop's currency, e.g. $1,234.50 or ₹1,23,450.00 */
export function formatMoney(n: number) {
  if (!formatter)
    try {
      formatter = new Intl.NumberFormat(brand.locale || undefined, { style: 'currency', currency: brand.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
    }
  return formatter.format(n)
}

/** contact lines that are filled in, for PDFs and the page footer */
export const contactLines = () => [brand.phone && `Phone ${brand.phone}`, brand.whatsapp && `WhatsApp ${brand.whatsapp}`, brand.email, brand.website, brand.address].filter(Boolean) as string[]
