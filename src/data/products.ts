import type { ColorFamily, Finish, Material, Product, SurfaceType, TileArt } from '../types'

interface Seed {
  name: string
  material: Material
  color: ColorFamily
  finish: Finish
  sizes: [number, number][]
  application: SurfaceType[]
  price: number
  art: TileArt
  isNew?: boolean
}

const FW: SurfaceType[] = ['floor', 'wall']
const ALL: SurfaceType[] = ['floor', 'wall', 'countertop', 'backsplash']
const WALLS: SurfaceType[] = ['wall', 'backsplash']

const seeds: Seed[] = [
  // Marble
  { name: 'Statuario Bianco', material: 'Marble', color: 'White', finish: 'glossy', sizes: [[60, 120], [80, 80], [60, 60]], application: ALL, price: 42, art: { kind: 'marble', base: '#f4f3f0', accent: '#8f8f95', accent2: '#c9b48a' }, isNew: true },
  { name: 'Calacatta Oro', material: 'Marble', color: 'White', finish: 'glossy', sizes: [[60, 120], [120, 240]], application: ALL, price: 58, art: { kind: 'marble', base: '#f7f4ee', accent: '#b08d57', accent2: '#7d7a76' } },
  { name: 'Carrara Soft', material: 'Marble', color: 'Grey', finish: 'matt', sizes: [[60, 60], [30, 60]], application: ALL, price: 34, art: { kind: 'marble', base: '#e9e9ea', accent: '#9ea2a8' } },
  { name: 'Nero Marquina', material: 'Marble', color: 'Black', finish: 'glossy', sizes: [[60, 120], [60, 60]], application: ALL, price: 49, art: { kind: 'marble', base: '#1d1d1f', accent: '#e8e6e1', accent2: '#5b5b5f' } },
  { name: 'Emperador Dark', material: 'Marble', color: 'Brown', finish: 'glossy', sizes: [[60, 60], [80, 80]], application: ALL, price: 45, art: { kind: 'marble', base: '#4a3226', accent: '#c7a98a', accent2: '#2a1b14' } },
  { name: 'Verde Alpi', material: 'Marble', color: 'Green', finish: 'glossy', sizes: [[60, 120]], application: ALL, price: 62, art: { kind: 'marble', base: '#2e4a3c', accent: '#d9e3dc', accent2: '#16261f' }, isNew: true },
  { name: 'Rosa Portogallo', material: 'Marble', color: 'Pink', finish: 'matt', sizes: [[60, 60], [30, 60]], application: ALL, price: 47, art: { kind: 'marble', base: '#ead2c8', accent: '#b88a7c', accent2: '#f6e8e2' } },
  { name: 'Azul Macaubas', material: 'Marble', color: 'Blue', finish: 'glossy', sizes: [[60, 120]], application: ALL, price: 79, art: { kind: 'marble', base: '#5b7f9e', accent: '#d8e4ee', accent2: '#2f4a63' } },
  { name: 'Crema Marfil', material: 'Marble', color: 'Beige', finish: 'matt', sizes: [[60, 60], [80, 80], [60, 120]], application: ALL, price: 38, art: { kind: 'marble', base: '#e8dcc4', accent: '#b9a582' } },
  { name: 'Onyx Honey', material: 'Marble', color: 'Beige', finish: 'glossy', sizes: [[60, 120]], application: ALL, price: 88, art: { kind: 'marble', base: '#e3b26b', accent: '#fff3d6', accent2: '#9c6a2b' } },

  // Wood
  { name: 'Nordic Oak', material: 'Wood', color: 'Beige', finish: 'matt', sizes: [[20, 120], [15, 90]], application: FW, price: 29, art: { kind: 'wood', base: '#c9a77c', accent: '#8f6a43' }, isNew: true },
  { name: 'Smoked Walnut', material: 'Wood', color: 'Brown', finish: 'matt', sizes: [[20, 120], [20, 160]], application: FW, price: 33, art: { kind: 'wood', base: '#6b4a33', accent: '#3b2618' } },
  { name: 'Ash Grey Plank', material: 'Wood', color: 'Grey', finish: 'matt', sizes: [[20, 120], [15, 90]], application: FW, price: 27, art: { kind: 'wood', base: '#a9a49c', accent: '#6e6a63' } },
  { name: 'Honey Teak', material: 'Wood', color: 'Brown', finish: 'matt', sizes: [[20, 120]], application: FW, price: 31, art: { kind: 'wood', base: '#b77d43', accent: '#7a4b1f' } },
  { name: 'Whitewash Pine', material: 'Wood', color: 'White', finish: 'matt', sizes: [[20, 120], [15, 90]], application: FW, price: 26, art: { kind: 'wood', base: '#e2d8c8', accent: '#b4a68f' } },
  { name: 'Ebony Strip', material: 'Wood', color: 'Black', finish: 'matt', sizes: [[15, 90]], application: FW, price: 35, art: { kind: 'wood', base: '#3a302b', accent: '#1a1411' } },

  // Stone
  { name: 'Slate Charcoal', material: 'Stone', color: 'Black', finish: 'matt', sizes: [[60, 60], [30, 60]], application: FW, price: 36, art: { kind: 'stone', base: '#3d3f42', accent: '#26282a' } },
  { name: 'Limestone Sand', material: 'Stone', color: 'Beige', finish: 'matt', sizes: [[60, 60], [60, 120]], application: FW, price: 39, art: { kind: 'stone', base: '#d6c7a8', accent: '#b8a684' } },
  { name: 'Travertine Classic', material: 'Stone', color: 'Beige', finish: 'matt', sizes: [[40, 60], [60, 60]], application: FW, price: 41, art: { kind: 'stone', base: '#dccbb0', accent: '#c1aa86' } },
  { name: 'Basalt Lava', material: 'Stone', color: 'Grey', finish: 'matt', sizes: [[60, 60]], application: FW, price: 44, art: { kind: 'stone', base: '#57595b', accent: '#3b3d3f' } },
  { name: 'Quartzite Mist', material: 'Stone', color: 'Grey', finish: 'glossy', sizes: [[60, 120]], application: ALL, price: 52, art: { kind: 'stone', base: '#bfc3c6', accent: '#9ea3a7' }, isNew: true },

  // Concrete
  { name: 'Urban Cement', material: 'Concrete', color: 'Grey', finish: 'matt', sizes: [[60, 60], [60, 120], [80, 80]], application: FW, price: 24, art: { kind: 'concrete', base: '#9d9d9b', accent: '#7f7f7d' } },
  { name: 'Loft Graphite', material: 'Concrete', color: 'Black', finish: 'matt', sizes: [[60, 60], [60, 120]], application: FW, price: 26, art: { kind: 'concrete', base: '#4f5052', accent: '#3a3b3d' } },
  { name: 'Chalk Micro', material: 'Concrete', color: 'White', finish: 'matt', sizes: [[60, 60], [120, 120]], application: FW, price: 28, art: { kind: 'concrete', base: '#e2e0dc', accent: '#c8c5bf' } },
  { name: 'Clay Resin', material: 'Concrete', color: 'Pink', finish: 'matt', sizes: [[60, 60]], application: FW, price: 30, art: { kind: 'concrete', base: '#c79a86', accent: '#a97b67' } },

  // Terrazzo
  { name: 'Venetian Terrazzo', material: 'Terrazzo', color: 'White', finish: 'glossy', sizes: [[60, 60], [40, 40]], application: ALL, price: 46, art: { kind: 'terrazzo', base: '#ece8e1', accent: '#8a8178', accent2: '#c2694a' } },
  { name: 'Terrazzo Noir', material: 'Terrazzo', color: 'Black', finish: 'glossy', sizes: [[60, 60]], application: ALL, price: 48, art: { kind: 'terrazzo', base: '#2b2b2d', accent: '#d8d4cc', accent2: '#8b8f93' } },
  { name: 'Terrazzo Blush', material: 'Terrazzo', color: 'Pink', finish: 'matt', sizes: [[40, 40], [60, 60]], application: ALL, price: 44, art: { kind: 'terrazzo', base: '#efd9d0', accent: '#b26f5c', accent2: '#5f7a72' }, isNew: true },
  { name: 'Terrazzo Sage', material: 'Terrazzo', color: 'Green', finish: 'matt', sizes: [[60, 60]], application: ALL, price: 44, art: { kind: 'terrazzo', base: '#c9d3c4', accent: '#4f6450', accent2: '#e9e4d6' } },

  // Ceramic solids
  { name: 'Pure White Gloss', material: 'Ceramic', color: 'White', finish: 'glossy', sizes: [[30, 60], [60, 60], [30, 30]], application: ALL, price: 15, art: { kind: 'solid', base: '#f5f5f3', accent: '#e6e6e3' } },
  { name: 'Ivory Satin', material: 'Ceramic', color: 'Beige', finish: 'matt', sizes: [[30, 60], [60, 60]], application: ALL, price: 16, art: { kind: 'solid', base: '#ede4d3', accent: '#ddd2bd' } },
  { name: 'Storm Grey', material: 'Ceramic', color: 'Grey', finish: 'matt', sizes: [[30, 60], [60, 60], [60, 120]], application: ALL, price: 17, art: { kind: 'solid', base: '#8a8f94', accent: '#7a7f84' } },
  { name: 'Midnight Navy', material: 'Ceramic', color: 'Blue', finish: 'glossy', sizes: [[30, 60], [30, 30]], application: WALLS, price: 19, art: { kind: 'solid', base: '#1f3049', accent: '#16243a' } },
  { name: 'Forest Glaze', material: 'Ceramic', color: 'Green', finish: 'glossy', sizes: [[30, 60], [30, 30]], application: WALLS, price: 19, art: { kind: 'solid', base: '#2f5a46', accent: '#244a39' }, isNew: true },
  { name: 'Terracotta Matt', material: 'Ceramic', color: 'Brown', finish: 'matt', sizes: [[30, 30], [20, 20]], application: FW, price: 18, art: { kind: 'solid', base: '#b5653f', accent: '#a05735' } },
  { name: 'Dusty Rose', material: 'Ceramic', color: 'Pink', finish: 'matt', sizes: [[30, 60], [20, 20]], application: WALLS, price: 18, art: { kind: 'solid', base: '#d9aaa0', accent: '#cb9a90' } },

  // Subway
  { name: 'Classic Subway White', material: 'Subway', color: 'White', finish: 'glossy', sizes: [[7.5, 15], [10, 30]], application: WALLS, price: 22, art: { kind: 'solid', base: '#f4f4f1', accent: '#dcdcd8' } },
  { name: 'Subway Sea Green', material: 'Subway', color: 'Green', finish: 'glossy', sizes: [[7.5, 15], [6.5, 20]], application: WALLS, price: 24, art: { kind: 'solid', base: '#6f9f93', accent: '#5b8a7e' } },
  { name: 'Subway Cobalt', material: 'Subway', color: 'Blue', finish: 'glossy', sizes: [[7.5, 15], [6.5, 20]], application: WALLS, price: 24, art: { kind: 'solid', base: '#2f5f9a', accent: '#244d80' } },
  { name: 'Subway Matte Black', material: 'Subway', color: 'Black', finish: 'matt', sizes: [[7.5, 15], [10, 30]], application: WALLS, price: 23, art: { kind: 'solid', base: '#262626', accent: '#1a1a1a' } },
  { name: 'Zellige Cream', material: 'Subway', color: 'Beige', finish: 'glossy', sizes: [[10, 10], [6.5, 20]], application: WALLS, price: 39, art: { kind: 'solid', base: '#efe3cc', accent: '#d6c5a4' }, isNew: true },

  // Mosaic
  { name: 'Aqua Glass Mosaic', material: 'Mosaic', color: 'Blue', finish: 'glossy', sizes: [[30, 30]], application: WALLS, price: 55, art: { kind: 'mosaic', base: '#4aa3b8', accent: '#7fc7d6', accent2: '#2d7f94' } },
  { name: 'Pebble Grey Mosaic', material: 'Mosaic', color: 'Grey', finish: 'matt', sizes: [[30, 30]], application: ALL, price: 49, art: { kind: 'mosaic', base: '#9a9a96', accent: '#c4c3bd', accent2: '#6f6f6b' } },
  { name: 'Gold Leaf Mosaic', material: 'Mosaic', color: 'Multi', finish: 'glossy', sizes: [[30, 30]], application: WALLS, price: 95, art: { kind: 'mosaic', base: '#b8913d', accent: '#e2c477', accent2: '#3a3226' } },
  { name: 'Emerald Mosaic', material: 'Mosaic', color: 'Green', finish: 'glossy', sizes: [[30, 30]], application: WALLS, price: 58, art: { kind: 'mosaic', base: '#2f7a5c', accent: '#59a582', accent2: '#1c4d3a' } },

  // Hexagon
  { name: 'Hexa White', material: 'Hexagon', color: 'White', finish: 'matt', sizes: [[20, 23]], application: ALL, price: 32, art: { kind: 'hexagon', base: '#f1f0ec', accent: '#d8d6d0' } },
  { name: 'Hexa Charcoal', material: 'Hexagon', color: 'Black', finish: 'matt', sizes: [[20, 23]], application: ALL, price: 32, art: { kind: 'hexagon', base: '#3a3b3d', accent: '#2a2b2d' } },
  { name: 'Hexa Marble Mix', material: 'Hexagon', color: 'Multi', finish: 'glossy', sizes: [[20, 23]], application: ALL, price: 41, art: { kind: 'hexagon', base: '#e9e8e5', accent: '#3a3a3c', accent2: '#a9a9ac' } },

  // Pattern / encaustic
  { name: 'Andalus Star', material: 'Pattern', color: 'Blue', finish: 'matt', sizes: [[20, 20]], application: ALL, price: 37, art: { kind: 'pattern', base: '#f2ecdf', accent: '#1f4e79', accent2: '#c08a3e', motif: 'star' }, isNew: true },
  { name: 'Lisbon Bloom', material: 'Pattern', color: 'Blue', finish: 'glossy', sizes: [[20, 20], [15, 15]], application: ALL, price: 35, art: { kind: 'pattern', base: '#f7f5ef', accent: '#2b5d9b', accent2: '#8db1d8', motif: 'flower' } },
  { name: 'Monochrome Diamond', material: 'Pattern', color: 'Black', finish: 'matt', sizes: [[20, 20]], application: ALL, price: 34, art: { kind: 'pattern', base: '#ecebe7', accent: '#232323', accent2: '#8e8e8e', motif: 'diamond' } },
  { name: 'Palm Arc', material: 'Pattern', color: 'Green', finish: 'matt', sizes: [[20, 20]], application: ALL, price: 36, art: { kind: 'pattern', base: '#efe8da', accent: '#4c7a5d', accent2: '#d79b7a', motif: 'arc' } },
  { name: 'Sienna Cross', material: 'Pattern', color: 'Brown', finish: 'matt', sizes: [[20, 20]], application: ALL, price: 34, art: { kind: 'pattern', base: '#f0e2cc', accent: '#9a4f2c', accent2: '#3b3a36', motif: 'cross' } },
  { name: 'Rose Quarter', material: 'Pattern', color: 'Pink', finish: 'matt', sizes: [[20, 20]], application: ALL, price: 36, art: { kind: 'pattern', base: '#f6ece8', accent: '#c9786a', accent2: '#58706a', motif: 'arc' } },
]

const descFor = (s: Seed) => {
  const m: Record<Material, string> = {
    Marble: 'Rectified porcelain slab with a realistic natural-marble vein and high-definition print.',
    Wood: 'Wood-look porcelain plank: warmth of timber, durability of porcelain. Water and scratch resistant.',
    Stone: 'Natural stone effect with subtle relief, ideal for high-traffic and outdoor areas.',
    Concrete: 'Industrial cement-look porcelain with a soft, even texture for modern interiors.',
    Terrazzo: 'Contemporary terrazzo with recycled stone chips set in a smooth base.',
    Ceramic: 'Glazed ceramic tile with uniform colour and easy-clean surface.',
    Mosaic: 'Mesh-mounted mosaic sheet for feature walls, backsplashes and wet areas.',
    Pattern: 'Encaustic-look patterned tile. Mix rotations for endless layouts.',
    Hexagon: 'Hexagonal tile for geometric floors and walls.',
    Subway: 'Bevelled-edge subway tile with a handmade feel.',
    Custom: 'Your uploaded product.',
  }
  return `${m[s.material]} ${s.finish === 'glossy' ? 'Polished glossy' : 'Soft matt'} finish.`
}

export const PRODUCTS: Product[] = seeds.flatMap((s, i) =>
  s.sizes.map((size, j) => {
    const area = (size[0] * size[1]) / 10000
    return {
      id: `p${i + 1}-${j + 1}`,
      name: s.name,
      sku: `TV-${s.material.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}-${size[0]}${size[1]}`,
      material: s.material,
      color: s.color,
      finish: s.finish,
      size,
      application: s.application,
      price: s.price,
      piecesPerBox: Math.max(1, Math.round(1.44 / area)),
      thicknessMm: area > 0.5 ? 9 : area > 0.1 ? 8 : 6,
      art: s.art,
      isNew: s.isNew,
      createdAt: Date.UTC(2026, 0, 1) + (i * 7 + j) * 86400000,
      description: descFor(s),
    }
  }),
)

export const MATERIALS: Material[] = ['Marble', 'Wood', 'Stone', 'Concrete', 'Terrazzo', 'Ceramic', 'Subway', 'Mosaic', 'Hexagon', 'Pattern']
export const COLORS: { name: ColorFamily; hex: string }[] = [
  { name: 'White', hex: '#f4f4f2' },
  { name: 'Beige', hex: '#dccaa6' },
  { name: 'Grey', hex: '#9a9ea3' },
  { name: 'Black', hex: '#222' },
  { name: 'Brown', hex: '#7a5134' },
  { name: 'Blue', hex: '#2f5f9a' },
  { name: 'Green', hex: '#3f7a5c' },
  { name: 'Pink', hex: '#dba79b' },
  { name: 'Multi', hex: 'conic-gradient(#c33,#fc3,#3c6,#36c,#c3c,#c33)' },
]

export const sizeLabel = (s: [number, number]) => `${s[0]}x${s[1]} cm`
