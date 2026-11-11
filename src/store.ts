import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import type { Application, CartItem, CatalogEntry, Design, LightTheme, Product, SavedDesign, SurfaceType } from './types'
import { getRoom } from './data/rooms'
import { PRODUCTS } from './data/products'
import { PAINTS } from './data/paints'

/** A room created from the user's own photo. Quads are in normalised image coords (0..1). */
export interface PhotoSurface {
  id: string
  label: string
  type: SurfaceType
  quad: [number, number][]
  size: [number, number]
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
  createdAt: number
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await get(name)) ?? null,
  setItem: async (name, value) => set(name, value),
  removeItem: async (name) => del(name),
}

export type View = 'rooms' | 'visualizer'
export type Modal = null | 'catalog' | 'cart' | 'calculator' | 'share' | 'compare' | 'saved' | 'uploadTile' | 'uploadRoom' | 'product' | 'summary' | 'save'

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

export const surfacesForRoom = (roomId: string, photoRooms: PhotoRoom[]) => {
  const r = getRoom(roomId)
  if (r) return r.surfaces.map((s) => ({ id: s.id, label: s.label, type: s.type, size: s.size }))
  const p = photoRooms.find((x) => x.id === roomId)
  return p ? p.surfaces.map((s) => ({ id: s.id, label: s.label, type: s.type, size: s.size })) : []
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

      setOpen: (open) => setS({ open }),
      openRoom: (roomId, applied) => {
        const room = getRoom(roomId)
        setS({
          roomId,
          view: 'visualizer',
          applied: applied ?? (room ? structuredClone(room.defaults) : {}),
          past: [],
          future: [],
          selected: ['floor'],
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
      setModal: (modal) => setS({ modal }),
      showProduct: (id) => setS({ productDetailId: id, modal: id ? 'product' : null }),
      setTheme: (theme) => setS({ theme }),
      toggleDark: () => setS({ dark: !getS().dark }),
      togglePanorama: () => setS({ panorama: !getS().panorama }),
      addCustomProduct: (p) => setS({ customProducts: [p, ...getS().customProducts] }),
      removeCustomProduct: (id) => setS({ customProducts: getS().customProducts.filter((p) => p.id !== id) }),
      addPhotoRoom: (r) => setS({ photoRooms: [r, ...getS().photoRooms] }),
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
