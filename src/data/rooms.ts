import type { Application, SurfaceDef } from '../types'
import { DEFAULT_SETTINGS } from '../lib/layout'

export interface Surface3D extends SurfaceDef {
  position: [number, number, number]
  rotation: [number, number, number]
}

export interface Room {
  id: string
  name: string
  category: string
  dims: { w: number; d: number; h: number }
  outdoor?: boolean
  surfaces: Surface3D[]
  defaults: Record<string, Application>
  camera: { position: [number, number, number]; target: [number, number, number] }
}

const PI = Math.PI

/** Standard box room: floor + 4 walls. Extra surfaces can be appended. */
function box(w: number, d: number, h: number, walls: ('back' | 'left' | 'right' | 'front')[] = ['back', 'left', 'right', 'front']): Surface3D[] {
  const s: Surface3D[] = [{ id: 'floor', label: 'Floor', type: 'floor', size: [w, d], position: [0, 0, 0], rotation: [-PI / 2, 0, 0] }]
  if (walls.includes('back')) s.push({ id: 'wall-back', label: 'Back Wall', type: 'wall', size: [w, h], position: [0, h / 2, -d / 2], rotation: [0, 0, 0] })
  if (walls.includes('left')) s.push({ id: 'wall-left', label: 'Left Wall', type: 'wall', size: [d, h], position: [-w / 2, h / 2, 0], rotation: [0, PI / 2, 0] })
  if (walls.includes('right')) s.push({ id: 'wall-right', label: 'Right Wall', type: 'wall', size: [d, h], position: [w / 2, h / 2, 0], rotation: [0, -PI / 2, 0] })
  if (walls.includes('front')) s.push({ id: 'wall-front', label: 'Front Wall', type: 'wall', size: [w, h], position: [0, h / 2, d / 2], rotation: [0, PI, 0] })
  return s
}

const tile = (productId: string, s: Partial<typeof DEFAULT_SETTINGS> = {}): Application => ({
  kind: 'tile',
  productId,
  settings: { ...DEFAULT_SETTINGS, ...s },
})
const paint = (paintId: string): Application => ({ kind: 'paint', paintId, finish: 'matt' })

const cam = (d: number, y = 1.65): Room['camera'] => ({ position: [0, y, d / 2 - 0.35], target: [0, 0.75, -d / 2] })

const walls = (a: Application) =>
  Object.fromEntries(['wall-back', 'wall-left', 'wall-right', 'wall-front'].map((w) => [w, a])) as Record<string, Application>

export const ROOMS: Room[] = [
  {
    id: 'living',
    name: 'Modern Living Room',
    category: 'Living Room',
    dims: { w: 6, d: 5.2, h: 2.9 },
    surfaces: box(6, 5.2, 2.9),
    defaults: { floor: tile('p1-1', { finish: 'glossy' }), ...walls(paint('c2')) },
    camera: cam(5.2),
  },
  {
    id: 'bedroom',
    name: 'Calm Bedroom',
    category: 'Bedroom',
    dims: { w: 5, d: 4.6, h: 2.8 },
    surfaces: box(5, 4.6, 2.8),
    defaults: { floor: tile('p11-1', { layout: 'brick', groutMm: 1, groutColor: '#6c6a66' }), ...walls(paint('c3')) },
    camera: cam(4.6),
  },
  {
    id: 'kitchen',
    name: 'Open Kitchen',
    category: 'Kitchen',
    dims: { w: 5, d: 4.8, h: 2.8 },
    surfaces: [
      ...box(5, 4.8, 2.8),
      { id: 'backsplash', label: 'Backsplash', type: 'backsplash', size: [4.2, 0.58], position: [-0.3, 1.21, -2.4 + 0.012], rotation: [0, 0, 0] },
      { id: 'counter', label: 'Counter Top', type: 'countertop', size: [4.2, 0.64], position: [-0.3, 0.923, -2.4 + 0.32], rotation: [-PI / 2, 0, 0] },
      { id: 'island', label: 'Island Top', type: 'countertop', size: [2.2, 1.0], position: [0, 0.923, 0.0], rotation: [-PI / 2, 0, 0] },
    ],
    defaults: {
      floor: tile('p22-1'),
      ...walls(paint('c1')),
      backsplash: tile('p37-1', { layout: 'brick', groutMm: 2, groutColor: '#d8d4cc', finish: 'glossy' }),
      counter: tile('p1-1', { groutMm: 0, finish: 'glossy' }),
      island: tile('p1-1', { groutMm: 0, finish: 'glossy' }),
    },
    camera: { position: [0.4, 1.65, 2.05], target: [-0.2, 1.0, -2.4] },
  },
  {
    id: 'bathroom',
    name: 'Spa Bathroom',
    category: 'Bathroom',
    dims: { w: 3.6, d: 3.4, h: 2.7 },
    surfaces: [
      ...box(3.6, 3.4, 2.7),
      { id: 'vanity', label: 'Vanity Top', type: 'countertop', size: [1.4, 0.55], position: [-1.8 + 0.28, 0.863, 0.35], rotation: [-PI / 2, 0, PI / 2] },
    ],
    defaults: {
      floor: tile('p47-1', { groutMm: 2, groutColor: '#a9a69f' }),
      'wall-back': tile('p3-1', { finish: 'glossy', groutMm: 1.5 }),
      'wall-left': tile('p3-1', { finish: 'glossy', groutMm: 1.5 }),
      'wall-right': tile('p3-1', { finish: 'glossy', groutMm: 1.5 }),
      'wall-front': tile('p3-1', { finish: 'glossy', groutMm: 1.5 }),
      vanity: tile('p4-2', { groutMm: 0, finish: 'glossy' }),
    },
    camera: { position: [0.6, 1.6, 1.4], target: [-0.3, 1.1, -1.7] },
  },
  {
    id: 'outdoor',
    name: 'Garden Patio',
    category: 'Outdoor',
    outdoor: true,
    dims: { w: 8, d: 6.5, h: 3.2 },
    surfaces: box(8, 6.5, 3.2, ['back']),
    defaults: { floor: tile('p18-2', { layout: 'brick', groutMm: 5, groutColor: '#a9a69f' }), 'wall-back': paint('c4') },
    camera: { position: [0, 1.8, 3.0], target: [0, 0.6, -3.2] },
  },
  {
    id: 'lobby',
    name: 'Hotel Lobby',
    category: 'Commercial',
    dims: { w: 9, d: 8, h: 3.6 },
    surfaces: box(9, 8, 3.6),
    defaults: { floor: tile('p2-2', { finish: 'glossy', groutMm: 1 }), ...walls(paint('c5')), 'wall-back': tile('p26-1', { finish: 'glossy' }) },
    camera: { position: [0, 1.75, 3.6], target: [0, 0.9, -4] },
  },
]

export const ROOM_CATEGORIES = ['All', ...Array.from(new Set(ROOMS.map((r) => r.category)))]

export const getRoom = (id: string) => ROOMS.find((r) => r.id === id)
