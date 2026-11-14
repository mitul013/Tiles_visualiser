import { useEffect, useState } from 'react'
import { surfacesForRoom, useStore } from './store'
import { demoRooms, ensureLibraryRoom, ensureLibraryRoomById, loadLibrary } from './lib/library'
import { readDesignFromHash } from './lib/share'
import { getRoom, ROOMS } from './data/rooms'
import { PRODUCTS } from './data/products'
import { LAYOUTS } from './lib/layout'
import { applyProduct } from './components/ProductPanel'
import type { Lang } from './lib/i18n'
import Visualizer from './components/Visualizer'
import { ModalHost } from './components/Modals'
import { BrandMark, Icon } from './components/ui'
import { brand, contactLines } from './lib/brand'

const base = import.meta.env.BASE_URL

const FEATURES: [string, string, string][] = [
  ['grid', 'Photo-real demo rooms', 'Living rooms, kitchens, bedrooms and bathrooms, each measured so tiles show at their real size.'],
  ['upload', 'Your own room', 'Upload a photo: floor, walls and furniture are found automatically, tiles follow the perspective and light.'],
  ['layers', 'Layouts & grout', 'Grid, brick, herringbone, diagonal, quarter-turn… plus grout width, colour and finish.'],
  ['whatsapp', 'Share on WhatsApp', 'Send a design or the whole catalogue PDF to family, or straight to the shop for a quote.'],
  ['book', 'Catalogs & PDF', 'Collect designs into catalogs and download them as one PDF with QR codes.'],
  ['calc', 'Calculator & cart', 'Areas are measured for you — get boxes, pieces and cost, then send an inquiry.'],
]

export default function App() {
  const open = useStore((s) => s.open)
  const setOpen = useStore((s) => s.setOpen)
  const openRoom = useStore((s) => s.openRoom)
  const modal = useStore((s) => s.modal)
  const [demoCount, setDemoCount] = useState(0)
  useEffect(() => {
    void loadLibrary().then((r) => setDemoCount(demoRooms(r).length))
  }, [])
  /** the hero picture is a design in the first demo room (public/hero.json) */
  const openHero = async () => {
    const [rooms, hero] = await Promise.all([
      loadLibrary(),
      fetch(`${base}hero.json`)
        .then((r) => r.json())
        .catch(() => null),
    ])
    const room = rooms.find((r) => r.id === hero?.roomId) ?? demoRooms(rooms)[0]
    if (!room) return setOpen(true)
    ensureLibraryRoom(room)
    openRoom(room.id, hero?.roomId === room.id ? hero.applied : {})
  }

  // Open a shared design (#design=...) or the visualiser directly (?visualizer)
  useEffect(() => {
    const load = async () => {
      const q = new URLSearchParams(location.search)
      const lang = q.get('lang')
      if (lang && ['en', 'es', 'fr', 'de', 'hi'].includes(lang)) useStore.getState().setLang(lang as Lang)
      const d = readDesignFromHash()
      // designs on demo rooms open on any device: the room comes from the library
      if (d) await ensureLibraryRoomById(d.roomId)
      if (d && (getRoom(d.roomId) || useStore.getState().photoRooms.some((r) => r.id === d.roomId))) return openRoom(d.roomId, d.applied)
      if (d) return setOpen(true)
      // embed / deep-link parameters (see src/lib/host.ts)
      const roomParam = q.get('room')
      const productParam = q.get('product')
      const product = productParam ? [...PRODUCTS, ...useStore.getState().customProducts].find((p) => p.id === productParam || p.sku === productParam) : undefined
      if (roomParam) await ensureLibraryRoomById(roomParam)
      if (roomParam && (getRoom(roomParam) || useStore.getState().photoRooms.some((r) => r.id === roomParam))) openRoom(roomParam)
      else if (product && q.get('view') !== 'rooms') {
        // the first demo room with a surface this product is made for
        const demo = demoRooms(await loadLibrary()).find((r) => r.surfaces.some((sf) => product.application.includes(sf.type)))
        if (demo) {
          ensureLibraryRoom(demo)
          openRoom(demo.id)
        } else openRoom(ROOMS.find((r) => r.surfaces.some((sf) => product.application.includes(sf.type)))?.id ?? 'living')
      } else if (q.has('visualizer') || q.has('view') || productParam) setOpen(true)
      if (product && useStore.getState().view === 'visualizer') {
        const st = useStore.getState()
        const wanted = q.get('surface')
        const surfaces = surfacesForRoom(st.roomId, st.photoRooms).filter((sf) => product.application.includes(sf.type) && (!wanted || sf.type === wanted))
        const ids = surfaces.filter((sf) => sf.type === (wanted ?? surfaces[0]?.type)).map((sf) => sf.id)
        if (ids.length) {
          st.select(ids)
          applyProduct(product)
        }
      }
    }
    if (useStore.persist.hasHydrated()) void load()
    else return useStore.persist.onFinishHydration(() => void load())
  }, [openRoom, setOpen])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
  }, [open])

  const close = () => {
    setOpen(false)
    if (location.hash) history.replaceState(null, '', location.pathname + location.search)
  }

  return (
    <>
      <div className="landing">
        <nav className="nav">
          <BrandMark />
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <button className="btn primary" onClick={() => setOpen(true)}>
              Try Our Visualizer
            </button>
          </div>
        </nav>
        <section className="hero">
          <div className="hero-text">
            <h1>
              See your tiles <span>in the room</span> before you buy
            </h1>
            <p>Pick a room, choose the floor or walls, and apply tiles or paint in one click. Change layouts and grout, compare looks, then save it all into a catalog you can share.</p>
            <div className="row">
              <button className="btn primary lg" onClick={() => setOpen(true)}>
                Try Our Visualizer
              </button>
              <button className="btn lg" onClick={() => (setOpen(true), useStore.getState().setModal('uploadRoom'))}>
                <Icon name="upload" /> Upload your room
              </button>
            </div>
            <div className="stats">
              <div>
                <b>{PRODUCTS.length}+</b>
                <span>tile products</span>
              </div>
              <div>
                <b>{LAYOUTS.length}</b>
                <span>layouts</span>
              </div>
              <div>
                <b>{demoCount || 5}</b>
                <span>demo rooms</span>
              </div>
            </div>
          </div>
          <button className="hero-img" onClick={openHero} aria-label="Open this demo room">
            <img src={`${base}hero.webp`} alt="Living room with a marble floor, designed in the visualiser" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <span className="play">Open this room →</span>
          </button>
        </section>
        <section className="features" id="features">
          <h2>Everything you need to choose tiles with confidence</h2>
          <div className="feat-grid">
            {FEATURES.map(([i, t, d]) => (
              <div key={t} className="feat">
                <Icon name={i} size={26} />
                <b>{t}</b>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="how" id="how">
          <h2>How it works</h2>
          <ol>
            <li>
              <b>Select a room</b> — a photo-real demo room, or upload a picture of your own.
            </li>
            <li>
              <b>Choose a surface</b> — floor, walls, counter top or backsplash (click it in the room).
            </li>
            <li>
              <b>Apply tiles or colours</b> from the left panel; tune layout, rotation and grout.
            </li>
            <li>
              <b>Save, compare &amp; share</b> — add designs to your catalog, download a PDF or share a QR link.
            </li>
          </ol>
          <button className="btn primary lg" onClick={() => setOpen(true)}>
            Start designing
          </button>
        </section>
        <footer className="foot">
          {brand.name}
          {contactLines().length ? ` · ${contactLines().join(' · ')}` : ''}
        </footer>
      </div>

      {open && (
        <div className="viz-modal">
          <Visualizer onClose={close} />
        </div>
      )}
      {modal && <ModalHost />}
    </>
  )
}
