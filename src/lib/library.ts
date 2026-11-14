/**
 * The room library (public/library/manifest.json): ready-made photo rooms used as demo rooms.
 * Two kinds of entry:
 * - photo + furniture mask (objMask) + detected surfaces (scripts/library-photos.cjs): light maps are
 *   generated from the photo, as for an uploaded room. These are the demo rooms.
 * - photo + prepared matt / glossy cut-outs (scripts/library.cjs or hand-made)
 */
import { useStore, type PhotoSurface } from '../store'

export interface LibraryRoom {
  id: string
  name: string
  category: string
  width: number
  height: number
  original: string
  /** small preview for room cards (falls back to the photo) */
  thumb?: string
  objMask?: string
  matt?: string
  glossy?: string
  surfaces: PhotoSurface[]
}

const url = (f: string) => `${import.meta.env.BASE_URL}${f}`
export const libraryThumb = (r: LibraryRoom) => url(r.thumb ?? r.original)

let cache: Promise<LibraryRoom[]> | null = null
export function loadLibrary(): Promise<LibraryRoom[]> {
  cache ??= fetch(url('library/manifest.json'))
    .then((r) => r.json())
    .then((m: { rooms: LibraryRoom[] }) => m.rooms)
    .catch(() => {
      cache = null
      return []
    })
  return cache
}

/** the photo-real demo rooms, in manifest order */
export const demoRooms = (rooms: LibraryRoom[]) => rooms.filter((r) => r.objMask)

const flat = (color: string) => {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const x = c.getContext('2d')!
  x.fillStyle = color
  x.fillRect(0, 0, 2, 2)
  return c.toDataURL('image/png')
}

/** Put a library room into the store (a copy saved earlier keeps its designs and takes the current surfaces). */
export function ensureLibraryRoom(r: LibraryRoom) {
  const st = useStore.getState()
  if (st.photoRooms.some((x) => x.id === r.id)) {
    st.updatePhotoRoom(r.id, {
      surfaces: r.surfaces,
      ...(r.objMask ? { objMask: url(r.objMask) } : {}),
    })
    return
  }
  st.addPhotoRoom({
    id: r.id,
    name: r.name,
    image: url(r.original),
    width: r.width,
    height: r.height,
    surfaces: r.surfaces,
    ...(r.objMask
      ? { objMask: url(r.objMask), auto: true }
      : // the cut-out's own semi-transparent pixels light the tiles: generated light maps stay neutral
        {
          layers: {
            cutout: url(r.matt!),
            cutoutGlossy: r.glossy ? url(r.glossy) : undefined,
            shadow: flat('#ffffff'),
            reflection: flat('#ffffff'),
            highlight: flat('#000000'),
            source: 'uploaded' as const,
          },
        }),
    createdAt: Date.now(),
  })
}

/** Load the library room with this id into the store, if there is one (for shared links). */
export async function ensureLibraryRoomById(id: string) {
  if (!id.startsWith('lib-')) return false
  const r = (await loadLibrary()).find((x) => x.id === id)
  if (r) ensureLibraryRoom(r)
  return !!r
}
