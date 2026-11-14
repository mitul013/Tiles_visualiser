import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './ui'
import { useT } from '../lib/i18n'
import { demoRooms, ensureLibraryRoom, libraryThumb, loadLibrary, type LibraryRoom } from '../lib/library'

const TYPE_COUNT = (r: LibraryRoom) => {
  const n = (t: string) => r.surfaces.filter((s) => s.type === t).length
  const walls = n('wall')
  return [n('floor') && 'Floor', walls && (walls > 1 ? `${walls} walls` : 'Wall'), n('backsplash') && 'Backsplash', n('ceiling') && 'Ceiling'].filter(Boolean).join(' · ')
}

export default function RoomSelect() {
  const t = useT()
  const openRoom = useStore((s) => s.openRoom)
  const setModal = useStore((s) => s.setModal)
  const photoRooms = useStore((s) => s.photoRooms)
  const removePhoto = useStore((s) => s.removePhotoRoom)
  const saved = useStore((s) => s.saved)
  const [cat, setCat] = useState('All')
  const [demos, setDemos] = useState<LibraryRoom[] | null>(null)
  useEffect(() => {
    void loadLibrary().then((rooms) => setDemos(demoRooms(rooms)))
  }, [])
  const categories = ['All', ...((demos ?? []).some((r) => r.pano) ? ['360°'] : []), ...new Set((demos ?? []).map((r) => r.category))]
  const myRooms = photoRooms.filter((r) => !r.id.startsWith('lib-'))
  const openDemo = (r: LibraryRoom) => {
    ensureLibraryRoom(r)
    openRoom(r.id, {})
  }

  return (
    <div className="room-select">
      <h1>
        {t('Select a room for')} <span>{t('transformation')}</span>
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
        <div className="tip">
          <Icon name="check" size={26} />
          <div>
            <b>True to size</b>
            <small>Every room is measured, so tiles show at their real size</small>
          </div>
        </div>
      </div>

      {myRooms.length > 0 && (
        <section>
          <h2>My Rooms</h2>
          <div className="room-grid">
            {myRooms.map((r) => (
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
          <h2>{t('Demo rooms')}</h2>
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="room-grid">
          {demos === null && <p className="hint">Loading rooms…</p>}
          {demos
            ?.filter((r) => cat === 'All' || r.category === cat || (cat === '360°' && r.pano))
            .map((r) => (
              <div key={r.id} className="room-card" onClick={() => openDemo(r)}>
                <img src={libraryThumb(r)} alt={r.name} loading="lazy" />
                <span className="rc-cat">{r.category}</span>
                {r.pano && <span className="rc-360">360°</span>}
                <div className="rc-foot">
                  <b>{r.name}</b>
                  <small>{TYPE_COUNT(r)}</small>
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
