import type { Product } from '../types'
import { formatMoney } from './brand'

export const M2_TO_FT2 = 10.7639

export interface CalcResult {
  area: number
  areaWithWaste: number
  tiles: number
  boxes: number
  boxArea: number
  cost: number
}

/** Quantity estimate for covering `areaM2` with a product, including grout and waste allowance. */
export function calculate(product: Product, areaM2: number, wastePct = 10, groutMm = 2): CalcResult {
  const tw = product.size[0] / 100 + groutMm / 1000
  const th = product.size[1] / 100 + groutMm / 1000
  const tileArea = tw * th
  const areaWithWaste = areaM2 * (1 + wastePct / 100)
  const tiles = Math.ceil(areaWithWaste / tileArea)
  const boxes = Math.ceil(tiles / product.piecesPerBox)
  const boxArea = ((product.size[0] * product.size[1]) / 10000) * product.piecesPerBox
  return { area: areaM2, areaWithWaste, tiles, boxes, boxArea, cost: boxes * boxArea * product.price }
}

/** a price in the shop's currency (public/brand.json) */
export const money = (n: number) => formatMoney(n)
