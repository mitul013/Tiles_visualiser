import { useEffect } from 'react'
import { useStore } from './store'
import { readDesignFromHash } from './lib/share'
import { getRoom } from './data/rooms'
import Visualizer from './components/Visualizer'
import { ModalHost } from './components/Modals'
import { Icon } from './components/ui'

const base = import.meta.env.BASE_URL

const FEATURES: [string, string, string][] = [
  ['grid', 'Demo rooms', 'Living rooms, kitchens, bathrooms, bedrooms, patios and lobbies — ready to design.'],
  ['upload', 'Your own room', 'Upload a photo, mark the floor and walls, and preview tiles in perspective with real lighting.'],
  ['layers', 'Layouts & grout', 'Grid, brick, herringbone, diagonal, quarter-turn… plus grout width, colour and finish.'],
  ['pano', '360° panorama', 'Step inside any demo room and look all around your design.'],
  ['book', 'Catalogs & PDF', 'Collect designs into catalogs and download them as one PDF with QR codes.'],
  ['calc', 'Calculator & cart', 'Areas are measured for you — get boxes, pieces and cost, then send an inquiry.'],
]

export default function App() {
  const open = useStore((s) => s.open)
  const setOpen = useStore((s) => s.setOpen)
  const openRoom = useStore((s) => s.openRoom)
  const modal = useStore((s) => s.modal)

  // Open a shared design (#design=...) or the visualiser directly (?visualizer)
  useEffect(() => {
    const load = () => {
      const d = readDesignFromHash()
      if (d && (getRoom(d.roomId) || useStore.getState().photoRooms.some((r) => r.id === d.roomId))) openRoom(d.roomId, d.applied)
      else if (d) openRoom('living')
      else if (/[?&]visualizer\b/.test(location.search)) setOpen(true)
    }
    if (useStore.persist.hasHydrated()) load()
    else return useStore.persist.onFinishHydration(load)
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
          <div className="brand">
            <span className="logo">
              <Icon name="grid" size={18} />
            </span>
            Tiles Visualiser
          </div>
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
                <b>130+</b>
                <span>tile products</span>
              </div>
              <div>
                <b>7</b>
                <span>layouts</span>
              </div>
              <div>
                <b>6</b>
                <span>demo rooms</span>
              </div>
            </div>
          </div>
          <button className="hero-img" onClick={() => openRoom('kitchen')} aria-label="Open the kitchen demo">
            <img src={`${base}rooms/kitchen.jpg`} alt="Kitchen designed in the visualiser" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
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
              <b>Select a room</b> — a demo room, a 360° room, or upload a picture of your own.
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
        <footer className="foot">Tiles Visualiser · a React + three.js demo · runs entirely in your browser</footer>
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
