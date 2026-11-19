/**
 * GPU renderer for photo rooms (the reference's approach): the room photo is drawn at the screen's
 * own resolution, and every tiled surface is a full-screen pass that maps each photo pixel through
 * the surface's perspective (inverse homography) to metres on the real surface, then samples a small
 * repeating block of the layout with mipmaps and anisotropic filtering. Tiles stay sharp up close and
 * clean far away. The room's own light (shadow / reflection / highlight maps) and cut-out are applied
 * as in the canvas renderer, so both look the same apart from sharpness.
 */
import * as THREE from 'three'
import { invert3, squareToQuad, type Pt } from './homography'

export interface GLLayers {
  photo: HTMLImageElement
  cutout: HTMLImageElement
  cutoutGlossy: HTMLImageElement | null
  shadow: HTMLImageElement
  reflection: HTMLImageElement
  highlight: HTMLImageElement
}

export interface GLSurface {
  /** clip polygon in photo pixels (where this surface shows) */
  clip: Pt[]
  /** perspective guide quad (photo pixels) and its real size in metres */
  guide: Pt[]
  size: [number, number]
  /** repeating block (wrap) or a whole-surface image covering `cover` (guide units: u0, u1, v0, v1) */
  tex: HTMLCanvasElement
  texSize: [number, number]
  repeat: boolean
  cover?: [number, number, number, number]
  glossy: boolean
}

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5); gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const baseFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPhoto;
void main() { gl_FragColor = vec4(texture2D(uPhoto, vUv).rgb, 1.0); }
`
const surfFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex, uMask, uShadow, uRefl, uHigh;
uniform vec4 uSel;
uniform mat3 uHinv;
uniform vec2 uImg, uSize, uBlock, uOrigin;
uniform float uZSign, uGlossy, uHighA, uRepeat;
void main() {
  float cov = dot(texture2D(uMask, vUv), uSel);
  if (cov < 0.002) discard;
  vec3 p = uHinv * vec3(vUv * uImg, 1.0);
  if (p.z * uZSign <= 0.0) discard;
  vec2 m = p.xy / p.z * uSize;           // metres on the surface
  vec2 tc = (m - uOrigin) / uBlock;      // repeating block (or whole-surface image) coordinates
  if (uRepeat < 0.5 && (tc.x < 0.0 || tc.y < 0.0 || tc.x > 1.0 || tc.y > 1.0)) discard;
  vec3 col = texture2D(uTex, tc).rgb;
  // the room's light: shadows on matt, reflections on glossy, then highlights (screen)
  vec3 light = mix(texture2D(uShadow, vUv).rgb, texture2D(uRefl, vUv).rgb, uGlossy);
  col *= light;
  vec3 hl = texture2D(uHigh, vUv).rgb * uHighA;
  col = 1.0 - (1.0 - col) * (1.0 - hl);
  gl_FragColor = vec4(col, cov);
}
`
const topFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uCut, uCutG, uM0, uM1, uM2;
uniform vec4 uG0, uG1, uG2;
uniform float uHasG;
uniform vec4 uTint;
void main() {
  vec4 c = texture2D(uCut, vUv);
  if (uHasG > 0.5) {
    float g = clamp(dot(texture2D(uM0, vUv), uG0) + dot(texture2D(uM1, vUv), uG1) + dot(texture2D(uM2, vUv), uG2), 0.0, 1.0);
    c = mix(c, texture2D(uCutG, vUv), g);
  }
  gl_FragColor = c;
}
`
const tintFrag = /* glsl */ `
uniform vec4 uTint;
void main() { gl_FragColor = uTint; }
`

/** WebGL2 is needed (three.js); without it the canvas renderer is used. */
export function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

const imgTex = (img: TexImageSource) => {
  const t = new THREE.Texture(img as HTMLImageElement)
  t.flipY = false
  t.colorSpace = THREE.NoColorSpace
  t.minFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

export class PhotoGL {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private cam = new THREE.Camera()
  private quad = new THREE.PlaneGeometry(2, 2)
  private W: number
  private H: number
  private own: THREE.Texture[] = []
  private frame: THREE.Object3D[] = []
  private base: THREE.Mesh

  constructor(W: number, H: number) {
    this.W = W
    this.H = H
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.autoClear = true
    this.canvas = this.renderer.domElement
    this.base = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: baseFrag, uniforms: { uPhoto: { value: null } }, depthTest: false, depthWrite: false }))
    this.base.renderOrder = 0
    this.base.frustumCulled = false
    this.scene.add(this.base)
  }

  private keep<T extends THREE.Texture>(t: T) {
    this.own.push(t)
    return t
  }

  /** draw the room: photo, tiled surfaces, cut-out, light tint */
  setScene(layers: GLLayers, surfaces: GLSurface[], tint: [number, number, number, number] | null) {
    for (const o of this.frame) this.scene.remove(o)
    this.frame = []
    for (const t of this.own) t.dispose()
    this.own = []
    const W = this.W
    const H = this.H
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    ;(this.base.material as THREE.ShaderMaterial).uniforms.uPhoto.value = this.keep(imgTex(layers.photo))

    // coverage masks: 4 surfaces per texture (one per channel), soft edges, sharper than the photo
    const k = Math.min(2, 4096 / Math.max(W, H))
    const groups = Math.min(3, Math.ceil(surfaces.length / 4))
    const masks: THREE.Texture[] = []
    for (let gi = 0; gi < Math.max(1, groups); gi++) {
      const c = document.createElement('canvas')
      c.width = Math.round(W * k)
      c.height = Math.round(H * k)
      const x = c.getContext('2d')!
      x.fillStyle = '#000'
      x.fillRect(0, 0, c.width, c.height)
      x.globalCompositeOperation = 'lighter'
      surfaces.slice(gi * 4, gi * 4 + 4).forEach((s, ch) => {
        x.fillStyle = ['#ff0000', '#00ff00', '#0000ff', '#000000'][ch]
        x.beginPath()
        s.clip.forEach(([px, py], i) => (i ? x.lineTo(px * k, py * k) : x.moveTo(px * k, py * k)))
        x.closePath()
        if (ch < 3) x.fill()
      })
      // the 4th surface of a group goes in alpha: drawn on a separate canvas and merged
      const fourth = surfaces[gi * 4 + 3]
      if (fourth) {
        const d = x.getImageData(0, 0, c.width, c.height)
        const a = document.createElement('canvas')
        a.width = c.width
        a.height = c.height
        const ax = a.getContext('2d', { willReadFrequently: true })!
        ax.fillStyle = '#fff'
        ax.beginPath()
        fourth.clip.forEach(([px, py], i) => (i ? ax.lineTo(px * k, py * k) : ax.moveTo(px * k, py * k)))
        ax.closePath()
        ax.fill()
        const ad = ax.getImageData(0, 0, c.width, c.height).data
        for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = ad[i + 3]
        const t = this.keep(new THREE.DataTexture(new Uint8Array(d.data.buffer), c.width, c.height, THREE.RGBAFormat))
        t.flipY = false
        t.minFilter = t.magFilter = THREE.LinearFilter
        t.needsUpdate = true
        masks.push(t)
      } else {
        // no 4th surface: alpha must not count, so clear it to 0
        const d = x.getImageData(0, 0, c.width, c.height)
        for (let i = 3; i < d.data.length; i += 4) d.data[i] = 0
        const t = this.keep(new THREE.DataTexture(new Uint8Array(d.data.buffer), c.width, c.height, THREE.RGBAFormat))
        t.flipY = false
        t.minFilter = t.magFilter = THREE.LinearFilter
        t.needsUpdate = true
        masks.push(t)
      }
    }
    const shadow = this.keep(imgTex(layers.shadow))
    const refl = this.keep(imgTex(layers.reflection))
    const high = this.keep(imgTex(layers.highlight))
    const texCache = new Map<HTMLCanvasElement, THREE.Texture>()

    surfaces.slice(0, 12).forEach((s, i) => {
      let tex = texCache.get(s.tex)
      if (!tex) {
        tex = this.keep(new THREE.CanvasTexture(s.tex))
        tex.flipY = false
        tex.colorSpace = THREE.NoColorSpace
        tex.wrapS = tex.wrapT = s.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = aniso
        texCache.set(s.tex, tex)
      }
      const Hq = squareToQuad(s.guide)
      const Hi = invert3(Hq)
      // which side of the horizon the surface is on: the sign of w at the guide's centre
      const cx = (s.guide[0][0] + s.guide[1][0] + s.guide[2][0] + s.guide[3][0]) / 4
      const cy = (s.guide[0][1] + s.guide[1][1] + s.guide[2][1] + s.guide[3][1]) / 4
      const zc = Hi[6] * cx + Hi[7] * cy + Hi[8]
      const sel = new THREE.Vector4(...[0, 1, 2, 3].map((c) => (c === i % 4 ? 1 : 0)))
      const block = s.repeat ? s.texSize : [s.texSize[0], s.texSize[1]]
      const origin = s.repeat || !s.cover ? [0, 0] : [s.cover[0] * s.size[0], s.cover[2] * s.size[1]]
      const mat = new THREE.ShaderMaterial({
        vertexShader: quadVert,
        fragmentShader: surfFrag,
        uniforms: {
          uTex: { value: tex },
          uMask: { value: masks[Math.floor(i / 4)] },
          uShadow: { value: shadow },
          uRefl: { value: refl },
          uHigh: { value: high },
          uSel: { value: sel },
          uHinv: { value: new THREE.Matrix3().set(Hi[0], Hi[1], Hi[2], Hi[3], Hi[4], Hi[5], Hi[6], Hi[7], Hi[8]) },
          uImg: { value: new THREE.Vector2(W, H) },
          uSize: { value: new THREE.Vector2(...s.size) },
          uBlock: { value: new THREE.Vector2(block[0], block[1]) },
          uOrigin: { value: new THREE.Vector2(origin[0], origin[1]) },
          uZSign: { value: zc >= 0 ? 1 : -1 },
          uGlossy: { value: s.glossy ? 1 : 0 },
          uHighA: { value: s.glossy ? 1 : 0.45 },
          uRepeat: { value: s.repeat ? 1 : 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
      const m = new THREE.Mesh(this.quad, mat)
      m.renderOrder = 1 + i
      m.frustumCulled = false
      this.scene.add(m)
      this.frame.push(m)
    })

    // cut-out on top (glossy surfaces use the glossy cut-out when the room has one)
    const gflags = [0, 1, 2].map((g) => new THREE.Vector4(...[0, 1, 2, 3].map((c) => (surfaces[g * 4 + c]?.glossy ? 1 : 0))))
    const empty = masks[0]
    const top = new THREE.Mesh(
      this.quad,
      new THREE.ShaderMaterial({
        vertexShader: quadVert,
        fragmentShader: topFrag,
        uniforms: {
          uCut: { value: this.keep(imgTex(layers.cutout)) },
          uCutG: { value: layers.cutoutGlossy ? this.keep(imgTex(layers.cutoutGlossy)) : empty },
          uM0: { value: masks[0] ?? empty },
          uM1: { value: masks[1] ?? empty },
          uM2: { value: masks[2] ?? empty },
          uG0: { value: gflags[0] },
          uG1: { value: masks[1] ? gflags[1] : new THREE.Vector4() },
          uG2: { value: masks[2] ? gflags[2] : new THREE.Vector4() },
          uHasG: { value: layers.cutoutGlossy && surfaces.some((s) => s.glossy) ? 1 : 0 },
          uTint: { value: new THREE.Vector4() },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    )
    top.renderOrder = 100
    top.frustumCulled = false
    this.scene.add(top)
    this.frame.push(top)
    if (tint) {
      const t = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: tintFrag, uniforms: { uTint: { value: new THREE.Vector4(...tint) } }, transparent: true, depthTest: false, depthWrite: false }))
      t.renderOrder = 101
      t.frustumCulled = false
      this.scene.add(t)
      this.frame.push(t)
    }
  }

  /** render at a CSS size and pixel ratio (the screen's own resolution) */
  render(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW))
    const h = Math.max(1, Math.round(cssH))
    // keep within the GPU's limits on big screens
    const r = Math.min(dpr, 4096 / Math.max(w, h))
    if (this.renderer.getPixelRatio() !== r) this.renderer.setPixelRatio(r)
    const cur = new THREE.Vector2()
    this.renderer.getSize(cur)
    if (cur.x !== w || cur.y !== h) this.renderer.setSize(w, h, false)
    this.renderer.render(this.scene, this.cam)
  }

  /** an image of the room at a given pixel width (for downloads, catalogue, sharing) */
  snapshot(width: number) {
    const cur = new THREE.Vector2()
    this.renderer.getSize(cur)
    const pr = this.renderer.getPixelRatio()
    const w = Math.min(4096, Math.round(width))
    const h = Math.round((w * this.H) / this.W)
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h, false)
    this.renderer.render(this.scene, this.cam)
    const url = this.canvas.toDataURL('image/jpeg', 0.92)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(cur.x, cur.y, false)
    this.renderer.render(this.scene, this.cam)
    return url
  }

  dispose() {
    for (const t of this.own) t.dispose()
    this.renderer.dispose()
  }
}
