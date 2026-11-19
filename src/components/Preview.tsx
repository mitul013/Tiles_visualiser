import { useEffect, useState } from 'react'
import { enterLandscape, exitLandscape, useViewport } from '../lib/fullscreen'
import { Icon } from './ui'

/**
 * Full-screen preview of the designed room, on any device. A landscape room on a phone held
 * upright is turned sideways so it fills the screen (see lib/fullscreen).
 */
export default function Preview({ src, onClose }: { src: string; onClose: () => void }) {
  const vp = useViewport()
  const [wide, setWide] = useState(true)
  const [bars, setBars] = useState(true)
  useEffect(() => {
    let alive = true
    const im = new Image()
    im.onload = () => {
      if (!alive) return
      const landscape = im.naturalWidth > im.naturalHeight
      setWide(landscape)
      void enterLandscape(landscape)
    }
    im.src = src
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => {
      alive = false
      window.removeEventListener('keydown', key)
      exitLandscape()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  // turn the picture ourselves while the screen is still upright (if the device rotates, the
  // viewport becomes landscape and this switches off on its own)
  const rot = wide && vp.h > vp.w
  return (
    <div className={`preview${rot ? ' rot' : ''}`} role="dialog" aria-label="Room preview" onClick={() => setBars(!bars)}>
      <img src={src} alt="Your room with the selected tiles" draggable={false} />
      {bars && (
        <button
          className="preview-close"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="Close preview"
        >
          <Icon name="close" /> Close
        </button>
      )}
    </div>
  )
}
