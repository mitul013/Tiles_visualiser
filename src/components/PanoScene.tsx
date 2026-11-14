/**
 * A real 360° room (equirectangular photo). Each screen pixel's ray is traced into the room box
 * fitted to the photo (scripts/pano/build.ts): the floor, wall or ceiling point it hits gives the tile
 * coordinates at real size. The photo's masks keep furniture, doors and windows in front; its shading
 * map carries the room's light and shadows onto the new tiles; glossy floors pick up a soft
 * reflection of the room. Drag to look around, wheel / pinch to zoom, tap a surface to pick it.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { findPaint, findProduct, useStore, type PanoFace, type PhotoRoom } from '../store'
import { renderTiledSurface } from '../lib/layout'
import type { Application, LightTheme } from '../types'

const FACES: PanoFace[] = ['floor', 'z1', 'x1', 'z0', 'x0', 'ceiling']
const TINT: Record<LightTheme, [number, number, number]> = { daylight: [1, 1, 1], warm: [1.04, 0.97, 0.88], soft: [1.02, 0.99, 0.94], crystal: [0.95, 0.99, 1.06] }

const vert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const frag = /* glsl */ `
precision highp float;
varying vec2 vNdc;
uniform sampler2D uPano, uMask, uShade;
uniform sampler2D uT0, uT1, uT2, uT3, uT4, uT5;
uniform vec3 uF, uR, uU;
uniform float uTanX, uTanY;
uniform float uPhi, uX0, uX1, uZ0, uZ1, uH, uCeil;
uniform int uMode[6];
uniform vec3 uPaint[6];
uniform float uGloss[6];
uniform float uFlash[6];
uniform vec3 uTint;
const float PI = 3.14159265;

vec2 eq(vec3 d) { return vec2(atan(d.x, d.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI); }

vec4 tex(int i, vec2 uv) {
  if (i == 0) return texture2D(uT0, uv);
  if (i == 1) return texture2D(uT1, uv);
  if (i == 2) return texture2D(uT2, uv);
  if (i == 3) return texture2D(uT3, uv);
  if (i == 4) return texture2D(uT4, uv);
  return texture2D(uT5, uv);
}

// the new finish of face i at texture coords uv, lit like the photo
vec3 finish(int i, vec2 uv, vec3 photo, float shade, vec3 dir) {
  int m = uMode[0];
  vec3 pc = uPaint[0];
  float gl = uGloss[0];
  for (int k = 1; k < 6; k++) if (k == i) { m = uMode[k]; pc = uPaint[k]; gl = uGloss[k]; }
  if (m == 0) return photo;
  vec3 c = m == 1 ? tex(i, uv).rgb : pc;
  vec3 lit = c * shade;
  if (gl > 0.0) {
    // glossy: a soft mirror image of the room, stronger at grazing angles
    vec3 r = vec3(dir.x, -dir.y, dir.z);
    vec3 refl = texture2D(uPano, eq(r)).rgb;
    float fres = 0.05 + 0.3 * pow(1.0 - abs(dir.y), 5.0);
    lit = mix(lit, refl * 1.05, fres * gl);
  }
  return lit;
}

void main() {
  vec3 dir = normalize(uF + vNdc.x * uTanX * uR + vNdc.y * uTanY * uU);
  vec2 uv = eq(dir);
  vec3 photo = texture2D(uPano, uv).rgb;
  vec3 m = texture2D(uMask, uv).rgb;
  float shade = texture2D(uShade, uv).r * 2.0;
  float c = cos(-uPhi), s = sin(-uPhi);
  vec2 d = vec2(dir.x * c - dir.z * s, dir.x * s + dir.z * c);
  vec3 col = photo * (1.0 - clamp(m.r + m.g + m.b, 0.0, 1.0));
  float flash = 0.0;
  // floor
  if (m.r > 0.0) {
    vec3 f = photo;
    if (dir.y < -0.001) {
      vec2 p = d * (uH / -dir.y);
      vec2 st = vec2((p.x - uX0) / (uX1 - uX0), (uZ1 - p.y) / (uZ1 - uZ0));
      f = finish(0, st, photo, shade, dir);
      flash += uFlash[0] * m.r;
    }
    col += f * m.r;
  }
  // ceiling
  if (m.b > 0.0) {
    vec3 f = photo;
    if (dir.y > 0.001) {
      vec2 p = d * ((uCeil - uH) / dir.y);
      vec2 st = vec2((p.x - uX0) / (uX1 - uX0), (p.y - uZ0) / (uZ1 - uZ0));
      f = finish(5, st, photo, shade, dir);
      flash += uFlash[5] * m.b;
    }
    col += f * m.b;
  }
  // walls: the nearest box wall along the ray
  if (m.g > 0.0) {
    float tx = d.x > 0.0 ? uX1 / d.x : d.x < 0.0 ? uX0 / d.x : 1e9;
    float tz = d.y > 0.0 ? uZ1 / d.y : d.y < 0.0 ? uZ0 / d.y : 1e9;
    float t = min(tx, tz);
    float y = dir.y * t + uH; // height above the floor
    vec2 p = d * t;
    int face;
    vec2 st;
    if (tx < tz) {
      face = d.x > 0.0 ? 2 : 4;
      st = vec2(d.x > 0.0 ? (uZ1 - p.y) / (uZ1 - uZ0) : (p.y - uZ0) / (uZ1 - uZ0), 1.0 - y / uCeil);
    } else {
      face = d.y > 0.0 ? 1 : 3;
      st = vec2(d.y > 0.0 ? (p.x - uX0) / (uX1 - uX0) : (uX1 - p.x) / (uX1 - uX0), 1.0 - y / uCeil);
    }
    vec3 f = photo;
    // keep the photo where the box is far off (vaulted ceilings, straight up)
    if (y > -0.2 && y < uCeil * 1.25) {
      f = finish(face, st, photo, shade, dir);
      for (int k = 1; k < 5; k++) if (k == face) flash += uFlash[k] * m.g;
    }
    col += f * m.g;
  }
  col = mix(col, vec3(1.0), flash * 0.18);
  gl_FragColor = vec4(col * uTint, 1.0);
}
`

// the shader works in display (sRGB) values throughout: no colour-space conversion on textures
const loadTex = (url: string) =>
  new Promise<THREE.Texture>((res, rej) =>
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.flipY = false
        t.colorSpace = THREE.NoColorSpace
        t.wrapS = THREE.RepeatWrapping
        t.minFilter = THREE.LinearFilter
        t.generateMipmaps = false
        res(t)
      },
      undefined,
      rej,
    ),
  )

export default function PanoScene({ room }: { room: PhotoRoom }) {
  const pano = room.pano!
  const applied = useStore((s) => s.applied)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.theme)
  const setCapture = useStore((s) => s.setCapture)
  const setOriginal = useStore((s) => s.setOriginalShot)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [hint, setHint] = useState(true)
  const g = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    cam: THREE.Camera
    mat: THREE.ShaderMaterial
    view: { yaw: number; pitch: number; fov: number }
    maskData?: { data: Uint8ClampedArray; w: number; h: number }
    draw: () => void
  } | null>(null)
  const faceIds = Object.fromEntries(room.surfaces.map((s) => [s.face, s.id])) as Partial<Record<PanoFace, string>>

  // set up WebGL once per room
  useEffect(() => {
    const wrap = wrapRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    wrap.appendChild(renderer.domElement)
    const empty = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    empty.needsUpdate = true
    const b = pano.box
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uPano: { value: empty },
        uMask: { value: empty },
        uShade: { value: empty },
        ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`uT${i}`, { value: empty }])),
        uF: { value: new THREE.Vector3() },
        uR: { value: new THREE.Vector3() },
        uU: { value: new THREE.Vector3() },
        uTanX: { value: 1 },
        uTanY: { value: 1 },
        uPhi: { value: b.phi },
        uX0: { value: b.x0 },
        uX1: { value: b.x1 },
        uZ0: { value: b.z0 },
        uZ1: { value: b.z1 },
        uH: { value: b.h },
        uCeil: { value: b.H },
        uMode: { value: [0, 0, 0, 0, 0, 0] },
        uPaint: { value: FACES.map(() => new THREE.Vector3(1, 1, 1)) },
        uGloss: { value: [0, 0, 0, 0, 0, 0] },
        uFlash: { value: [0, 0, 0, 0, 0, 0] },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
      },
    })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    const cam = new THREE.Camera()
    const view = { yaw: (pano.yaw * Math.PI) / 180, pitch: -0.12, fov: 85 }
    const draw = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      const cw = renderer.domElement.width / renderer.getPixelRatio()
      if (Math.abs(cw - w) > 1 || Math.abs(renderer.domElement.height / renderer.getPixelRatio() - h) > 1) renderer.setSize(w, h)
      const { yaw, pitch, fov } = view
      const F = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw))
      const R = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      const U = new THREE.Vector3(-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw))
      // fov applies to the longer side
      const t = Math.tan((fov * Math.PI) / 360)
      mat.uniforms.uF.value.copy(F)
      mat.uniforms.uR.value.copy(R)
      mat.uniforms.uU.value.copy(U)
      mat.uniforms.uTanX.value = w >= h ? t : (t * w) / h
      mat.uniforms.uTanY.value = w >= h ? (t * h) / w : t
      renderer.render(scene, cam)
    }
    g.current = { renderer, scene, cam, mat, view, draw }
    let alive = true
    ;(async () => {
      const [p, m, s] = await Promise.all([loadTex(room.image), loadTex(pano.mask), loadTex(pano.shade)])
      if (!alive) return
      p.anisotropy = renderer.capabilities.getMaxAnisotropy()
      mat.uniforms.uPano.value = p
      mat.uniforms.uMask.value = m
      mat.uniforms.uShade.value = s
      // mask pixels for tapping surfaces
      const img = m.image as HTMLImageElement
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0)
      g.current!.maskData = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
      setReady(true)
    })()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => {
      alive = false
      ro.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      g.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  // tiles, paint and finish per face
  useEffect(() => {
    if (!ready || !g.current) return
    let cancelled = false
    const { mat, renderer, draw } = g.current
    const b = pano.box
    ;(async () => {
      const modes = [0, 0, 0, 0, 0, 0]
      const gloss = [0, 0, 0, 0, 0, 0]
      const paints = FACES.map(() => new THREE.Vector3(1, 1, 1))
      const texs: (THREE.Texture | null)[] = [null, null, null, null, null, null]
      await Promise.all(
        FACES.map(async (face, i) => {
          const id = faceIds[face]
          const a: Application | undefined = id ? applied[id] : undefined
          if (!a) return
          if (a.kind === 'paint') {
            const p = findPaint(a.paintId)
            if (!p) return
            const n = parseInt(p.hex.slice(1), 16)
            paints[i].set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
            modes[i] = 2
            gloss[i] = a.finish === 'glossy' ? 0.35 : 0
            return
          }
          const p = findProduct(a.productId)
          if (!p) return
          const size: [number, number] = face === 'floor' || face === 'ceiling' ? [b.x1 - b.x0, b.z1 - b.z0] : [face[0] === 'x' ? b.z1 - b.z0 : b.x1 - b.x0, b.H]
          const cv = await renderTiledSurface(p, a.settings, size, 2048)
          const t = new THREE.CanvasTexture(cv)
          t.flipY = false
          t.colorSpace = THREE.NoColorSpace
          t.anisotropy = renderer.capabilities.getMaxAnisotropy()
          t.minFilter = THREE.LinearMipmapLinearFilter
          t.generateMipmaps = true
          texs[i] = t
          modes[i] = 1
          gloss[i] = a.settings.finish === 'glossy' ? 1 : 0
        }),
      )
      if (cancelled) return
      const old = [0, 1, 2, 3, 4, 5].map((i) => mat.uniforms[`uT${i}`].value as THREE.Texture)
      texs.forEach((t, i) => {
        if (t) mat.uniforms[`uT${i}`].value = t
      })
      old.forEach((t, i) => texs[i] && t !== texs[i] && t.dispose?.())
      // first draw: the untouched room, kept for "compare" and "hold to see the original"
      if (!useStore.getState().originalShot) {
        mat.uniforms.uMode.value = [0, 0, 0, 0, 0, 0]
        draw()
        setOriginal(renderer.domElement.toDataURL('image/jpeg', 0.85))
      }
      mat.uniforms.uMode.value = modes
      mat.uniforms.uGloss.value = gloss
      mat.uniforms.uPaint.value = paints
      draw()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, applied, room.id])

  // light theme
  useEffect(() => {
    if (!g.current) return
    g.current.mat.uniforms.uTint.value.set(...TINT[theme])
    g.current.draw()
  }, [theme, ready])

  // brief highlight of the picked surface
  useEffect(() => {
    if (!ready || !g.current) return
    const { mat, draw } = g.current
    const on = FACES.map((f) => (faceIds[f] && selected.includes(faceIds[f]!) ? 1 : 0))
    const t0 = performance.now()
    let raf = 0
    const tick = () => {
      const k = Math.max(0, 1 - (performance.now() - t0) / 700)
      mat.uniforms.uFlash.value = on.map((v) => v * k)
      draw()
      if (k > 0) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ready])

  // capture for catalogue, share, download (hd: a larger render of the same view)
  useEffect(() => {
    const capture = (hd?: boolean) => {
      const c = g.current
      if (!c) return ''
      if (!hd) return c.renderer.domElement.toDataURL('image/jpeg', 0.9)
      const { renderer, draw } = c
      const pr = renderer.getPixelRatio()
      const w = renderer.domElement.width / pr
      const h = renderer.domElement.height / pr
      const k = Math.max(1, 1920 / Math.max(w, h))
      renderer.setPixelRatio(k)
      renderer.setSize(w, h, false)
      draw()
      const url = renderer.domElement.toDataURL('image/jpeg', 0.92)
      renderer.setPixelRatio(pr)
      renderer.setSize(w, h, false)
      draw()
      return url
    }
    setCapture(capture)
    return () => {
      if (useStore.getState().capture === capture) setCapture(null)
    }
  }, [setCapture])

  // look around: drag, wheel, pinch; tap picks a surface
  useEffect(() => {
    const el = wrapRef.current!
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinch = 0
    const look = (dx: number, dy: number) => {
      const c = g.current
      if (!c) return
      const k = ((c.view.fov * Math.PI) / 180 / Math.max(el.clientWidth, el.clientHeight)) * 1.1
      c.view.yaw -= dx * k
      c.view.pitch = Math.max(-1.45, Math.min(1.45, c.view.pitch + dy * k))
      c.draw()
    }
    const zoom = (f: number) => {
      const c = g.current
      if (!c) return
      c.view.fov = Math.max(35, Math.min(110, c.view.fov * f))
      c.draw()
    }
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = 0
      setHint(false)
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved += Math.abs(dx) + Math.abs(dy)
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) zoom(pinch / d)
        pinch = d
      } else look(dx, dy)
    }
    const up = (e: PointerEvent) => {
      const was = pts.has(e.pointerId)
      pts.delete(e.pointerId)
      pinch = 0
      if (!was || moved > 6 || pts.size) return
      // tap: which surface is under the finger
      const c = g.current
      if (!c?.maskData) return
      const r = el.getBoundingClientRect()
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1
      const ny = 1 - ((e.clientY - r.top) / r.height) * 2
      const { yaw, pitch } = c.view
      const tX = c.mat.uniforms.uTanX.value as number
      const tY = c.mat.uniforms.uTanY.value as number
      const F = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)]
      const R = [Math.cos(yaw), 0, -Math.sin(yaw)]
      const U = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)]
      const d = [0, 1, 2].map((i) => F[i] + nx * tX * R[i] + ny * tY * U[i])
      const l = Math.hypot(d[0], d[1], d[2])
      const u = Math.atan2(d[0], d[2]) / (2 * Math.PI) + 0.5
      const v = 0.5 - Math.asin(d[1] / l) / Math.PI
      const { data, w, h } = c.maskData
      const i = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4
      const [fl, wa, ce] = [data[i], data[i + 1], data[i + 2]]
      if (Math.max(fl, wa, ce) < 100) return
      let face: PanoFace
      if (fl >= wa && fl >= ce) face = 'floor'
      else if (ce >= wa) face = 'ceiling'
      else {
        const b = pano.box
        const cs = Math.cos(-b.phi)
        const sn = Math.sin(-b.phi)
        const dx = d[0] * cs - d[2] * sn
        const dz = d[0] * sn + d[2] * cs
        const tx = dx > 0 ? b.x1 / dx : dx < 0 ? b.x0 / dx : 1e9
        const tz = dz > 0 ? b.z1 / dz : dz < 0 ? b.z0 / dz : 1e9
        face = tx < tz ? (dx > 0 ? 'x1' : 'x0') : dz > 0 ? 'z1' : 'z0'
      }
      const id = faceIds[face]
      if (!id) return
      const cur = useStore.getState().selected
      if (e.shiftKey || e.metaKey || e.ctrlKey) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
      else select([id])
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      zoom(Math.exp(e.deltaY * 0.001))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  return (
    <div className="scene-wrap pano" ref={wrapRef}>
      {!ready && <div className="loading">Loading 360° room…</div>}
      {ready && hint && <div className="pano-hint">360° room · drag to look around</div>}
    </div>
  )
}
