import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import type { Application, CartItem, CatalogEntry, Design, LightTheme, Product, SavedDesign, SurfaceType } from './types'
import { getRoom } from './data/rooms'
import { surfaceAreaM2, type Pt } from './lib/homography'
import { PRODUCTS } from './data/products'
import { PAINTS } from './data/paints'

/** A room created from the user's own photo. Quads are in normalised image coords (0..1). */
export interface PhotoSurface {
  id: string
  label: string
  type: SurfaceType
  /** perspective guide: any real-world rectangle on this surface (TL, TR, BR, BL), normalised */
  quad: [number, number][]
  /**
   * where tiles go (normalised polygon, may extend past the photo edge). The plane defined by the
   * guide is extended to cover it. Omitted = the guide quad itself (or the room's cut-out).
   */
  area?: [number, number][]
  size: [number, number]
  /** share of the area taken by windows / doors (from automatic detection), not tiled */
  openings?: number
}
export interface PhotoRoom {
  id: string
  name: string
  image: string
  width: number
  height: number
  surfaces: PhotoSurface[]
  /**
   * Foreground-object layer: PNG (same size as the photo) whose opaque pixels mark objects that
   * stand in front of the surfaces (furniture, taps, plants, window frames). Those photo pixels are
   * composited back on top of the tiles, so new tiles never cover them.
   */
  objMask?: string
  /** cut-out overlays (matt / glossy): transparent where tiles go, shadows baked in */
  layers?: import('./lib/roomLayers').RoomLayers
  /** surfaces and object layer came from automatic room detection */
  auto?: boolean
  /** detected class of every pixel (low resolution): lets the editor remove one whole object */
  objClasses?: import('./lib/detect').ObjClasses
  createdAt: number
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await get(name)) ?? null,
  setItem: async (name, value) => set(name, value),
  removeItem: async (name) => del(name),
}

export type View = 'rooms' | 'visualizer'
export type Modal = null | 'inquiry' | 'rate' | 'catalog' | 'cart' | 'calculator' | 'share' | 'compare' | 'saved' | 'uploadTile' | 'uploadRoom' | 'product' | 'summary' | 'save'

interface State {
  open: boolean
  view: View
  roomId: string
  applied: Record<string, Application>
  past: Record<string, Application>[]
  future: Record<string, Application>[]
  selected: string[]
  modal: Modal
  productDetailId: string | null
  theme: LightTheme
  dark: boolean
  panorama: boolean
  customProducts: Product[]
  photoRooms: PhotoRoom[]
  catalogs: CatalogEntry[]
  saved: SavedDesign[]
  cart: CartItem[]
  history: string[]
  originalShot: string | null
  /** set by the active scene: returns a JPEG of the current view */
  capture: ((hd?: boolean) => string) | null
  lang: import('./lib/i18n').Lang
  feedback: { stars: number; text: string; at: number }[]
  setLang: (l: import('./lib/i18n').Lang) => void
  addFeedback: (f: { stars: number; text: string; at: number }) => void

  setOpen: (o: boolean) => void
  openRoom: (roomId: string, applied?: Record<string, Application>) => void
  backToRooms: () => void
  select: (ids: string[]) => void
  apply: (ids: string[], app: Application | ((prev: Application | undefined, id: string) => Application)) => void
  setApplied: (a: Record<string, Application>) => void
  undo: () => void
  redo: () => void
  reset: () => void
  setModal: (m: Modal) => void
  showProduct: (id: string | null) => void
  setTheme: (t: LightTheme) => void
  toggleDark: () => void
  togglePanorama: () => void
  addCustomProduct: (p: Product) => void
  removeCustomProduct: (id: string) => void
  addPhotoRoom: (r: PhotoRoom) => void
  /** update a photo room in place (surfaces edited from the visualiser) */
  updatePhotoRoom: (id: string, patch: Partial<PhotoRoom>) => void
  /** photo room open in the surface editor (null = editor creates a new room) */
  editingRoomId: string | null
  editSurfaces: (id: string | null) => void
  removePhotoRoom: (id: string) => void
  addCatalog: (c: CatalogEntry) => void
  removeCatalog: (id: string) => void
  saveDesign: (d: SavedDesign) => void
  removeDesign: (id: string) => void
  addToCart: (i: CartItem) => void
  removeFromCart: (productId: string) => void
  setCartArea: (productId: string, area: number) => void
  clearCart: () => void
  pushHistory: (id: string) => void
  setOriginalShot: (s: string | null) => void
  setCapture: (f: State['capture']) => void
}

/**
 * Surfaces of a room with their real area in m² (3D rooms: the modelled size; photo rooms: the
 * outline measured on the plane through the perspective guide, see surfaceAreaM2).
 */
export const surfacesForRoom = (roomId: string, photoRooms: PhotoRoom[]) => {
  const r = getRoom(roomId)
  if (r) return r.surfaces.map((s) => ({ id: s.id, label: s.label, type: s.type, size: s.size, area: s.size[0] * s.size[1] }))
  const p = photoRooms.find((x) => x.id === roomId)
  return p
    ? p.surfaces.map((s) => ({ id: s.id, label: s.label, type: s.type, size: s.size, area: ((s.area && surfaceAreaM2(s.quad as Pt[], s.area as Pt[], s.size)) || s.size[0] * s.size[1]) * (1 - (s.openings ?? 0)) }))
    : []
}

export const useStore = create<State>()(
  persist(
    (setS, getS) => ({
      open: false,
      view: 'rooms',
      roomId: 'living',
      applied: {},
      past: [],
      future: [],
      selected: ['floor'],
      modal: null,
      productDetailId: null,
      theme: 'daylight',
      dark: false,
      panorama: false,
      customProducts: [],
      photoRooms: [],
      catalogs: [],
      saved: [],
      cart: [],
      history: [],
      originalShot: null,
      capture: null,
      lang: 'en',
      feedback: [],
      setLang: (lang) => setS({ lang }),
      addFeedback: (f) => setS({ feedback: [f, ...getS().feedback].slice(0, 50) }),

      setOpen: (open) => setS({ open }),
      openRoom: (roomId, applied) => {
        const room = getRoom(roomId)
        // select this room's own floor (photo rooms use generated surface ids)
        const surfs = surfacesForRoom(roomId, getS().photoRooms)
        const first = surfs.find((x) => x.type === 'floor') ?? surfs[0]
        setS({
          roomId,
          view: 'visualizer',
          applied: applied ?? (room ? structuredClone(room.defaults) : {}),
          past: [],
          future: [],
          selected: first ? [first.id] : [],
          panorama: false,
          originalShot: null,
          open: true,
        })
      },
      backToRooms: () => setS({ view: 'rooms', panorama: false }),
      select: (selected) => setS({ selected }),
      apply: (ids, app) => {
        const prev = getS().applied
        const next = { ...prev }
        for (const id of ids) next[id] = typeof app === 'function' ? app(prev[id], id) : app
        setS({ applied: next, past: [...getS().past.slice(-40), prev], future: [] })
      },
      setApplied: (a) => setS({ applied: a, past: [...getS().past.slice(-40), getS().applied], future: [] }),
      undo: () => {
        const { past, applied, future } = getS()
        if (!past.length) return
        setS({ applied: past[past.length - 1], past: past.slice(0, -1), future: [applied, ...future] })
      },
      redo: () => {
        const { past, applied, future } = getS()
        if (!future.length) return
        setS({ applied: future[0], future: future.slice(1), past: [...past, applied] })
      },
      reset: () => {
        const room = getRoom(getS().roomId)
        getS().setApplied(room ? structuredClone(room.defaults) : {})
      },
      setModal: (modal) => setS(modal ? { modal } : { modal, editingRoomId: null }),
      showProduct: (id) => setS({ productDetailId: id, modal: id ? 'product' : null }),
      setTheme: (theme) => setS({ theme }),
      toggleDark: () => setS({ dark: !getS().dark }),
      togglePanorama: () => setS({ panorama: !getS().panorama }),
      addCustomProduct: (p) => setS({ customProducts: [p, ...getS().customProducts] }),
      removeCustomProduct: (id) => setS({ customProducts: getS().customProducts.filter((p) => p.id !== id) }),
      addPhotoRoom: (r) => setS({ photoRooms: [r, ...getS().photoRooms] }),
      updatePhotoRoom: (id, patch) => setS({ photoRooms: getS().photoRooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
      editingRoomId: null,
      editSurfaces: (id) => setS({ editingRoomId: id, modal: id ? 'uploadRoom' : getS().modal }),
      removePhotoRoom: (id) => setS({ photoRooms: getS().photoRooms.filter((p) => p.id !== id) }),
      addCatalog: (c) => setS({ catalogs: [c, ...getS().catalogs] }),
      removeCatalog: (id) => setS({ catalogs: getS().catalogs.filter((c) => c.id !== id) }),
      saveDesign: (d) => setS({ saved: [d, ...getS().saved] }),
      removeDesign: (id) => setS({ saved: getS().saved.filter((d) => d.id !== id) }),
      addToCart: (i) => {
        const cart = getS().cart
        const ex = cart.find((c) => c.productId === i.productId)
        setS({ cart: ex ? cart.map((c) => (c.productId === i.productId ? { ...c, areaM2: c.areaM2 + i.areaM2, surfaceLabel: `${c.surfaceLabel}, ${i.surfaceLabel}` } : c)) : [...cart, i] })
      },
      removeFromCart: (pid) => setS({ cart: getS().cart.filter((c) => c.productId !== pid) }),
      setCartArea: (pid, a) => setS({ cart: getS().cart.map((c) => (c.productId === pid ? { ...c, areaM2: a } : c)) }),
      clearCart: () => setS({ cart: [] }),
      pushHistory: (id) => setS({ history: [id, ...getS().history.filter((h) => h !== id)].slice(0, 30) }),
      setOriginalShot: (originalShot) => setS({ originalShot }),
      setCapture: (capture) => setS({ capture }),
    }),
    {
      name: 'tiles-visualiser',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        theme: s.theme,
        dark: s.dark,
        customProducts: s.customProducts,
        photoRooms: s.photoRooms,
        catalogs: s.catalogs,
        saved: s.saved,
        cart: s.cart,
        history: s.history,
        lang: s.lang,
        feedback: s.feedback,
      }),
    },
  ),
)

export const useAllProducts = () => {
  const custom = useStore((s) => s.customProducts)
  return custom.length ? [...custom, ...PRODUCTS] : PRODUCTS
}

export const findProduct = (id: string) => PRODUCTS.find((p) => p.id === id) ?? useStore.getState().customProducts.find((p) => p.id === id)
export const findPaint = (id: string) => PAINTS.find((p) => p.id === id)

export const currentDesign = (): Design => {
  const s = useStore.getState()
  return { roomId: s.roomId, applied: s.applied }
}

export const roomName = (roomId: string) => getRoom(roomId)?.name ?? useStore.getState().photoRooms.find((r) => r.id === roomId)?.name ?? 'My Room'
