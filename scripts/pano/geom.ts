/** Equirectangular <-> perspective view helpers shared by the 360° room scripts. */
export type V3 = [number, number, number]
/** direction of an equirect point: lon 0 = +z, lon grows with u (to the right), lat up = +y */
export const dirOf = (lon: number, lat: number): V3 => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface View {
  F: V3
  R: V3
  U: V3
  t: number
}
export const view = (yawDeg: number, pitchDeg: number, fovDeg = 90): View => {
  const lon = (yawDeg * Math.PI) / 180
  const lat = (pitchDeg * Math.PI) / 180
  return {
    F: dirOf(lon, lat),
    R: [Math.cos(lon), 0, -Math.sin(lon)],
    U: [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)],
    t: Math.tan((fovDeg * Math.PI) / 360),
  }
}

/** sample an RGB(A) equirect image into a perspective view (bilinear, wraps in longitude) */
export function renderView(img: Buffer, W: number, H: number, ch: number, v: View, N: number, NH = N) {
  const out = new Uint8Array(N * NH * 4)
  const ta = v.t * (N / NH)
  for (let j = 0; j < NH; j++)
    for (let i = 0; i < N; i++) {
      const x = ((2 * (i + 0.5)) / N - 1) * ta
      const y = (1 - (2 * (j + 0.5)) / NH) * v.t
      const d: V3 = [v.F[0] + x * v.R[0] + y * v.U[0], v.F[1] + x * v.R[1] + y * v.U[1], v.F[2] + x * v.R[2] + y * v.U[2]]
      const l = Math.hypot(d[0], d[1], d[2])
      const lon = Math.atan2(d[0], d[2])
      const lat = Math.asin(d[1] / l)
      const u = ((lon / (2 * Math.PI) + 0.5) * W - 0.5 + W) % W
      const vv = Math.min(H - 1.001, Math.max(0, (0.5 - lat / Math.PI) * H - 0.5))
      const x0 = Math.floor(u)
      const y0 = Math.floor(vv)
      const fx = u - x0
      const fy = vv - y0
      const x1 = (x0 + 1) % W
      for (let c = 0; c < 3; c++) {
        const a = img[(y0 * W + x0) * ch + c] * (1 - fx) + img[(y0 * W + x1) * ch + c] * fx
        const b = img[((y0 + 1) * W + x0) * ch + c] * (1 - fx) + img[((y0 + 1) * W + x1) * ch + c] * fx
        out[(j * N + i) * 4 + c] = a * (1 - fy) + b * fy
      }
      out[(j * N + i) * 4 + 3] = 255
    }
  return out
}

