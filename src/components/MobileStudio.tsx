/**
 * The visualiser on phones (and tablets held upright): the room stays on screen while the customer
 * swipes through tiles underneath, one tap applies. Quick chips change finish, layout, grout and
 * rotation; everything else lives in a bottom sheet so the room gets the space.
 */
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { getRoom } from '../data/rooms'
import { PAINTS } from '../data/paints'
import { sizeLabel } from '../data/products'
import { findPaint, findProduct, roomName, surfacesForRoom, useAllProducts, useStore } from '../store'
import { LAYOUTS } from '../lib/layout'
import { calculate, money } from '../lib/calc'
import { brand, formatMoneyRound } from '../lib/brand'
import { LANGUAGES, useT, type Lang } from '../lib/i18n'
import type { Application, LightTheme, Product, SurfaceType } from '../types'
import ProductPanel, { applyPaint, applyProduct, suitableProducts } from './ProductPanel'
import SettingsPanel, { LayoutIcon } from './SettingsPanel'
import PhotoScene from './PhotoScene'
import Preview from './Preview'
import { addCurrentToCatalog } from './Modals'
import { downloadDataUrl, Icon, Swatch } from './ui'

const Scene3D = lazy(() => import('./Scene3D'))

const TYPE_LABEL: Record<SurfaceType, string> = {
  floor: 'Floor',
  wall: 'Wall',
  countertop: 'Counter Top',
  backsplash: 'Backsplash',
  ceiling: 'Ceiling',
  rug: 'Rug',
}
const THEMES: { id: LightTheme; label: string; color: string }[] = [
  { id: 'daylight', label: 'Daylight', color: '#ffffff' },
  { id: 'warm', label: 'Warm', color: '#ffd7a6' },
  { id: 'soft', label: 'Soft', color: '#fff1dd' },
  { id: 'crystal', label: 'Cool', color: '#e4efff' },
]
const RAIL_MAX = 40
type Cat = 'tiles' | 'paint' | 'favs' | 'recent'
type SheetKind = null | 'menu' | 'browse' | 'settings'
type TileApp = Extract<Application, { kind: 'tile' }>

/** a chat with the shop on WhatsApp with this design written out */
function chatWithShop(surfaces: { id: string; label: string }[], applied: Record<string, Application>) {
  const lines = [`Hello ${brand.name}, I am interested in this design (${roomName(useStore.getState().roomId)}):`, '']
  for (const s of surfaces) {
    const a = applied[s.id]
    if (a?.kind === 'tile') {
      const p = findProduct(a.productId)
      if (p) lines.push(`• ${s.label}: ${p.name} (${p.sku}), ${sizeLabel(p.size)}`)
    } else if (a?.kind === 'paint') {
      const p = findPaint(a.paintId)
      if (p) lines.push(`• ${s.label}: paint ${p.name}`)
    }
  }
  window.open(`https://wa.me/${brand.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener')
}

function Sheet({ title, onClose, children, tall }: { title: string; onClose: () => void; children: React.ReactNode; tall?: boolean }) {
  const start = useRef<number | null>(null)
  const [dy, setDy] = useState(0)
  return (
    <div className="ms-sheet-wrap" onClick={onClose}>
      <div className={`ms-sheet${tall ? ' tall' : ''}`} style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div
          className="ms-sheet-head"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return
            start.current = e.clientY
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => start.current !== null && setDy(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            if (dy > 90) onClose()
            start.current = null
            setDy(0)
          }}
        >
          <span className="handle" />
          <b>{title}</b>
          <button className="ms-icon" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="ms-sheet-body">{children}</div>
      </div>
    </div>
  )
}

function Card({ p, on, fav }: { p: Product; on: boolean; fav: boolean }) {
  const toggleFav = useStore((s) => s.toggleFav)
  return (
    <div className={`ms-card${on ? ' on' : ''}`} onClick={() => applyProduct(p)} role="button" aria-label={`Apply ${p.name}`}>
      <div className="ms-card-img">
        <Swatch product={p} />
        {p.isNew && <span className="ms-new">NEW</span>}
        <button
          className={`ms-fav${fav ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleFav(p.id)
          }}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Icon name="heart" size={15} />
        </button>
        {on && (
          <span className="ms-check">
            <Icon name="check" size={13} />
          </span>
        )}
      </div>
      <b>{p.name}</b>
      <small>
        {sizeLabel(p.size)} · {formatMoneyRound(p.price)}/m²
      </small>
    </div>
  )
}

export default function MobileStudio({ onClose }: { onClose: () => void }) {
  const t = useT()
  const s = useStore()
  const all = useAllProducts()
  const [cat, setCat] = useState<Cat>('tiles')
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [peek, setPeek] = useState(false)
  const room = getRoom(s.roomId)
  const photo = s.photoRooms.find((r) => r.id === s.roomId)
  const surfaces = surfacesForRoom(s.roomId, s.photoRooms)
  const types = Array.from(new Set(surfaces.map((x) => x.type)))
  const idsOf = (ty: SurfaceType) => surfaces.filter((x) => x.type === ty).map((x) => x.id)
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  // photos carry their labels on the surfaces; the chip row is only needed for groups and 3D rooms
  const showChips = !!room || types.some((ty) => idsOf(ty).length > 1)

  // what is on the selected surfaces
  const tiled = s.selected.filter((id) => s.applied[id]?.kind === 'tile')
  const painted = s.selected.filter((id) => s.applied[id]?.kind === 'paint')
  const first = tiled.length ? (s.applied[tiled[0]] as TileApp) : null
  const product = first ? findProduct(first.productId) : undefined
  const paint = !first && painted.length ? findPaint((s.applied[painted[0]] as Extract<Application, { kind: 'paint' }>).paintId) : undefined
  const seamless = !!product && ['Wallpaper', 'Panel', 'Rug'].includes(product.material)
  const appliedIds = new Set(s.selected.map((id) => (s.applied[id]?.kind === 'tile' ? (s.applied[id] as TileApp).productId : '')))

  // live estimate for the selected surfaces
  const est = useMemo(() => {
    let area = 0
    let cost = 0
    for (const id of s.selected) {
      const sf = surfaces.find((x) => x.id === id)
      if (!sf) continue
      area += sf.area
      const a = s.applied[id]
      const p = a?.kind === 'tile' ? findProduct(a.productId) : undefined
      if (p && a?.kind === 'tile') cost += calculate(p, sf.area, 10, a.settings.groutMm).cost
    }
    return { area, cost }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selected, s.applied, s.roomId, s.photoRooms])
  const selLabel = (() => {
    const sel = surfaces.filter((x) => s.selected.includes(x.id))
    if (sel.length === 1) return sel[0].label
    const ty = new Set(sel.map((x) => x.type))
    return ty.size === 1 ? t(TYPE_LABEL[sel[0].type] + 's') : `${sel.length} surfaces`
  })()

  const rail = useMemo(() => {
    if (cat === 'tiles') return suitableProducts(all, surfaces, s.selected)
    if (cat === 'favs') return s.favs.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Product[]
    if (cat === 'recent') return s.history.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Product[]
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, all, s.selected, s.favs, s.history, s.roomId, s.photoRooms])

  const updateTiles = (patch: Partial<TileApp['settings']>) => s.apply(tiled, (prev) => (prev?.kind === 'tile' ? { ...prev, settings: { ...prev.settings, ...patch } } : prev!))
  const layout = first ? LAYOUTS.find((l) => l.id === first.settings.layout) : undefined

  const openPreview = () => {
    const url = s.capture?.(true)
    if (url) setPreview(url)
  }
  const download = () => {
    const url = s.capture?.(true)
    if (url) downloadDataUrl(url, `${roomName(s.roomId).replace(/\s+/g, '-').toLowerCase()}.jpg`)
  }
  const menu = (fn: () => void) => () => {
    setSheet(null)
    fn()
  }

  return (
    <div className="ms">
      <header className="ms-top">
        <button className="ms-icon" onClick={s.backToRooms} aria-label={t('Change room')} title={t('Change room')}>
          <Icon name="back" size={20} />
        </button>
        <div className="ms-title">
          <b>{roomName(s.roomId)}</b>
          <small>{brand.name}</small>
        </div>
        <button className="ms-icon" onClick={s.undo} disabled={!s.past.length} aria-label={t('Undo')}>
          <Icon name="undo" size={19} />
        </button>
        <button className="ms-icon" onClick={s.redo} disabled={!s.future.length} aria-label={t('Redo')}>
          <Icon name="redo" size={19} />
        </button>
        <button className="ms-icon" onClick={() => setSheet('menu')} aria-label={t('More')}>
          <Icon name="dots" size={20} />
        </button>
      </header>

      <div className={`ms-stage${showChips ? ' with-chips' : ''}`}>
        <div className="canvas-area">
          {room ? (
            <Suspense fallback={<div className="loading">Loading room…</div>}>
              <Scene3D room={room} />
            </Suspense>
          ) : (
            photo && <PhotoScene room={photo} pins />
          )}
          {peek && s.originalShot && <img className={`ms-original${room ? ' full' : ''}`} src={s.originalShot} alt="" />}
          {peek && <span className="ms-peek-tag">Original</span>}
        </div>
        {showChips && (
          <div className="ms-surfaces">
            {types.map((ty) => {
              const ids = idsOf(ty)
              return (
                <button key={ty} className={same(s.selected, ids) ? 'on' : ''} onClick={() => s.select(ids)}>
                  {t(TYPE_LABEL[ty] + (ids.length > 1 ? 's' : ''))}
                </button>
              )
            })}
            {room &&
              surfaces
                .filter((x) => surfaces.filter((y) => y.type === x.type).length > 1)
                .map((x) => (
                  <button key={x.id} className={s.selected.length === 1 && s.selected[0] === x.id ? 'on' : ''} onClick={() => s.select([x.id])}>
                    {x.label}
                  </button>
                ))}
          </div>
        )}
        <div className="ms-fabs">
          {!s.panorama && (
            <button className="ms-fab" onClick={openPreview} aria-label="Full screen">
              <Icon name="full" size={18} />
            </button>
          )}
          {s.originalShot && (
            <button
              className={`ms-fab${peek ? ' on' : ''}`}
              onPointerDown={() => setPeek(true)}
              onPointerUp={() => setPeek(false)}
              onPointerLeave={() => setPeek(false)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Hold to see the original room"
              title="Hold to see the original"
            >
              <Icon name="eye" size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="ms-opts">
        {product && first ? (
          <>
            <button className="ms-chip prod" onClick={() => s.showProduct(product.id)}>
              <Swatch product={product} className="mini" />
              <span>
                <b>{product.name}</b>
                <small>{sizeLabel(product.size)}</small>
              </span>
            </button>
            {!seamless && (
              <>
                <button
                  className="ms-chip"
                  onClick={() =>
                    updateTiles({
                      finish: first.settings.finish === 'glossy' ? 'matt' : 'glossy',
                    })
                  }
                >
                  <Icon name="sparkle" size={15} /> {first.settings.finish === 'glossy' ? t('Glossy') : t('Matt')}
                </button>
                <button className="ms-chip" onClick={() => setSheet('settings')}>
                  <LayoutIcon id={first.settings.layout} /> {layout?.label ?? t('Layout')}
                </button>
                <button className="ms-chip" onClick={() => setSheet('settings')}>
                  <i className="ms-grout" style={{ background: first.settings.groutColor }} /> {t('Grout')} {first.settings.groutMm} mm
                </button>
                <button
                  className="ms-chip"
                  onClick={() =>
                    updateTiles({
                      rotation: first.settings.rotation === 0 ? 45 : first.settings.rotation === 45 ? 90 : 0,
                    })
                  }
                >
                  <Icon name="rotate" size={15} /> {first.settings.rotation}°
                </button>
              </>
            )}
            <button className="ms-chip" onClick={() => setSheet('settings')}>
              <Icon name="settings" size={15} /> {t('More')}
            </button>
          </>
        ) : paint ? (
          <>
            <span className="ms-chip prod static">
              <i className="mini-paint" style={{ background: paint.hex }} />
              <span>
                <b>{paint.name}</b>
                <small>Paint</small>
              </span>
            </span>
            <button className="ms-chip" onClick={() => setSheet('settings')}>
              <Icon name="sparkle" size={15} /> Finish
            </button>
          </>
        ) : (
          <span className="ms-hint">
            Tap a tile below to try it on the <b>{selLabel}</b>
          </span>
        )}
      </div>

      <div className="ms-cats">
        {(
          [
            ['tiles', 'Tiles'],
            ['paint', 'Paint'],
            ['favs', 'Favourites'],
            ['recent', 'Recent'],
          ] as [Cat, string][]
        ).map(([id, l]) => (
          <button key={id} className={cat === id ? 'on' : ''} onClick={() => setCat(id)}>
            {t(l)}
            {id === 'favs' && s.favs.length > 0 && <em>{s.favs.length}</em>}
          </button>
        ))}
        <span className="grow" />
        <button className="ms-icon sm" onClick={() => setSheet('browse')} aria-label={t('Search')}>
          <Icon name="search" size={18} />
        </button>
        <button className="ms-icon sm" onClick={() => setSheet('browse')} aria-label="Filters">
          <Icon name="filter" size={18} />
        </button>
      </div>

      <div className="ms-rail">
        {cat === 'paint'
          ? PAINTS.map((p) => {
              const on = s.selected.some((id) => s.applied[id]?.kind === 'paint' && (s.applied[id] as Extract<Application, { kind: 'paint' }>).paintId === p.id)
              return (
                <button key={p.id} className={`ms-paint${on ? ' on' : ''}`} onClick={() => applyPaint(p.id)}>
                  <i style={{ background: p.hex }} />
                  <b>{p.name}</b>
                  <small>{p.hex}</small>
                </button>
              )
            })
          : rail.slice(0, RAIL_MAX).map((p) => <Card key={p.id} p={p} on={appliedIds.has(p.id)} fav={s.favs.includes(p.id)} />)}
        {cat !== 'paint' && rail.length > RAIL_MAX && (
          <button className="ms-more" onClick={() => setSheet('browse')}>
            <b>{rail.length - RAIL_MAX}+</b>
            <span>View all</span>
          </button>
        )}
        {cat !== 'paint' && !rail.length && (
          <div className="ms-empty">{cat === 'favs' ? 'Tap ♡ on a tile to keep it here.' : cat === 'recent' ? 'Tiles you try appear here.' : 'No tiles for this surface.'}</div>
        )}
      </div>

      <footer className="ms-bottom">
        <button className="ms-est" onClick={() => s.setModal('summary')}>
          <small>
            {selLabel} · {est.area.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²
          </small>
          <b>{est.cost > 0 ? money(est.cost) : t('Summary')}</b>
        </button>
        <button className="ms-icon badge-wrap" onClick={() => s.setModal('catalog')} aria-label={t('Catalogs')}>
          <Icon name="book" size={20} />
          {s.catalogs.length > 0 && <span className="badge">{s.catalogs.length}</span>}
        </button>
        <button className="btn primary ms-add" onClick={addCurrentToCatalog}>
          <Icon name="plus" size={17} /> {t('Add to catalog')}
        </button>
      </footer>

      {sheet === 'menu' && (
        <Sheet title={t('More')} onClose={() => setSheet(null)}>
          {brand.whatsapp && (
            <button className="ms-wa" onClick={menu(() => chatWithShop(surfaces, s.applied))}>
              <Icon name="whatsapp" size={20} />
              <span>
                <b>Chat with {brand.name}</b>
                <small>Send this design on WhatsApp</small>
              </span>
            </button>
          )}
          <div className="ms-menu">
            <button onClick={menu(() => s.setModal('save'))}>
              <Icon name="save" /> {t('Save')}
            </button>
            <button onClick={menu(() => s.setModal('share'))}>
              <Icon name="share" /> {t('Share')}
            </button>
            <button onClick={menu(download)}>
              <Icon name="download" /> Image
            </button>
            <button onClick={menu(() => s.setModal('catalog'))}>
              <Icon name="pdf" /> Catalogue PDF
            </button>
            <button onClick={menu(() => s.setModal('compare'))}>
              <Icon name="compare" /> {t('Compare')}
            </button>
            <button onClick={menu(s.reset)}>
              <Icon name="reset" /> {t('Reset')}
            </button>
            {photo && (
              <button onClick={menu(() => s.editSurfaces(s.roomId))}>
                <Icon name="layers" /> Edit surfaces
              </button>
            )}
            {room && (
              <button onClick={menu(s.togglePanorama)} className={s.panorama ? 'on' : ''}>
                <Icon name="pano" /> 360°
              </button>
            )}
            <button onClick={menu(() => s.setModal('cart'))}>
              <Icon name="cart" /> {t('Cart')}
              {s.cart.length > 0 && <em>{s.cart.length}</em>}
            </button>
            <button onClick={menu(() => s.setModal('calculator'))}>
              <Icon name="calc" /> Calculator
            </button>
            <button onClick={menu(() => s.setModal('saved'))}>
              <Icon name="home" /> Saved designs
            </button>
            <button onClick={menu(() => s.setModal('uploadRoom'))}>
              <Icon name="upload" /> Upload room
            </button>
            <button onClick={menu(() => s.setModal('inquiry'))}>
              <Icon name="info" /> {t('Get in touch')}
            </button>
            <button onClick={menu(s.toggleDark)}>
              <Icon name="moon" /> {s.dark ? 'Light theme' : 'Dark theme'}
            </button>
            <button onClick={menu(onClose)}>
              <Icon name="close" /> Exit
            </button>
          </div>
          <label className="ms-label">{t('Lighting')}</label>
          <div className="ms-themes">
            {THEMES.map((th) => (
              <button key={th.id} className={s.theme === th.id ? 'on' : ''} onClick={() => s.setTheme(th.id)}>
                <i style={{ background: th.color }} /> {th.label}
              </button>
            ))}
          </div>
          <label className="ms-label">{t('Language')}</label>
          <select className="ms-lang" value={s.lang} onChange={(e) => s.setLang(e.target.value as Lang)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Sheet>
      )}
      {sheet === 'settings' && (
        <Sheet title={product ? product.name : t('Settings')} onClose={() => setSheet(null)}>
          <SettingsPanel embedded />
        </Sheet>
      )}
      {sheet === 'browse' && (
        <Sheet title={`${t('Tiles')} · ${selLabel}`} onClose={() => setSheet(null)} tall>
          {/* picking a product closes the sheet so the customer sees it in the room */}
          <div
            className="ms-browse"
            onClickCapture={(e) => (e.target as HTMLElement).closest('.pcard, .paint') && !(e.target as HTMLElement).closest('.info') && setTimeout(() => setSheet(null), 120)}
          >
            <ProductPanel />
          </div>
        </Sheet>
      )}
      {preview && <Preview src={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
