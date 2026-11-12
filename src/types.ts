export type SurfaceType = 'floor' | 'wall' | 'countertop' | 'backsplash' | 'ceiling' | 'rug'

export type Material =
  | 'Marble'
  | 'Wood'
  | 'Stone'
  | 'Concrete'
  | 'Terrazzo'
  | 'Ceramic'
  | 'Mosaic'
  | 'Pattern'
  | 'Hexagon'
  | 'Subway'
  | 'Wallpaper'
  | 'Panel'
  | 'Rug'
  | 'Custom'

export type Finish = 'glossy' | 'matt'

export type ColorFamily =
  | 'White'
  | 'Beige'
  | 'Grey'
  | 'Black'
  | 'Brown'
  | 'Blue'
  | 'Green'
  | 'Pink'
  | 'Multi'

/** Procedural art recipe used to draw a tile face. */
export interface TileArt {
  kind:
    | 'marble'
    | 'wood'
    | 'stone'
    | 'concrete'
    | 'terrazzo'
    | 'solid'
    | 'mosaic'
    | 'pattern'
    | 'hexagon'
    | 'wallpaper'
    | 'panel'
    | 'rug'
    | 'image'
  base: string
  accent: string
  accent2?: string
  /** For pattern tiles: which motif to draw */
  motif?: 'star' | 'flower' | 'diamond' | 'arc' | 'cross' | 'damask' | 'stripe' | 'botanical' | 'lattice' | 'linen' | 'medallion' | 'kilim' | 'shag' | 'border'
  /** For uploaded tiles */
  imageUrl?: string
}

export interface Product {
  id: string
  name: string
  sku: string
  material: Material
  color: ColorFamily
  finish: Finish
  /** width x height in cm */
  size: [number, number]
  application: SurfaceType[]
  /** price per square metre */
  price: number
  piecesPerBox: number
  thicknessMm: number
  art: TileArt
  isNew?: boolean
  createdAt: number
  description: string
  custom?: boolean
}

export interface Paint {
  id: string
  name: string
  hex: string
  family: ColorFamily
}

export type LayoutPattern =
  | 'grid'
  | 'brick'
  | 'third'
  | 'random'
  | 'stack'
  | 'checkered'
  | 'rows'
  | 'columns'
  | 'herringbone'
  | 'quarter'
  | 'diagonal'
  | 'bookmatch'
  | 'endmatch'
  | 'quadmatch'

export interface SurfaceSettings {
  layout: LayoutPattern
  rotation: 0 | 45 | 90
  groutColor: string
  groutMm: number
  finish: Finish
  /** sparkle (glitter) grout colour, or null/undefined for plain grout */
  sparkle?: string | null
  /** rugs only: position offset from the rug's default spot, metres (x, z) */
  offset?: [number, number]
}

export type Application =
  | { kind: 'tile'; productId: string; settings: SurfaceSettings }
  | { kind: 'paint'; paintId: string; finish: Finish }

export interface SurfaceDef {
  id: string
  label: string
  type: SurfaceType
  /** width / height in metres (used for tile scale) */
  size: [number, number]
}

export interface Design {
  roomId: string
  applied: Record<string, Application>
}

export interface SavedDesign extends Design {
  id: string
  name: string
  createdAt: number
  thumb: string
}

export interface CatalogEntry {
  id: string
  name: string
  createdAt: number
  design: Design
  image: string
}

export interface CartItem {
  productId: string
  areaM2: number
  surfaceLabel: string
}

export type LightTheme = 'daylight' | 'warm' | 'soft' | 'crystal'
