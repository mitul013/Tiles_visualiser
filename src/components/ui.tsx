import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Product } from '../types'
import { getSwatch } from '../lib/tileArt'

const paths: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  reset: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  compare: 'M12 3v18M5 7l-3 5 3 5M19 7l3 5-3 5',
  pano: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5M12 7a5 5 0 100 10 5 5 0 000-10z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  book: 'M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z',
  cart: 'M3 4h2l2.4 11.2a2 2 0 002 1.6h7.8a2 2 0 002-1.6L21 8H6M9 21h.01M18 21h.01',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  filter: 'M3 5h18M6 12h12M10 19h4',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7h.01',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  back: 'M15 18l-6-6 6-6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01',
  check: 'M5 12l5 5L20 7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  heart: 'M12 21l-8-8a5 5 0 117-7l1 1 1-1a5 5 0 117 7z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  link: 'M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  pdf: 'M6 3h9l5 5v13H6zM14 3v6h6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  home: 'M3 11l9-8 9 8M5 9v12h14V9',
}

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? paths.info} />
    </svg>
  )
}

export function IconBtn({ icon, label, onClick, active, badge, disabled }: { icon: string; label: string; onClick?: () => void; active?: boolean; badge?: number; disabled?: boolean }) {
  return (
    <button className={`icon-btn${active ? ' active' : ''}`} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      <Icon name={icon} />
      <span className="lbl">{label}</span>
      {!!badge && <span className="badge">{badge}</span>}
    </button>
  )
}

export function Modal({ title, onClose, children, wide, footer, full, headerExtra }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean | 'xl'; footer?: ReactNode; /** fill the whole screen */ full?: boolean; headerExtra?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className={`modal-back${full ? ' full' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide === 'xl' ? ' xl' : wide ? ' wide' : ''}${full ? ' full' : ''}`} role="dialog" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <span className="grow" />
          {headerExtra}
          <button className="x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Swatch({ product, className = '' }: { product: Product; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let ok = true
    const el = ref.current
    const load = () => getSwatch(product).then((s) => ok && setSrc(s))
    // generate thumbnails only when they scroll into view
    if (!el || typeof IntersectionObserver === 'undefined') load()
    else {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          load()
        }
      }, { rootMargin: '200px' })
      io.observe(el)
      return () => {
        ok = false
        io.disconnect()
      }
    }
    return () => {
      ok = false
    }
  }, [product])
  return <div ref={ref} className={`swatch ${className}`} style={{ backgroundImage: src ? `url(${src})` : undefined }} />
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string) {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.className = 'show'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el && (el.className = ''), 2200)
}

export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
