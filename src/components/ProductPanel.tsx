import { useMemo, useState } from 'react'
import { COLORS, MATERIALS, sizeLabel } from '../data/products'
import { PAINTS } from '../data/paints'
import { findPaint, findProduct, surfacesForRoom, useAllProducts, useStore } from '../store'
import type { Application, ColorFamily, Finish, Material, Product, SurfaceType } from '../types'
import { DEFAULT_SETTINGS } from '../lib/layout'
import { Icon, Swatch, toast } from './ui'
import { useT } from '../lib/i18n'
import { notifyHost } from '../lib/host'
import { money } from '../lib/calc'

type Tab = 'tiles' | 'paint' | 'upload' | 'applied'
type Sort = 'new' | 'old' | 'az' | 'za' | 'size'

/** Wallpaper, panels and rugs are continuous products: no grout joints. */
const seamless = (p?: Product) => !!p && ['Wallpaper', 'Panel', 'Rug'].includes(p.material)

/** Apply a product to all selected surfaces, keeping each surface's previous layout settings. */
export function applyProduct(p: Product) {
  const s = useStore.getState()
  const surfaces = surfacesForRoom(s.roomId, s.photoRooms)
  let targets = s.selected.filter((id) => {
    const surf = surfaces.find((x) => x.id === id)
    return surf && p.application.includes(surf.type)
  })
  const skipped = s.selected.filter((id) => surfaces.some((x) => x.id === id)).length - targets.length
  if (!targets.length) {
    // nothing suitable selected: use the first surface of this room that accepts the product
    const fallback = surfaces.find((x) => p.application.includes(x.type))
    if (!fallback) {
      toast(`${p.name} can't be used in this room`)
      return
    }
    targets = surfaces.filter((x) => x.type === fallback.type).map((x) => x.id)
    s.select(targets)
    toast(`Applied to ${fallback.type === 'wall' && targets.length > 1 ? 'walls' : fallback.label}`)
  }
  s.apply(targets, (prev) => ({
    kind: 'tile',
    productId: p.id,
    settings: seamless(p)
      ? { ...DEFAULT_SETTINGS, finish: p.finish, layout: 'grid', groutMm: 0 }
      : prev?.kind === 'tile' && !seamless(findProduct(prev.productId))
        ? { ...prev.settings, finish: p.finish }
        : { ...DEFAULT_SETTINGS, finish: p.finish, layout: p.material === 'Wood' || p.material === 'Subway' ? 'brick' : 'grid', groutMm: p.material === 'Wood' ? 1 : 2 },
  }))
  s.pushHistory(p.id)
  notifyHost('PRODUCT_CLICK', { id: p.id, sku: p.sku, name: p.name, surfaces: targets })
  if (skipped > 0) toast(`Applied to ${targets.length} surface(s); ${skipped} not suitable`)
}

/** Paint the selected walls / ceilings. */
export function applyPaint(paintId: string) {
  const s = useStore.getState()
  const surfaces = surfacesForRoom(s.roomId, s.photoRooms)
  const targets = s.selected.filter((id) => ['wall', 'ceiling'].includes(surfaces.find((x) => x.id === id)?.type ?? ''))
  if (!targets.length) return toast('Paint can be applied to walls and ceilings — select one')
  s.apply(targets, { kind: 'paint', paintId, finish: 'matt' })
}

/** Products that suit this room and the selected surfaces, newest first. */
export function suitableProducts(all: Product[], surfaces: { id: string; type: SurfaceType }[], selected: string[]) {
  const roomTypes = new Set(surfaces.map((x) => x.type))
  const selTypes = new Set(selected.map((id) => surfaces.find((x) => x.id === id)?.type).filter(Boolean) as SurfaceType[])
  return all
    .filter((p) => !p.custom && p.application.some((t) => roomTypes.has(t)) && (!selTypes.size || [...selTypes].every((t) => p.application.includes(t))))
    .sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.createdAt - a.createdAt)
}

export default function ProductPanel() {
  const t = useT()
  const all = useAllProducts()
  const selected = useStore((s) => s.selected)
  const roomId = useStore((s) => s.roomId)
  const photoRooms = useStore((s) => s.photoRooms)
  const applied = useStore((s) => s.applied)
  const showProduct = useStore((s) => s.showProduct)
  const setModal = useStore((s) => s.setModal)
  const history = useStore((s) => s.history)
  const removeCustom = useStore((s) => s.removeCustomProduct)
  const [tab, setTab] = useState<Tab>('tiles')
  const [q, setQ] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [mats, setMats] = useState<Material[]>([])
  const [colors, setColors] = useState<ColorFamily[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [finish, setFinish] = useState<Finish | ''>('')
  const [onlySuitable, setOnlySuitable] = useState(true)
  const [sort, setSort] = useState<Sort>('new')
  const [paintFamily, setPaintFamily] = useState<ColorFamily | ''>('')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const surfaces = surfacesForRoom(roomId, photoRooms)
  const roomTypes = [...new Set(surfaces.map((x) => x.type))]
  const selTypes = new Set<SurfaceType>(selected.map((id) => surfaces.find((s) => s.id === id)?.type).filter(Boolean) as SurfaceType[])
  const allSizes = useMemo(() => Array.from(new Set(all.map((p) => sizeLabel(p.size)))).sort((a, b) => parseFloat(a) - parseFloat(b)), [all])

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const r = all.filter(
      (p) =>
        !p.custom &&
        (!ql || `${p.name} ${p.sku} ${p.material} ${p.color}`.toLowerCase().includes(ql)) &&
        (!mats.length || mats.includes(p.material)) &&
        (!colors.length || colors.includes(p.color)) &&
        (!sizes.length || sizes.includes(sizeLabel(p.size))) &&
        (!finish || p.finish === finish) &&
        roomTypes.some((t) => p.application.includes(t)) &&
        (!onlySuitable || !selTypes.size || [...selTypes].every((t) => p.application.includes(t))),
    )
    const cmp: Record<Sort, (a: Product, b: Product) => number> = {
      new: (a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.createdAt - a.createdAt,
      old: (a, b) => a.createdAt - b.createdAt,
      az: (a, b) => a.name.localeCompare(b.name),
      za: (a, b) => b.name.localeCompare(a.name),
      size: (a, b) => a.size[0] * a.size[1] - b.size[0] * b.size[1],
    }
    return r.sort(cmp[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, mats, colors, sizes, finish, onlySuitable, sort, [...selTypes].join(), roomTypes.join()])

  const activeFilterCount = mats.length + colors.length + sizes.length + (finish ? 1 : 0)
  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const isApplied = (id: string) => selected.some((s) => applied[s]?.kind === 'tile' && (applied[s] as Extract<Application, { kind: 'tile' }>).productId === id)

  const ProductCard = ({ p }: { p: Product }) => (
    <div className={`pcard${isApplied(p.id) ? ' on' : ''}`} onClick={() => applyProduct(p)} title={`Apply ${p.name}`}>
      <Swatch product={p} />
      {p.isNew && <span className="tag-new">NEW</span>}
      <button
        className="info"
        title="Product details"
        onClick={(e) => {
          e.stopPropagation()
          showProduct(p.id)
        }}
      >
        <Icon name="info" size={15} />
      </button>
      <div className="pinfo">
        <div className="pname">{p.name}</div>
        <div className="pmeta">
          {sizeLabel(p.size)} · {p.finish === 'glossy' ? 'Glossy' : 'Matt'}
        </div>
        {view === 'list' && (
          <div className="pmeta">
            {p.material} · {money(p.price)}/m² · {p.sku}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <aside className="left-panel">
      <div className="tabs">
        {(
          [
            ['tiles', 'Tiles'],
            ['paint', 'Paint'],
            ['upload', 'My Upload'],
            ['applied', 'Applied'],
          ] as [Tab, string][]
        ).map(([id, l]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {t(l)}
          </button>
        ))}
      </div>

      {tab === 'tiles' && (
        <>
          <div className="search-row">
            <div className="search">
              <Icon name="search" size={16} />
              <input placeholder={t('Search name, SKU, material…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="view-toggle">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="List view" aria-label="List view">
                <Icon name="filter" size={15} />
              </button>
              <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="Grid view" aria-label="Grid view">
                <Icon name="grid" size={15} />
              </button>
            </div>
            <button className={`filter-btn${showFilters ? ' on' : ''}`} onClick={() => setShowFilters(!showFilters)} title="Filters">
              <Icon name="filter" size={16} />
              {activeFilterCount > 0 && <span className="badge">{activeFilterCount}</span>}
            </button>
          </div>
          {showFilters && (
            <div className="filters">
              <div className="fgroup">
                <label>Material</label>
                <div className="chips">
                  {MATERIALS.map((m) => (
                    <button key={m} className={mats.includes(m) ? 'on' : ''} onClick={() => toggle(mats, m, setMats)}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fgroup">
                <label>Colour</label>
                <div className="chips colors">
                  {COLORS.map((c) => (
                    <button key={c.name} className={colors.includes(c.name) ? 'on' : ''} onClick={() => toggle(colors, c.name, setColors)} title={c.name}>
                      <i style={{ background: c.hex }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fgroup">
                <label>Size</label>
                <div className="chips">
                  {allSizes.map((s) => (
                    <button key={s} className={sizes.includes(s) ? 'on' : ''} onClick={() => toggle(sizes, s, setSizes)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fgroup">
                <label>Finish</label>
                <div className="chips">
                  {(['', 'glossy', 'matt'] as const).map((f) => (
                    <button key={f} className={finish === f ? 'on' : ''} onClick={() => setFinish(f)}>
                      {f === '' ? 'Any' : f === 'glossy' ? 'Glossy' : 'Matt'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="frow">
                <label className="check">
                  <input type="checkbox" checked={onlySuitable} onChange={(e) => setOnlySuitable(e.target.checked)} /> Only products for selected surface
                </label>
                <button
                  className="link"
                  onClick={() => {
                    setMats([])
                    setColors([])
                    setSizes([])
                    setFinish('')
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
          <div className="list-head">
            <span>
              {list.length} {t('products')}
            </span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="new">New products first</option>
              <option value="old">Old products first</option>
              <option value="az">Name (A-Z)</option>
              <option value="za">Name (Z-A)</option>
              <option value="size">Size</option>
            </select>
          </div>
          {history.length > 0 && !q && !activeFilterCount && (
            <div className="recent">
              <label>Recently viewed</label>
              <div className="recent-row">
                {history
                  .map((id) => findProduct(id))
                  .filter(Boolean)
                  .slice(0, 8)
                  .map((p) => (
                    <div key={p!.id} title={p!.name} onClick={() => applyProduct(p!)}>
                      <Swatch product={p!} className="mini" />
                    </div>
                  ))}
              </div>
            </div>
          )}
          {selTypes.has('rug') && (
            <button
              className="btn sm no-rug"
              onClick={() => {
                const st = useStore.getState()
                const next = { ...st.applied }
                for (const id of st.selected) if (surfaces.find((x) => x.id === id)?.type === 'rug') delete next[id]
                st.setApplied(next)
              }}
            >
              <Icon name="close" size={14} /> {t('No rug')}
            </button>
          )}
          <div className={view === 'list' ? 'plist' : 'pgrid'}>
            {list.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
            {!list.length && <div className="empty">No products match these filters.</div>}
          </div>
        </>
      )}

      {tab === 'paint' && (
        <>
          <div className="chips pad">
            <button className={paintFamily === '' ? 'on' : ''} onClick={() => setPaintFamily('')}>
              All shades
            </button>
            {COLORS.map((c) => (
              <button key={c.name} className={paintFamily === c.name ? 'on' : ''} onClick={() => setPaintFamily(c.name)}>
                <i style={{ background: c.hex }} />
                {c.name}
              </button>
            ))}
          </div>
          <div className="paint-grid">
            {PAINTS.filter((p) => !paintFamily || p.family === paintFamily).map((p) => {
              const on = selected.some((s) => applied[s]?.kind === 'paint' && (applied[s] as Extract<Application, { kind: 'paint' }>).paintId === p.id)
              return (
                <button
                  key={p.id}
                  className={`paint${on ? ' on' : ''}`}
                    onClick={() => applyPaint(p.id)}
                >
                  <i style={{ background: p.hex }} />
                  <span>{p.name}</span>
                  <small>{p.hex}</small>
                </button>
              )
            })}
          </div>
        </>
      )}

      {tab === 'upload' && (
        <div className="upload-tab">
          <button className="btn primary block" onClick={() => setModal('uploadTile')}>
            <Icon name="upload" /> Upload your product
          </button>
          <p className="hint">Upload a photo of a tile (cropped to the tile edges), set its real size and apply it to any surface.</p>
          <div className="pgrid">
            {all
              .filter((p) => p.custom)
              .map((p) => (
                <div key={p.id} className="pcard" onClick={() => applyProduct(p)}>
                  <Swatch product={p} />
                  <button
                    className="info"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCustom(p.id)
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                  <div className="pname">{p.name}</div>
                  <div className="pmeta">{sizeLabel(p.size)}</div>
                </div>
              ))}
          </div>
          {!all.some((p) => p.custom) && <div className="empty">You have not uploaded any product.</div>}
        </div>
      )}

      {tab === 'applied' && (
        <div className="applied-list">
          {surfaces.map((s) => {
            const a = applied[s.id]
            const p = a?.kind === 'tile' ? findProduct(a.productId) : undefined
            const paint = a?.kind === 'paint' ? findPaint(a.paintId) : undefined
            return (
              <div key={s.id} className={`applied-row${selected.includes(s.id) ? ' on' : ''}`} onClick={() => useStore.getState().select([s.id])}>
                {p ? <Swatch product={p} className="mini" /> : <i className="mini-paint" style={{ background: paint?.hex ?? '#ddd' }} />}
                <div>
                  <b>{s.label}</b>
                  <small>{p ? `${p.name} · ${sizeLabel(p.size)}` : paint ? `Paint · ${paint.name}` : 'Not applied'}</small>
                </div>
                {p && (
                  <button
                    className="info static"
                    onClick={(e) => {
                      e.stopPropagation()
                      showProduct(p.id)
                    }}
                  >
                    <Icon name="info" size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
