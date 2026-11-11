import { useState } from 'react'
import { ROOM_CATEGORIES, ROOMS } from '../data/rooms'
import { useStore } from '../store'
import { Icon } from './ui'

const base = import.meta.env.BASE_URL

export default function RoomSelect() {
  const openRoom = useStore((s) => s.openRoom)
  const setModal = useStore((s) => s.setModal)
  const photoRooms = useStore((s) => s.photoRooms)
  const removePhoto = useStore((s) => s.removePhotoRoom)
  const saved = useStore((s) => s.saved)
  const [cat, setCat] = useState('All')

  const openPanorama = (id: string) => {
    openRoom(id)
    useStore.setState({ panorama: true })
  }

  return (
    <div className="room-select">
      <h1>
        Select a room for <span>transformation</span>
      </h1>
      <div className="tips">
        <button className="tip" onClick={() => setModal('uploadRoom')}>
          <Icon name="upload" size={26} />
          <div>
            <b>Upload a picture of your room</b>
            <small>Try our products in your own space</small>
          </div>
        </button>
        <a className="tip" href="#demo-rooms">
          <Icon name="grid" size={26} />
          <div>
            <b>No picture? Try our demo rooms</b>
            <small>Choose a demo room to try products now</small>
          </div>
        </a>
        <button className="tip" onClick={() => openPanorama('living')}>
          <Icon name="pano" size={26} />
          <div>
            <b>Step into a 360° panorama</b>
            <small>Look all around a room you design</small>
          </div>
        </button>
      </div>

      {photoRooms.length > 0 && (
        <section>
          <h2>My Rooms</h2>
          <div className="room-grid">
            {photoRooms.map((r) => (
              <div key={r.id} className="room-card" onClick={() => openRoom(r.id, {})}>
                <img src={r.image} alt={r.name} />
                <div className="rc-foot">
                  <b>{r.name}</b>
                  <button
                    className="btn sm danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      removePhoto(r.id)
                    }}
                    aria-label="Delete room"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="demo-rooms">
        <div className="sec-head">
          <h2>Demo rooms</h2>
          <div className="chips">
            {ROOM_CATEGORIES.map((c) => (
              <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="room-grid">
          {ROOMS.filter((r) => cat === 'All' || r.category === cat).map((r) => (
            <div key={r.id} className="room-card" onClick={() => openRoom(r.id)}>
              <img src={`${base}rooms/${r.id}.jpg`} alt={r.name} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <span className="rc-cat">{r.category}</span>
              <button
                className="rc-pano"
                title="Open in 360°"
                onClick={(e) => {
                  e.stopPropagation()
                  openPanorama(r.id)
                }}
              >
                360°
              </button>
              <div className="rc-foot">
                <b>{r.name}</b>
                <small>
                  {r.surfaces.length} surfaces · {r.dims.w}×{r.dims.d} m
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>

      {saved.length > 0 && (
        <section>
          <div className="sec-head">
            <h2>My Saved Designs</h2>
            <button className="btn sm" onClick={() => setModal('saved')}>
              View all
            </button>
          </div>
          <div className="room-grid small">
            {saved.slice(0, 4).map((d) => (
              <div key={d.id} className="room-card" onClick={() => openRoom(d.roomId, structuredClone(d.applied))}>
                <img src={d.thumb} alt={d.name} />
                <div className="rc-foot">
                  <b>{d.name}</b>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
