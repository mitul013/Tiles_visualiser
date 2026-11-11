export type Pt = [number, number]

/**
 * 3x3 homography that maps the unit square (0,0)-(1,0)-(1,1)-(0,1)
 * to the quad q0..q3 (clockwise: TL, TR, BR, BL).
 */
export function squareToQuad(q: Pt[]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const dy3 = y0 - y1 + y2 - y3
  let g = 0
  let h = 0
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
  }
  const a = x1 - x0 + g * x1
  const b = x3 - x0 + h * x3
  const c = x0
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + h * y3
  const f = y0
  return [a, b, c, d, e, f, g, h, 1]
}

export function applyH(H: number[], u: number, v: number): Pt {
  const w = H[6] * u + H[7] * v + H[8]
  return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w]
}

/** Draw an image triangle (u,v in image pixels) onto destination triangle using an affine transform. */
function drawTri(ctx: CanvasRenderingContext2D, img: CanvasImageSource, d: Pt[], s: Pt[]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = d
  const [[u0, v0], [u1, v1], [u2, v2]] = s
  // expand destination triangle slightly to hide seams
  const cx = (x0 + x1 + x2) / 3
  const cy = (y0 + y1 + y2) / 3
  const grow = (x: number, y: number): Pt => {
    const dx = x - cx
    const dy = y - cy
    const l = Math.hypot(dx, dy) || 1
    return [x + (dx / l) * 0.6, y + (dy / l) * 0.6]
  }
  const e0 = grow(x0, y0)
  const e1 = grow(x1, y1)
  const e2 = grow(x2, y2)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(e0[0], e0[1])
  ctx.lineTo(e1[0], e1[1])
  ctx.lineTo(e2[0], e2[1])
  ctx.closePath()
  ctx.clip()
  const den = u0 * v1 + v0 * u2 + u1 * v2 - v1 * u2 - v0 * u1 - u0 * v2
  if (Math.abs(den) < 1e-9) {
    ctx.restore()
    return
  }
  const a = (x0 * v1 + v0 * x2 + x1 * v2 - v1 * x2 - v0 * x1 - x0 * v2) / den
  const b = (u0 * x1 + x0 * u2 + u1 * x2 - x1 * u2 - x0 * u1 - u0 * x2) / den
  const c = (u0 * v1 * x2 + v0 * x1 * u2 + x0 * u1 * v2 - x0 * v1 * u2 - v0 * u1 * x2 - u0 * x1 * v2) / den
  const dd = (y0 * v1 + v0 * y2 + y1 * v2 - v1 * y2 - v0 * y1 - y0 * v2) / den
  const e = (u0 * y1 + y0 * u2 + u1 * y2 - y1 * u2 - y0 * u1 - u0 * y2) / den
  const f = (u0 * v1 * y2 + v0 * y1 * u2 + y0 * u1 * v2 - y0 * v1 * u2 - v0 * u1 * y2 - u0 * y1 * v2) / den
  ctx.transform(a, dd, b, e, c, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

/** Perspective-map `img` onto quad `q` (in destination pixel coords) by subdividing into triangles. */
export function drawPerspective(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, q: Pt[], steps = 22) {
  const H = squareToQuad(q)
  const iw = img.width
  const ih = img.height
  const grid: Pt[][] = []
  for (let j = 0; j <= steps; j++) {
    const row: Pt[] = []
    for (let i = 0; i <= steps; i++) row.push(applyH(H, i / steps, j / steps))
    grid.push(row)
  }
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < steps; i++) {
      const u0 = (i / steps) * iw
      const u1 = ((i + 1) / steps) * iw
      const v0 = (j / steps) * ih
      const v1 = ((j + 1) / steps) * ih
      drawTri(ctx, img, [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1]], [[u0, v0], [u1, v0], [u1, v1]])
      drawTri(ctx, img, [grid[j][i], grid[j + 1][i + 1], grid[j + 1][i]], [[u0, v0], [u1, v1], [u0, v1]])
    }
}

export function pointInQuad(p: Pt, q: Pt[]) {
  let inside = false
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i]
    const [xj, yj] = q[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const quadPath = (ctx: CanvasRenderingContext2D, q: Pt[]) => {
  ctx.beginPath()
  q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}
