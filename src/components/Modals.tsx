import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { findPaint, findProduct, roomName, surfacesForRoom, useAllProducts, useStore, currentDesign } from '../store'
import { sizeLabel } from '../data/products'
import { calculate, M2_TO_FT2, money } from '../lib/calc'
import { downloadCatalogPdf, downloadProductPdf } from '../lib/pdf'
import { shareUrl } from '../lib/share'
import { LAYOUTS } from '../lib/layout'
import type { CatalogEntry, Design, Product, SurfaceType } from '../types'
import { applyProduct } from './ProductPanel'
import { downloadDataUrl, Icon, Modal, Swatch, toast } from './ui'
import UploadRoomModal from './UploadRoom'

const uid = () => Math.random().toString(36).slice(2, 10)

/** Lists every applied product in a design with area-based quantities. */
function designLines(d: Design) {
  const surfaces = surfacesForRoom(d.roomId, useStore.getState().photoRooms)
  return surfaces
    .map((s) => {
      const a = d.applied[s.id]
      const area = s.size[0] * s.size[1]
      if (!a) return null
      if (a.kind === 'tile') {
        const p = findProduct(a.productId)
        return p ? { surface: s, area, product: p, settings: a.settings, calc: calculate(p, area, 10, a.settings.groutMm) } : null
      }
      const paint = findPaint(a.paintId)
      return paint ? { surface: s, area, paint } : null
    })
    .filter(Boolean) as ({ surface: { id: string; label: string; type: SurfaceType }; area: number } & ({ product: Product; settings: import('../types').SurfaceSettings; calc: ReturnType<typeof calculate> } | { paint: NonNullable<ReturnType<typeof findPaint>> }))[]
}

export function addCurrentToCatalog() {
  const s = useStore.getState()
  const image = s.capture?.() ?? ''
  if (!image) return toast('Scene is still loading')
  const entry: CatalogEntry = { id: uid(), name: `${roomName(s.roomId)} #${s.catalogs.filter((c) => c.design.roomId === s.roomId).length + 1}`, createdAt: Date.now(), design: currentDesign(), image }
  s.addCatalog(structuredClone(entry))
  toast('Added to your catalog')
}

export function CatalogModal() {
  const catalogs = useStore((s) => s.catalogs)
  const remove = useStore((s) => s.removeCatalog)
  const openRoom = useStore((s) => s.openRoom)
  const close = () => useStore.getState().setModal(null)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const chosen = sel.length ? catalogs.filter((c) => sel.includes(c.id)) : catalogs
  const dl = async () => {
    setBusy(true)
    try {
      await downloadCatalogPdf(chosen)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Your Catalogs"
      onClose={close}
      wide="xl"
      footer={
        <>
          <button className="btn" onClick={addCurrentToCatalog}>
            <Icon name="plus" /> Add current design
          </button>
          <span className="grow" />
          {catalogs.length > 0 && (
            <>
              <button className="btn" onClick={() => setSel(sel.length === catalogs.length ? [] : catalogs.map((c) => c.id))}>
                {sel.length === catalogs.length ? 'Deselect all' : 'Select all'}
              </button>
              <button className="btn primary" disabled={busy} onClick={dl}>
                <Icon name="pdf" /> {busy ? 'Generating…' : `Download PDF (${chosen.length})`}
              </button>
            </>
          )}
        </>
      }
    >
      {!catalogs.length ? (
        <div className="empty big">
          <Icon name="book" size={40} />
          <p>You don't have any catalog yet.</p>
          <p className="hint">Design a room and press “Add to Catalog” — then download all your designs as one PDF.</p>
        </div>
      ) : (
        <>
          <p className="hint">Download all your designs as one PDF. Each page includes the room render, a QR code to reopen the design, and the applied products with quantities.</p>
          <div className="catalog-grid">
            {catalogs.map((c) => {
              const lines = designLines(c.design)
              return (
                <div key={c.id} className={`cat-card${sel.includes(c.id) ? ' on' : ''}`}>
                  <label className="cat-check">
                    <input type="checkbox" checked={sel.includes(c.id)} onChange={() => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id])} />
                  </label>
                  <img src={c.image} alt={c.name} />
                  <div className="cat-info">
                    <b>{c.name}</b>
                    <small>{new Date(c.createdAt).toLocaleString()}</small>
                    <ul>
                      {lines.slice(0, 4).map((l) => (
                        <li key={l.surface.id}>
                          {l.surface.label}: {'product' in l ? l.product.name : `Paint ${l.paint.name}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="cat-actions">
                    <button
                      className="btn sm"
                      onClick={() => {
                        openRoom(c.design.roomId, structuredClone(c.design.applied))
                        close()
                      }}
                    >
                      Open
                    </button>
                    <button className="btn sm" onClick={() => downloadCatalogPdf([c], `${c.name}.pdf`)}>
                      PDF
                    </button>
                    <button className="btn sm" onClick={() => downloadDataUrl(c.image, `${c.name}.jpg`)}>
                      Image
                    </button>
                    <button className="btn sm danger" onClick={() => remove(c.id)} aria-label="Delete">
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}

export function CartModal() {
  const cart = useStore((s) => s.cart)
  const setArea = useStore((s) => s.setCartArea)
  const remove = useStore((s) => s.removeFromCart)
  const clear = useStore((s) => s.clearCart)
  const close = () => useStore.getState().setModal(null)
  const [unit, setUnit] = useState<'m' | 'ft'>('m')
  const [step, setStep] = useState<'cart' | 'form' | 'done'>('cart')
  const rows = cart.map((c) => ({ c, p: findProduct(c.productId) })).filter((r) => r.p) as { c: (typeof cart)[number]; p: Product }[]
  const totals = rows.reduce(
    (acc, { c, p }) => {
      const r = calculate(p, c.areaM2)
      acc.area += c.areaM2
      acc.cost += r.cost
      acc.boxes += r.boxes
      acc.weight += r.boxes * r.boxArea * p.thicknessMm * 2.4
      return acc
    },
    { area: 0, cost: 0, boxes: 0, weight: 0 },
  )
  const conv = (m2: number) => (unit === 'm' ? m2 : m2 * M2_TO_FT2)
  return (
    <Modal title={step === 'cart' ? 'Your Selection' : 'Send Order / Inquiry'} onClose={close} wide>
      {step === 'done' ? (
        <div className="empty big">
          <Icon name="check" size={40} />
          <p>Your order inquiry has been prepared!</p>
          <p className="hint">This demo has no backend: your email client was opened with the order summary.</p>
          <button className="btn primary" onClick={close}>
            Back to visualiser
          </button>
        </div>
      ) : step === 'form' ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const body = [`Name: ${f.get('name')}`, `Phone: ${f.get('phone')}`, `City: ${f.get('city')}`, `Message: ${f.get('msg')}`, '', ...rows.map(({ c, p }) => `${p.name} (${p.sku}) – ${c.areaM2.toFixed(1)} m² – ${calculate(p, c.areaM2).boxes} boxes`), '', `Total: ${money(totals.cost)}`].join('\n')
            location.href = `mailto:?subject=${encodeURIComponent('Tile order inquiry')}&body=${encodeURIComponent(body)}`
            setStep('done')
          }}
        >
          <label>
            Full name<input name="name" required />
          </label>
          <label>
            Mobile / WhatsApp number<input name="phone" required inputMode="tel" />
          </label>
          <label>
            City<input name="city" />
          </label>
          <label>
            Message for company<textarea name="msg" rows={3} />
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep('cart')}>
              Back
            </button>
            <button className="btn primary">Submit order</button>
          </div>
        </form>
      ) : !rows.length ? (
        <div className="empty big">
          <Icon name="cart" size={40} />
          <p>Your cart is empty</p>
          <p className="hint">Use “Add to cart” on an applied product — its area is calculated from the surface automatically.</p>
        </div>
      ) : (
        <>
          <div className="row end">
            <div className="seg sm">
              <button className={unit === 'm' ? 'on' : ''} onClick={() => setUnit('m')}>
                m²
              </button>
              <button className={unit === 'ft' ? 'on' : ''} onClick={() => setUnit('ft')}>
                ft²
              </button>
            </div>
          </div>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Area ({unit === 'm' ? 'm²' : 'ft²'})</th>
                <th>Boxes</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, p }) => {
                const r = calculate(p, c.areaM2)
                return (
                  <tr key={p.id}>
                    <td className="prod">
                      <Swatch product={p} className="mini" />
                      <div>
                        <b>{p.name}</b>
                        <small>
                          {sizeLabel(p.size)} · {c.surfaceLabel}
                        </small>
                        <small>
                          {money(p.price)}/m² · {p.piecesPerBox} pcs/box ({r.boxArea.toFixed(2)} m²)
                        </small>
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={Number(conv(c.areaM2).toFixed(2))}
                        onChange={(e) => setArea(p.id, unit === 'm' ? Number(e.target.value) : Number(e.target.value) / M2_TO_FT2)}
                      />
                    </td>
                    <td>
                      {r.boxes}
                      <small> ({r.tiles} pcs)</small>
                    </td>
                    <td>{money(r.cost)}</td>
                    <td>
                      <button className="btn sm danger" onClick={() => remove(p.id)} aria-label="Remove">
                        <Icon name="trash" size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="summary-box">
            <div>
              <span>Total area</span>
              <b>
                {conv(totals.area).toFixed(1)} {unit === 'm' ? 'm²' : 'ft²'}
              </b>
            </div>
            <div>
              <span>Boxes</span>
              <b>{totals.boxes}</b>
            </div>
            <div>
              <span>Est. weight</span>
              <b>{(totals.weight / 1000).toFixed(2)} t</b>
            </div>
            <div>
              <span>Total price</span>
              <b>{money(totals.cost)}</b>
            </div>
          </div>
          <p className="hint">Quantities include 10% waste &amp; reserve material.</p>
          <div className="row">
            <button className="btn" onClick={clear}>
              Clear cart
            </button>
            <span className="grow" />
            <button className="btn primary" onClick={() => setStep('form')}>
              Checkout / Send inquiry
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function CalculatorModal() {
  const products = useAllProducts()
  const pid = useStore((s) => s.productDetailId)
  const close = () => useStore.getState().setModal(null)
  const [mode, setMode] = useState<'area' | 'dims'>('dims')
  const [unit, setUnit] = useState<'m' | 'ft'>('m')
  const [areaIn, setAreaIn] = useState(20)
  const [wd, setWd] = useState<[number, number]>([4, 5])
  const [productId, setProductId] = useState(pid ?? products[0].id)
  const [waste, setWaste] = useState(10)
  const [grout, setGrout] = useState(2)
  const p = findProduct(productId) ?? products[0]
  const areaUnits = mode === 'area' ? areaIn : wd[0] * wd[1]
  const areaM2 = unit === 'm' ? areaUnits : areaUnits / M2_TO_FT2
  const r = calculate(p, areaM2, waste, grout)
  return (
    <Modal title="Product calculator" onClose={close} wide>
      <div className="calc">
        <div className="form">
          <div className="seg">
            <button className={mode === 'dims' ? 'on' : ''} onClick={() => setMode('dims')}>
              Use dimensions
            </button>
            <button className={mode === 'area' ? 'on' : ''} onClick={() => setMode('area')}>
              Use total area
            </button>
          </div>
          <div className="seg">
            <button className={unit === 'm' ? 'on' : ''} onClick={() => setUnit('m')}>
              Meter (m)
            </button>
            <button className={unit === 'ft' ? 'on' : ''} onClick={() => setUnit('ft')}>
              Feet (ft)
            </button>
          </div>
          {mode === 'dims' ? (
            <div className="row">
              <label>
                Width ({unit})<input type="number" min={0} step={0.1} value={wd[0]} onChange={(e) => setWd([Number(e.target.value), wd[1]])} />
              </label>
              <label>
                Length ({unit})<input type="number" min={0} step={0.1} value={wd[1]} onChange={(e) => setWd([wd[0], Number(e.target.value)])} />
              </label>
            </div>
          ) : (
            <label>
              Total area ({unit === 'm' ? 'm²' : 'ft²'})<input type="number" min={0} value={areaIn} onChange={(e) => setAreaIn(Number(e.target.value))} />
            </label>
          )}
          <label>
            Product
            <select value={p.id} onChange={(e) => setProductId(e.target.value)}>
              {products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {sizeLabel(x.size)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Waste &amp; reserve material: <b>{waste}%</b>
            <input type="range" min={0} max={25} value={waste} onChange={(e) => setWaste(Number(e.target.value))} />
          </label>
          <label>
            Grout width: <b>{grout} mm</b>
            <input type="range" min={0} max={12} step={0.5} value={grout} onChange={(e) => setGrout(Number(e.target.value))} />
          </label>
        </div>
        <div className="calc-out">
          <Swatch product={p} className="big" />
          <div className="summary-box col">
            <div>
              <span>Your area</span>
              <b>
                {areaM2.toFixed(2)} m² / {(areaM2 * M2_TO_FT2).toFixed(1)} ft²
              </b>
            </div>
            <div>
              <span>With extra material</span>
              <b>{r.areaWithWaste.toFixed(2)} m²</b>
            </div>
            <div>
              <span>Tiles needed</span>
              <b>{r.tiles} pcs</b>
            </div>
            <div>
              <span>Boxes ({p.piecesPerBox} pcs, {r.boxArea.toFixed(2)} m²)</span>
              <b>{r.boxes}</b>
            </div>
            <div>
              <span>Estimated cost</span>
              <b>{money(r.cost)}</b>
            </div>
          </div>
          <button
            className="btn primary block"
            onClick={() => {
              useStore.getState().addToCart({ productId: p.id, areaM2, surfaceLabel: 'Calculator' })
              toast(`${p.name} added to cart`)
            }}
          >
            <Icon name="cart" /> Add to cart
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function ShareModal() {
  const close = () => useStore.getState().setModal(null)
  const roomId = useStore((s) => s.roomId)
  const isPhoto = useStore((s) => s.photoRooms.some((r) => r.id === s.roomId))
  const hasCustom = useStore((s) => Object.values(s.applied).some((a) => a.kind === 'tile' && a.productId.startsWith('u-')))
  const url = useMemo(() => shareUrl(currentDesign()), [])
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'L' }).then(setQr)
  }, [url])
  const text = `Check out my ${roomName(roomId)} design`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('URL copied to clipboard!')
    } catch {
      toast('Failed to copy URL')
    }
  }
  return (
    <Modal title="Share your design" onClose={close}>
      <div className="share">
        {qr && <img src={qr} alt="QR code for this design" className="qr" />}
        <p className="hint">Scan the QR code or copy the link below.</p>
        {(isPhoto || hasCustom) && <p className="warn">Note: rooms and products you uploaded are stored only in this browser, so others will see a fallback.</p>}
        <div className="copy-row">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn primary" onClick={copy}>
            <Icon name="link" /> Copy link
          </button>
        </div>
        <div className="row center">
          <a className="btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`}>
            WhatsApp
          </a>
          <a className="btn" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}>
            Facebook
          </a>
          <a className="btn" href={`mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`}>
            Email
          </a>
          {qr && (
            <button className="btn" onClick={() => downloadDataUrl(qr, 'design-qr.png')}>
              <Icon name="qr" /> Save QR
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Before / after slider between any two snapshots. */
export function CompareModal() {
  const close = () => useStore.getState().setModal(null)
  const original = useStore((s) => s.originalShot)
  const saved = useStore((s) => s.saved)
  const catalogs = useStore((s) => s.catalogs)
  const current = useMemo(() => useStore.getState().capture?.() ?? '', [])
  const options = [
    { id: 'current', label: 'Current design', img: current },
    ...(original ? [{ id: 'original', label: 'Original room', img: original }] : []),
    ...saved.map((s) => ({ id: s.id, label: `Saved: ${s.name}`, img: s.thumb })),
    ...catalogs.map((c) => ({ id: c.id, label: `Catalog: ${c.name}`, img: c.image })),
  ]
  const [a, setA] = useState(original ? 'original' : options[1]?.id ?? 'current')
  const [b, setB] = useState('current')
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)
  const A = options.find((o) => o.id === a)
  const B = options.find((o) => o.id === b)
  const drag = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  return (
    <Modal title="Compare designs" onClose={close} wide="xl">
      <div className="row">
        <label>
          Left
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Right
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {options.length < 2 && <p className="hint">Save a design or add one to your catalog to compare against.</p>}
      <div
        className="compare"
        ref={ref}
        onMouseMove={(e) => e.buttons === 1 && drag(e.clientX)}
        onMouseDown={(e) => drag(e.clientX)}
        onTouchMove={(e) => drag(e.touches[0].clientX)}
      >
        {B && <img src={B.img} alt={B.label} />}
        {A && <img src={A.img} alt={A.label} className="clip" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />}
        <div className="handle" style={{ left: `${pos}%` }}>
          <span>⟷</span>
        </div>
        <i className="lab l">{A?.label}</i>
        <i className="lab r">{B?.label}</i>
      </div>
    </Modal>
  )
}

export function SaveModal() {
  const close = () => useStore.getState().setModal(null)
  const roomId = useStore((s) => s.roomId)
  const [name, setName] = useState(`${roomName(roomId)} design`)
  return (
    <Modal title="Save your design" onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          const s = useStore.getState()
          const thumb = s.capture?.() ?? ''
          s.saveDesign({ id: uid(), name, createdAt: Date.now(), thumb, ...structuredClone(currentDesign()) })
          toast('Design saved')
          s.setModal('saved')
        }}
      >
        <label>
          Design name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <button className="btn primary">
          <Icon name="save" /> Save
        </button>
      </form>
    </Modal>
  )
}

export function SavedModal() {
  const saved = useStore((s) => s.saved)
  const remove = useStore((s) => s.removeDesign)
  const openRoom = useStore((s) => s.openRoom)
  const close = () => useStore.getState().setModal(null)
  return (
    <Modal title="My Saved Designs" onClose={close} wide="xl">
      {!saved.length ? (
        <div className="empty big">
          <Icon name="save" size={40} />
          <p>No saved rooms found</p>
          <p className="hint">Start saving your room designs to see them here.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {saved.map((d) => (
            <div key={d.id} className="cat-card">
              <img src={d.thumb} alt={d.name} />
              <div className="cat-info">
                <b>{d.name}</b>
                <small>
                  {roomName(d.roomId)} · {new Date(d.createdAt).toLocaleString()}
                </small>
              </div>
              <div className="cat-actions">
                <button
                  className="btn sm primary"
                  onClick={() => {
                    openRoom(d.roomId, structuredClone(d.applied))
                    close()
                  }}
                >
                  Open
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(shareUrl(d)).catch(() => undefined)
                    toast('Link copied')
                  }}
                >
                  Copy link
                </button>
                <button className="btn sm danger" onClick={() => remove(d.id)} aria-label="Delete">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function ProductModal() {
  const id = useStore((s) => s.productDetailId)
  const all = useAllProducts()
  const selected = useStore((s) => s.selected)
  const roomId = useStore((s) => s.roomId)
  const photoRooms = useStore((s) => s.photoRooms)
  const close = () => useStore.getState().showProduct(null)
  const p = id ? findProduct(id) : undefined
  useEffect(() => {
    if (p) useStore.getState().pushHistory(p.id)
  }, [p])
  if (!p) return null
  const variants = all.filter((x) => x.name === p.name)
  const surfaces = surfacesForRoom(roomId, photoRooms)
  // area where this product is applied; otherwise the currently selected surfaces
  const appliedHere = surfaces.filter((s) => { const a = useStore.getState().applied[s.id]; return a?.kind === 'tile' && a.productId === p.id })
  const areaSurfaces = appliedHere.length ? appliedHere : surfaces.filter((s) => selected.includes(s.id))
  const area = areaSurfaces.reduce((sum, s) => sum + s.size[0] * s.size[1], 0)
  const r = calculate(p, area || 10)
  return (
    <Modal title="Product details" onClose={close} wide>
      <div className="pdetail">
        <Swatch product={p} className="big" />
        <div>
          <h2>{p.name}</h2>
          <p className="sku">SKU {p.sku}</p>
          <p className="price">
            {money(p.price)} <small>/ m²</small>
          </p>
          <p>{p.description}</p>
          {variants.length > 1 && (
            <>
              <label className="lbl">Available in</label>
              <div className="chips">
                {variants.map((v) => (
                  <button key={v.id} className={v.id === p.id ? 'on' : ''} onClick={() => useStore.getState().showProduct(v.id)}>
                    {sizeLabel(v.size)}
                  </button>
                ))}
              </div>
            </>
          )}
          <table className="specs">
            <tbody>
              <tr>
                <td>Material</td>
                <td>{p.material}</td>
              </tr>
              <tr>
                <td>Size</td>
                <td>{sizeLabel(p.size)}</td>
              </tr>
              <tr>
                <td>Thickness</td>
                <td>{p.thicknessMm} mm</td>
              </tr>
              <tr>
                <td>Finish</td>
                <td>{p.finish === 'glossy' ? 'Glossy' : 'Matt'}</td>
              </tr>
              <tr>
                <td>Colour</td>
                <td>{p.color}</td>
              </tr>
              <tr>
                <td>Application</td>
                <td>{p.application.map((a) => a[0].toUpperCase() + a.slice(1)).join(', ')}</td>
              </tr>
              <tr>
                <td>Pack size</td>
                <td>{p.piecesPerBox} pcs / box</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            {area ? `${appliedHere.length ? 'Applied area' : 'Selected surfaces'}: ${area.toFixed(1)} m² → ` : 'For 10 m² → '}
            {r.boxes} boxes ({r.tiles} pcs) · {money(r.cost)}
          </p>
          <div className="row wrap">
            <button
              className="btn primary"
              onClick={() => {
                applyProduct(p)
                close()
              }}
            >
              <Icon name="check" /> Visualize in room
            </button>
            <button
              className="btn"
              onClick={() => {
                const s = useStore.getState()
                const labels = areaSurfaces.map((x) => x.label)
                s.addToCart({ productId: p.id, areaM2: area || 10, surfaceLabel: labels.join(', ') || 'Manual' })
                toast(`${p.name} added to cart`)
              }}
            >
              <Icon name="cart" /> Add to cart
            </button>
            <button className="btn" onClick={() => useStore.getState().setModal('calculator')}>
              <Icon name="calc" /> Calculator
            </button>
            <button className="btn" onClick={() => downloadProductPdf(p)}>
              <Icon name="pdf" /> Details PDF
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function SummaryModal() {
  const close = () => useStore.getState().setModal(null)
  const roomId = useStore((s) => s.roomId)
  const applied = useStore((s) => s.applied)
  const lines = designLines({ roomId, applied })
  const total = lines.reduce((s, l) => s + ('calc' in l ? l.calc.cost : 0), 0)
  return (
    <Modal
      title="Summary of selection"
      onClose={close}
      wide
      footer={
        <>
          <b>Estimated total: {money(total)}</b>
          <span className="grow" />
          <button
            className="btn"
            onClick={() => {
              const s = useStore.getState()
              for (const l of lines) if ('product' in l) s.addToCart({ productId: l.product.id, areaM2: l.area, surfaceLabel: l.surface.label })
              toast('All tiles added to cart')
            }}
          >
            <Icon name="cart" /> Add all to cart
          </button>
          <button className="btn primary" onClick={addCurrentToCatalog}>
            <Icon name="book" /> Add to catalog
          </button>
        </>
      }
    >
      <table className="cart-table">
        <thead>
          <tr>
            <th>Surface</th>
            <th>Product</th>
            <th>Layout</th>
            <th>Area</th>
            <th>Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.surface.id}>
              <td>{l.surface.label}</td>
              <td className="prod">
                {'product' in l ? <Swatch product={l.product} className="mini" /> : <i className="mini-paint" style={{ background: l.paint.hex }} />}
                <div>
                  <b>{'product' in l ? l.product.name : l.paint.name}</b>
                  <small>{'product' in l ? `${sizeLabel(l.product.size)} · ${l.settings.finish}` : `Paint ${l.paint.hex}`}</small>
                </div>
              </td>
              <td>{'settings' in l ? `${LAYOUTS.find((x) => x.id === l.settings.layout)?.label}, ${l.settings.rotation}°, grout ${l.settings.groutMm}mm` : '—'}</td>
              <td>{l.area.toFixed(1)} m²</td>
              <td>{'calc' in l ? `${l.calc.boxes} boxes` : '—'}</td>
              <td>{'calc' in l ? money(l.calc.cost) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

export function UploadTileModal() {
  const close = () => useStore.getState().setModal(null)
  const add = useStore((s) => s.addCustomProduct)
  const [img, setImg] = useState<string | null>(null)
  const [name, setName] = useState('My tile')
  const [size, setSize] = useState<[number, number]>([60, 60])
  const [finish, setFinish] = useState<'glossy' | 'matt'>('matt')
  const onFile = (f?: File) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      // downscale to keep storage small
      const im = new Image()
      im.src = reader.result as string
      await im.decode()
      const k = Math.min(1, 800 / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * k)
      c.height = Math.round(im.height * k)
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      setImg(c.toDataURL('image/jpeg', 0.88))
      setName(f.name.replace(/\.[^.]+$/, '').slice(0, 40))
    }
    reader.readAsDataURL(f)
  }
  return (
    <Modal title="Upload your product" onClose={close} wide>
      <div className="upload-tile">
        <label
          className={`drop${img ? ' has' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onFile(e.dataTransfer.files[0])
          }}
        >
          {img ? <img src={img} alt="preview" /> : <span>Drag &amp; drop an image here, or click to choose</span>}
          <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div className="form">
          <p className="hint">The image should only cover the area within the tile — crop off any background.</p>
          <label>
            Name<input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>Size (cm)</label>
          <div className="chips">
            {([[30, 30], [30, 60], [60, 60], [60, 120], [80, 80], [20, 120]] as [number, number][]).map((s) => (
              <button key={s.join()} className={size.join() === s.join() ? 'on' : ''} onClick={() => setSize(s)}>
                {sizeLabel(s)}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              Width<input type="number" min={2} value={size[0]} onChange={(e) => setSize([Number(e.target.value), size[1]])} />
            </label>
            <label>
              Height<input type="number" min={2} value={size[1]} onChange={(e) => setSize([size[0], Number(e.target.value)])} />
            </label>
          </div>
          <div className="seg">
            {(['matt', 'glossy'] as const).map((f) => (
              <button key={f} className={finish === f ? 'on' : ''} onClick={() => setFinish(f)}>
                {f === 'glossy' ? 'Glossy' : 'Matt'}
              </button>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!img}
            onClick={() => {
              const p: Product = {
                id: `u-${uid()}`,
                name,
                sku: `MY-${Date.now().toString(36).toUpperCase()}`,
                material: 'Custom',
                color: 'Multi',
                finish,
                size,
                application: ['floor', 'wall', 'countertop', 'backsplash'],
                price: 0,
                piecesPerBox: Math.max(1, Math.round(1.44 / ((size[0] * size[1]) / 10000))),
                thicknessMm: 9,
                art: { kind: 'image', base: '#ccc', accent: '#aaa', imageUrl: img! },
                createdAt: Date.now(),
                description: 'Your uploaded product.',
                custom: true,
              }
              add(p)
              applyProduct(p)
              close()
              toast('Product uploaded and applied')
            }}
          >
            <Icon name="upload" /> Add &amp; apply
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function InquiryModal() {
  const close = () => useStore.getState().setModal(null)
  const roomId = useStore((s) => s.roomId)
  const applied = useStore((s) => s.applied)
  const [sent, setSent] = useState(false)
  const lines = designLines({ roomId, applied })
  return (
    <Modal title="We would love to hear from you!" onClose={close}>
      {sent ? (
        <div className="empty big">
          <Icon name="check" size={40} />
          <p>Thank you! Your email app has opened with the inquiry.</p>
          <button className="btn primary" onClick={close}>
            Back to visualiser
          </button>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const body = [`Name: ${f.get('name')}`, `Phone / WhatsApp: ${f.get('phone')}`, `Email: ${f.get('email')}`, '', `${f.get('msg')}`, '', `Design: ${shareUrl({ roomId, applied })}`, ...lines.map((l) => `${l.surface.label}: ${'product' in l ? `${l.product.name} (${l.product.sku})` : `Paint ${l.paint.name}`}`)].join('\n')
            location.href = `mailto:?subject=${encodeURIComponent('Inquiry from the visualiser')}&body=${encodeURIComponent(body)}`
            setSent(true)
          }}
        >
          <label>
            Full name<input name="name" required />
          </label>
          <label>
            Phone / WhatsApp<input name="phone" inputMode="tel" />
          </label>
          <label>
            Email<input name="email" type="email" />
          </label>
          <label>
            Message<textarea name="msg" rows={3} defaultValue="I'm interested in the products in this design." />
          </label>
          <p className="hint">Your current design link and applied products are attached automatically.</p>
          <button className="btn primary">Send inquiry</button>
        </form>
      )}
    </Modal>
  )
}

export function RateModal() {
  const close = () => useStore.getState().setModal(null)
  const [stars, setStars] = useState(0)
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  return (
    <Modal title="Rate your experience" onClose={close}>
      {done ? (
        <div className="empty big">
          <Icon name="heart" size={40} />
          <p>Thanks for your feedback.</p>
        </div>
      ) : (
        <div className="form">
          <div className="stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
                ★
              </button>
            ))}
          </div>
          <label>
            How can we improve your experience?
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your review here..." />
          </label>
          <button
            className="btn primary"
            disabled={!stars}
            onClick={() => {
              useStore.getState().addFeedback({ stars, text, at: Date.now() })
              setDone(true)
            }}
          >
            Submit
          </button>
        </div>
      )}
    </Modal>
  )
}

export function ModalHost() {
  const modal = useStore((s) => s.modal)
  switch (modal) {
    case 'inquiry':
      return <InquiryModal />
    case 'rate':
      return <RateModal />
    case 'catalog':
      return <CatalogModal />
    case 'cart':
      return <CartModal />
    case 'calculator':
      return <CalculatorModal />
    case 'share':
      return <ShareModal />
    case 'compare':
      return <CompareModal />
    case 'save':
      return <SaveModal />
    case 'saved':
      return <SavedModal />
    case 'product':
      return <ProductModal />
    case 'summary':
      return <SummaryModal />
    case 'uploadTile':
      return <UploadTileModal />
    case 'uploadRoom':
      return <UploadRoomModal />
    default:
      return null
  }
}
