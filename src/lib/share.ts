import type { Application, Design } from '../types'

/** Compact, URL-safe encoding of a design so it can be shared as a link / QR code. */
export function encodeDesign(d: Design): string {
  const json = JSON.stringify({ r: d.roomId, a: d.applied })
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeDesign(s: string): Design | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const o = JSON.parse(new TextDecoder().decode(bytes)) as { r: string; a: Record<string, Application> }
    if (typeof o.r !== 'string' || typeof o.a !== 'object') return null
    return { roomId: o.r, applied: o.a }
  } catch {
    return null
  }
}

export const shareUrl = (d: Design) => `${location.origin}${location.pathname}#design=${encodeDesign(d)}`

export function readDesignFromHash(): Design | null {
  const m = location.hash.match(/design=([A-Za-z0-9_-]+)/)
  return m ? decodeDesign(m[1]) : null
}
