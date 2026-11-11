import { lazy, Suspense, useEffect, useState } from 'react'
import { getRoom } from '../data/rooms'
import { useStore } from '../store'

const Scene3D = lazy(() => import('./Scene3D'))

/** `?thumb=<roomId>` renders a bare room; used by scripts/thumbnails.mjs to build room preview images. */
export const readThumbRequest = () => new URLSearchParams(location.search).get('thumb')

export function ThumbRenderer({ roomId }: { roomId: string }) {
  const room = getRoom(roomId)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    useStore.getState().openRoom(roomId)
    useStore.setState({ selected: [] })
    setReady(true)
  }, [roomId])
  if (!room || !ready) return null
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Suspense fallback={null}>
        <Scene3D room={room} />
      </Suspense>
    </div>
  )
}
