import { lazy, Suspense, useRef, useState } from 'react'
import { getRoom } from '../data/rooms'
import { PAINTS } from '../data/paints'
import { PRODUCTS, sizeLabel } from '../data/products'
import { findPaint, findProduct, roomName, surfacesForRoom, useStore } from '../store'
import { DEFAULT_SETTINGS } from '../lib/layout'
import type { Application, LightTheme, SurfaceType } from '../types'
import ProductPanel from './ProductPanel'
import SettingsPanel from './SettingsPanel'
import PhotoScene from './PhotoScene'
import Preview from './Preview'
import RoomSelect from './RoomSelect'
import { addCurrentToCatalog } from './Modals'
import { downloadDataUrl, Icon, IconBtn, Swatch } from './ui'
import { LANGUAGES, useT, type Lang } from '../lib/i18n'
import { notifyHost } from '../lib/host'

const Scene3D = lazy(() => import('./Scene3D'))

const THEMES: { id: LightTheme; label: string; color: string }[] = [
  { id: 'daylight', label: 'Daylight', color: '#ffffff' },
  { id: 'warm', label: 'Warm White', color: '#ffd7a6' },
  { id: 'soft', label: 'Soft White', color: '#fff1dd' },
  { id: 'crystal', label: 'Crystal White', color: '#e4efff' },
]

const TYPE_LABEL: Record<SurfaceType, string> = { floor: 'Floor', wall: 'Wall', countertop: 'Counter Top', backsplash: 'Backsplash', ceiling: 'Ceiling', rug: 'Rug' }

function randomDesign() {
  const s = useStore.getState()
  const surfaces = surfacesForRoom(s.roomId, s.photoRooms)
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  const byType = new Map<SurfaceType, Application>()
  for (const t of ['floor', 'wall', 'countertop', 'backsplash'] as SurfaceType[]) {
    if (t === 'wall' && Math.random() < 0.6) {
      byType.set(t, { kind: 'paint', paintId: pick(PAINTS).id, finish: 'matt' })
      continue
    }
    const options = PRODUCTS.filter((p) => p.application.includes(t) && (t !== 'countertop' || ['Marble', 'Stone', 'Terrazzo', 'Concrete'].includes(p.material)))
    const p = pick(options)
    const layouts = p.material === 'Wood' ? (['brick', 'herringbone', 'grid'] as const) : p.material === 'Pattern' ? (['grid', 'quarter'] as const) : (['grid', 'brick', 'grid', 'diagonal'] as const)
    byType.set(t, { kind: 'tile', productId: p.id, settings: { ...DEFAULT_SETTINGS, finish: p.finish, layout: pick([...layouts]), groutMm: t === 'countertop' ? 0 : DEFAULT_SETTINGS.groutMm } })
  }
  s.setApplied(Object.fromEntries(surfaces.map((x) => [x.id, byType.get(x.type)!])))
}

function Toolbar({ rootRef }: { rootRef: React.RefObject<HTMLDivElement | null> }) {
  const s = useStore()
  const t = useT()
  const [menu, setMenu] = useState<null | 'theme' | 'download' | 'more'>(null)
  const room = getRoom(s.roomId)
  const fs = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.()
  }
  const dl = (hd: boolean) => {
    const url = s.capture?.(hd)
    const fileName = `${roomName(s.roomId).replace(/\s+/g, '-').toLowerCase()}${hd ? '-hd' : ''}.jpg`
    if (url) {
      notifyHost('SAVE_IMAGE', { fileName, imageFormat: 'jpeg', dataUrl: url })
      downloadDataUrl(url, fileName)
      notifyHost('SAVE_IMAGE_END')
    }
    setMenu(null)
  }
  return (
    <div className="toolbar" onMouseLeave={() => setMenu(null)}>
      <IconBtn icon="undo" label={t('Undo')} onClick={s.undo} disabled={!s.past.length} />
      <IconBtn icon="redo" label={t('Redo')} onClick={s.redo} disabled={!s.future.length} />
      <IconBtn icon="reset" label={t('Reset')} onClick={s.reset} />
      <IconBtn icon="shuffle" label={t('Random')} onClick={randomDesign} />
      <IconBtn icon="compare" label={t('Compare')} onClick={() => s.setModal('compare')} />
      {!room && s.photoRooms.some((r) => r.id === s.roomId) && <IconBtn icon="layers" label={t('Surfaces')} onClick={() => s.editSurfaces(s.roomId)} />}
      {room && <IconBtn icon="pano" label="360°" active={s.panorama} onClick={s.togglePanorama} />}
      <div className="menu-wrap">
        <IconBtn icon="sun" label={t('Lighting')} active={menu === 'theme'} onClick={() => setMenu(menu === 'theme' ? null : 'theme')} />
        {menu === 'theme' && (
          <div className="menu">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={s.theme === t.id ? 'on' : ''}
                onClick={() => {
                  s.setTheme(t.id)
                  setMenu(null)
                }}
              >
                <i style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="sep" />
      <IconBtn icon="save" label={t('Save')} onClick={() => s.setModal('save')} />
      <IconBtn icon="book" label={t('Catalogs')} badge={s.catalogs.length} onClick={() => s.setModal('catalog')} />
      <IconBtn icon="cart" label={t('Cart')} badge={s.cart.length} onClick={() => s.setModal('cart')} />
      <IconBtn icon="share" label={t('Share')} onClick={() => s.setModal('share')} />
      <div className="menu-wrap">
        <IconBtn icon="download" label={t('Download')} active={menu === 'download'} onClick={() => setMenu(menu === 'download' ? null : 'download')} />
        {menu === 'download' && (
          <div className="menu right">
            <button onClick={() => dl(true)}>HD image</button>
            <button onClick={() => dl(false)}>Standard image</button>
            <button
              onClick={() => {
                setMenu(null)
                s.setModal('catalog')
              }}
            >
              Catalog PDF…
            </button>
          </div>
        )}
      </div>
      <div className="menu-wrap">
        <IconBtn icon="settings" label={t('More')} active={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')} />
        {menu === 'more' && (
          <div className="menu right">
            <button onClick={() => (setMenu(null), s.setModal('calculator'))}>
              <Icon name="calc" size={15} /> Tile calculator
            </button>
            <button onClick={() => (setMenu(null), s.setModal('saved'))}>
              <Icon name="save" size={15} /> My saved designs
            </button>
            <button onClick={() => (setMenu(null), s.setModal('uploadRoom'))}>
              <Icon name="upload" size={15} /> Upload my room
            </button>
            <button onClick={() => (setMenu(null), fs())}>
              <Icon name="full" size={15} /> Full screen
            </button>
            <button onClick={() => (setMenu(null), s.setModal('rate'))}>
              <Icon name="heart" size={15} /> {t('Rate your experience')}
            </button>
            <button onClick={() => (setMenu(null), s.toggleDark())}>
              <Icon name="moon" size={15} /> {s.dark ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SurfaceChips() {
  const t = useT()
  const roomId = useStore((s) => s.roomId)
  const photoRooms = useStore((s) => s.photoRooms)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const surfaces = surfacesForRoom(roomId, photoRooms)
  const types = Array.from(new Set(surfaces.map((s) => s.type)))
  const idsOf = (t: SurfaceType) => surfaces.filter((s) => s.type === t).map((s) => s.id)
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  const wallFloor = [...idsOf('floor'), ...idsOf('wall')]
  return (
    <div className="surface-chips">
      <span className="lbl">{t('Surface:')}</span>
      {types.map((ty) => {
        const ids = idsOf(ty)
        return (
          <button key={ty} className={same(selected, ids) ? 'on' : ''} onClick={() => select(ids)}>
            {t(TYPE_LABEL[ty] + (ids.length > 1 ? 's' : ''))}
          </button>
        )
      })}
      {types.includes('floor') && types.includes('wall') && (
        <button className={same(selected, wallFloor) ? 'on' : ''} onClick={() => select(wallFloor)}>
          Wall + Floor
        </button>
      )}
      <span className="divider" />
      {surfaces
        .filter((s) => surfaces.filter((x) => x.type === s.type).length > 1)
        .map((s) => (
          <button key={s.id} className={`sub${selected.length === 1 && selected[0] === s.id ? ' on' : ''}`} onClick={() => select([s.id])}>
            {s.label}
          </button>
        ))}
    </div>
  )
}

function AppliedBar() {
  const t = useT()
  const roomId = useStore((s) => s.roomId)
  const photoRooms = useStore((s) => s.photoRooms)
  const applied = useStore((s) => s.applied)
  const selected = useStore((s) => s.selected)
  const showProduct = useStore((s) => s.showProduct)
  const setModal = useStore((s) => s.setModal)
  const surfaces = surfacesForRoom(roomId, photoRooms)
  // unique applied products
  const seen = new Map<string, { label: string[]; node: React.ReactNode; id?: string }>()
  for (const s of surfaces) {
    const a = applied[s.id]
    if (!a) continue
    const key = a.kind === 'tile' ? a.productId : a.paintId
    const ex = seen.get(key)
    if (ex) {
      ex.label.push(s.label)
      continue
    }
    if (a.kind === 'tile') {
      const p = findProduct(a.productId)
      if (p)
        seen.set(key, {
          label: [s.label],
          id: p.id,
          node: (
            <>
              <Swatch product={p} className="mini" />
              <div>
                <b>{p.name}</b>
                <small>{sizeLabel(p.size)}</small>
              </div>
            </>
          ),
        })
    } else {
      const paint = findPaint(a.paintId)
      if (paint)
        seen.set(key, {
          label: [s.label],
          node: (
            <>
              <i className="mini-paint" style={{ background: paint.hex }} />
              <div>
                <b>{paint.name}</b>
                <small>Paint</small>
              </div>
            </>
          ),
        })
    }
  }
  const area = selected.reduce((sum, id) => {
    const s = surfaces.find((x) => x.id === id)
    return sum + (s ? s.size[0] * s.size[1] : 0)
  }, 0)
  return (
    <div className="applied-bar">
      <span className="lbl">{t('Applied products')}</span>
      <div className="applied-items">
        {[...seen.values()].map((v, i) => (
          <button key={i} className="applied-item" onClick={() => v.id && showProduct(v.id)} title={v.label.join(', ')}>
            {v.node}
            <em>{v.label.length > 2 ? `${v.label.length} surfaces` : v.label.join(', ')}</em>
          </button>
        ))}
      </div>
      <div className="applied-actions">
        {area > 0 && <span className="area">Selected: {area.toFixed(1)} m²</span>}
        <button className="btn" onClick={() => setModal('summary')}>
          <Icon name="layers" /> {t('Summary')}
        </button>
        <button className="btn primary" onClick={addCurrentToCatalog}>
          <Icon name="book" /> {t('Add to catalog')}
        </button>
      </div>
    </div>
  )
}

export default function Visualizer({ onClose }: { onClose: () => void }) {
  const view = useStore((s) => s.view)
  const roomId = useStore((s) => s.roomId)
  const photoRooms = useStore((s) => s.photoRooms)
  const backToRooms = useStore((s) => s.backToRooms)
  const dark = useStore((s) => s.dark)
  const panorama = useStore((s) => s.panorama)
  const rootRef = useRef<HTMLDivElement>(null)
  const t = useT()
  const lang = useStore((s) => s.lang)
  /** snapshot of the room shown full screen (null = closed) */
  const [preview, setPreview] = useState<string | null>(null)
  const room = getRoom(roomId)
  const photo = photoRooms.find((r) => r.id === roomId)

  return (
    <div className={`viz${dark ? ' dark' : ''}`} ref={rootRef}>
      <header className="viz-head">
        <div className="brand">
          <span className="logo">
            <Icon name="grid" size={18} />
          </span>
          Tiles Visualiser
        </div>
        {view === 'visualizer' && (
          <>
            <button className="btn ghost" onClick={backToRooms}>
              <Icon name="back" /> <span className="lbl">{t('Change room')}</span>
            </button>
            <div className="head-actions">
              <button className="btn sm" onClick={() => useStore.getState().setModal('inquiry')}>
                <Icon name="info" size={15} /> <span className="lbl">{t('Get in touch')}</span>
              </button>
              <button className="btn sm primary" onClick={addCurrentToCatalog}>
                <Icon name="plus" size={15} /> <span className="lbl">{t('Add to Selection')}</span>
              </button>
            </div>
            <span className="room-title">{roomName(roomId)}</span>
          </>
        )}
        <span className="grow" />
        {view === 'visualizer' && <Toolbar rootRef={rootRef} />}
        <select className="lang-select" value={lang} onChange={(e) => useStore.getState().setLang(e.target.value as Lang)} aria-label={t('Language')} title={t('Language')}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button className="x" onClick={onClose} aria-label="Exit visualiser" title="Exit">
          <Icon name="close" />
        </button>
      </header>
      {view === 'rooms' || (!room && !photo) ? (
        <RoomSelect />
      ) : (
        <div className="viz-main">
          <ProductPanel />
          <div className="stage">
            <SurfaceChips />
            <div className="canvas-area">
              {room ? (
                <Suspense fallback={<div className="loading">Loading room…</div>}>
                  <Scene3D room={room} />
                </Suspense>
              ) : (
                photo && <PhotoScene room={photo} />
              )}
              <SettingsPanel />
              {!panorama && (
                <button
                  className="preview-btn"
                  onClick={() => {
                    const url = useStore.getState().capture?.(true)
                    if (url) setPreview(url)
                  }}
                  title="See the room full screen"
                >
                  <Icon name="full" size={16} /> Preview
                </button>
              )}
              {panorama && room && <div className="pano-hint">360° view · drag to look around</div>}
            </div>
            <AppliedBar />
          </div>
        </div>
      )}
      {preview && <Preview src={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

