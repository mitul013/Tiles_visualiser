import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Edges, MeshReflectorMaterial, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Room, Surface3D } from '../data/rooms'
import type { Application, LightTheme } from '../types'
import { findPaint, findProduct, useStore } from '../store'
import { renderPaint, renderSurfaceMaps } from '../lib/layout'
import { Furniture } from './Furniture'

const THEMES: Record<LightTheme, { color: string; ambient: number; key: number; sky: string; ground: string; bg: string }> = {
  daylight: { color: '#ffffff', ambient: 0.45, key: 1.3, sky: '#eef4ff', ground: '#cdbfae', bg: '#dfe9f3' },
  warm: { color: '#ffd7a6', ambient: 0.45, key: 1.35, sky: '#ffe6c7', ground: '#a88b6c', bg: '#e9d7c0' },
  soft: { color: '#fff1dd', ambient: 0.6, key: 1.2, sky: '#fff6ea', ground: '#c9b8a2', bg: '#ece4d8' },
  crystal: { color: '#e4efff', ambient: 0.6, key: 1.65, sky: '#e8f1ff', ground: '#b9c3cf', bg: '#dbe6f5' },
}

interface SurfaceTex {
  map: THREE.Texture
  normal?: THREE.Texture
  rough?: THREE.Texture
}

function useSurfaceTexture(surface: Surface3D, app: Application | undefined) {
  const [tex, setTex] = useState<SurfaceTex | null>(null)
  const gl = useThree((s) => s.gl)
  const key = JSON.stringify(app ?? null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!app) return setTex(null)
      if (app.kind === 'paint') {
        const p = findPaint(app.paintId)
        if (!p) return
        const t = new THREE.CanvasTexture(renderPaint(p))
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(surface.size[0] * 2, surface.size[1] * 2)
        t.colorSpace = THREE.SRGBColorSpace
        if (!cancelled) setTex({ map: t })
        return
      }
      const p = findProduct(app.productId)
      if (!p) return
      const maps = await renderSurfaceMaps(p, app.settings, surface.size)
      if (cancelled) return
      const aniso = gl.capabilities.getMaxAnisotropy()
      const mk = (c: HTMLCanvasElement, srgb: boolean) => {
        const t = new THREE.CanvasTexture(c)
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = aniso
        return t
      }
      setTex({ map: mk(maps.color, true), normal: mk(maps.normal, false), rough: mk(maps.roughness, false) })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, surface.id, surface.size[0], surface.size[1]])
  // dispose textures we replace
  const prev = useRef<SurfaceTex | null>(null)
  useEffect(() => {
    const old = prev.current
    if (old && old !== tex) [old.map, old.normal, old.rough].forEach((t) => t?.dispose())
    prev.current = tex
  }, [tex])
  return tex
}

const COUNTER_THICKNESS = 0.04

/** Rugs are placed at the product's real size (long side across the room); no rug applied = nothing drawn. */
function RugMesh(props: { surface: Surface3D; app?: Application; selected: boolean; outdoor?: boolean; onPick: (id: string, additive: boolean) => void; onHover: (label: string | null) => void }) {
  const app = props.app
  const p = app?.kind === 'tile' ? findProduct(app.productId) : undefined
  if (!p || !app || app.kind !== 'tile') return null
  const [a, b] = [p.size[0] / 100, p.size[1] / 100]
  const surface: Surface3D = { ...props.surface, size: [a, b], rotation: a < b ? [-Math.PI / 2, 0, Math.PI / 2] : props.surface.rotation }
  return <SurfaceMesh {...props} surface={surface} app={{ ...app, settings: { ...app.settings, layout: 'grid', groutMm: 0, rotation: 0 } }} />
}

function SurfaceMesh({ surface, app, selected, outdoor, onPick, onHover }: { surface: Surface3D; app?: Application; selected: boolean; outdoor?: boolean; onPick: (id: string, additive: boolean) => void; onHover: (label: string | null) => void }) {
  const tex = useSurfaceTexture(surface, app)
  const finish = app?.kind === 'tile' ? app.settings.finish : app?.finish ?? 'matt'
  const glossy = finish === 'glossy'
  const horizontal = surface.type === 'floor'
  const counter = surface.type === 'countertop'
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return
    if (e.intersections[0]?.object !== e.object) return
    e.stopPropagation()
    onPick(surface.id, e.shiftKey || e.metaKey || e.ctrlKey)
  }
  // countertops are slabs: the top face sits at the surface position and the material wraps the edges
  const position: [number, number, number] = counter ? [surface.position[0], surface.position[1] - COUNTER_THICKNESS / 2, surface.position[2]] : surface.position
  const ao =
    surface.type === 'floor'
      ? edgeAO(surface.size, { l: !outdoor, r: !outdoor, t: true, b: !outdoor })
      : surface.type === 'wall'
        ? edgeAO(surface.size, { l: !outdoor, r: !outdoor, t: !outdoor, b: true })
        : undefined
  const common = {
    key: tex?.map.uuid ?? 'none',
    aoMap: ao,
    aoMapIntensity: 1,
    map: tex?.map,
    normalMap: tex?.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: tex?.rough,
    color: tex ? '#ffffff' : '#d9d9d9',
  }
  return (
    <mesh
      position={position}
      rotation={surface.rotation}
      receiveShadow
      castShadow={counter}
      onClick={handleClick}
      onPointerMove={(e) => {
        if (e.intersections[0]?.object === e.object) {
          onHover(surface.label)
          document.body.style.cursor = 'pointer'
        }
      }}
      onPointerOut={() => {
        onHover(null)
        document.body.style.cursor = ''
      }}
      userData={{ surfaceId: surface.id }}
    >
      {counter ? <boxGeometry args={[surface.size[0], surface.size[1], COUNTER_THICKNESS]} /> : <planeGeometry args={surface.size} />}
      {horizontal && glossy ? (
        <MeshReflectorMaterial
          {...common}
          blur={[400, 120]}
          resolution={1024}
          mixBlur={1}
          mixStrength={0.6}
          mirror={0.4}
          roughness={tex?.rough ? 1 : 0.25}
          depthScale={0.6}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          metalness={0}
        />
      ) : (
        <meshStandardMaterial {...common} roughness={tex?.rough ? 1 : glossy ? 0.12 : 0.85} envMapIntensity={glossy ? 1.0 : 0.3} />
      )}
      {selected && <Edges color="#1e88ff" lineWidth={3} />}
    </mesh>
  )
}

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.45
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/** Registers a capture() function on the store so toolbars can grab a JPEG of the view. */
function CaptureBridge({ roomId }: { roomId: string }) {
  const gl = useThree((s) => s.gl)
  const setCapture = useStore((s) => s.setCapture)
  const setOriginal = useStore((s) => s.setOriginalShot)
  useEffect(() => {
    // preserveDrawingBuffer keeps the last composed frame (with AO) readable
    const capture = (hd = false) => gl.domElement.toDataURL('image/jpeg', hd ? 0.95 : 0.85)
    setCapture(capture)
    // only clear if still ours: the R3F root unmounts asynchronously, after the next scene registered
    return () => {
      if (useStore.getState().capture === capture) setCapture(null)
    }
  }, [gl, setCapture])
  useEffect(() => {
    const t = setTimeout(() => {
      if (!useStore.getState().originalShot) setOriginal(gl.domElement.toDataURL('image/jpeg', 0.85))
    }, 1800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])
  return null
}

function Controls({ room, panorama }: { room: Room; panorama: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const ref = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const { w, d, h } = room.dims
  useEffect(() => {
    if (panorama) {
      camera.position.set(0, 1.6, 0.01)
      camera.fov = 75
      ref.current?.target.set(0, 1.6, 0)
    } else {
      camera.position.set(...room.camera.position)
      camera.fov = 55
      ref.current?.target.set(...room.camera.target)
    }
    camera.updateProjectionMatrix()
    ref.current?.update()
  }, [panorama, room, camera])
  // keep the camera inside the room
  const clamp = () => {
    if (room.outdoor || panorama) return
    const m = 0.15
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -w / 2 + m, w / 2 - m)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -d / 2 + m, d / 2 - m)
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.3, h - 0.2)
  }
  return panorama ? (
    <OrbitControls ref={ref} enableZoom={false} enablePan={false} rotateSpeed={-0.35} target={[0, 1.6, 0]} />
  ) : (
    <OrbitControls
      ref={ref}
      onChange={clamp}
      enablePan={false}
      minDistance={0.5}
      maxDistance={room.outdoor ? 9 : Math.max(w, d) * 0.95}
      minPolarAngle={Math.PI * 0.25}
      maxPolarAngle={Math.PI * 0.56}
      minAzimuthAngle={room.outdoor ? -0.9 : -0.75}
      maxAzimuthAngle={room.outdoor ? 0.9 : 0.75}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      target={room.camera.target}
    />
  )
}

/**
 * Ambient occlusion baked per room surface: soft darkening where walls meet the floor,
 * ceiling and each other (what screen-space AO would add), cheap and renderer-agnostic.
 */
const aoCache = new Map<string, THREE.Texture>()
function edgeAO(size: [number, number], edges: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }) {
  const key = `${size.join('x')}:${JSON.stringify(edges)}`
  let t = aoCache.get(key)
  if (t) return t
  const ppm = 64
  const W = Math.max(8, Math.round(size[0] * ppm))
  const H = Math.max(8, Math.round(size[1] * ppm))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'multiply'
  const band = 0.55 * ppm
  const grad = (x0: number, y0: number, x1: number, y1: number, x: number, y: number, w: number, h: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, 'rgb(120,120,120)')
    g.addColorStop(0.35, 'rgb(205,205,205)')
    g.addColorStop(1, '#fff')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
  }
  if (edges.l) grad(0, 0, band, 0, 0, 0, band, H)
  if (edges.r) grad(W, 0, W - band, 0, W - band, 0, band, H)
  if (edges.t) grad(0, 0, 0, band, 0, 0, W, band)
  if (edges.b) grad(0, H, 0, H - band, 0, H - band, W, band)
  t = new THREE.CanvasTexture(c)
  aoCache.set(key, t)
  return t
}

/** Makes every mesh inside cast and receive shadows. */
function ShadowGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    ref.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  })
  return <group ref={ref}>{children}</group>
}

export default function Scene3D({ room }: { room: Room }) {
  const applied = useStore((s) => s.applied)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.theme)
  const panorama = useStore((s) => s.panorama)
  const [hover, setHover] = useState<string | null>(null)
  const t = THEMES[theme]
  const { w, d, h } = room.dims

  const onPick = (id: string, additive: boolean) => {
    const cur = useStore.getState().selected
    if (additive) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
    else select([id])
  }

  const bg = useMemo(() => new THREE.Color(room.outdoor ? '#bcd7ee' : t.bg), [room.outdoor, t.bg])

  return (
    <div className="scene-wrap">
      <Canvas
        key={room.id}
        dpr={[1, 2]}
        shadows="soft"
        frameloop="demand"
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        camera={{ position: room.camera.position, fov: 55, near: 0.05, far: 200 }}
        onPointerMissed={() => undefined}
        scene={{ background: bg }}
      >
        <Env />
        <CaptureBridge roomId={room.id} />
        <Controls room={room} panorama={panorama} />
        <hemisphereLight args={[t.sky, t.ground, t.ambient]} />
        <ambientLight intensity={t.ambient * 0.5} color={t.color} />
        <directionalLight position={[w * 0.3, h * 2, d]} intensity={t.key * 0.55} color={t.color} />
        {/* shadow-casting key light: a soft overhead/window light that only furniture shadows */}
        <directionalLight
          position={room.outdoor ? [4, 9, 5] : [w * 0.35, h - 0.05, d * 0.15]}
          target-position={[0, 0, -d * 0.15]}
          intensity={t.key * (room.outdoor ? 1.5 : 1.0)}
          color={t.color}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-radius={6}
          shadow-camera-left={-Math.max(w, d)}
          shadow-camera-right={Math.max(w, d)}
          shadow-camera-top={Math.max(w, d)}
          shadow-camera-bottom={-Math.max(w, d)}
          shadow-camera-near={0.1}
          shadow-camera-far={30}
        />
        <pointLight position={[0, h - 0.3, 0]} intensity={room.outdoor ? 0 : 3} distance={Math.max(w, d) * 1.4} decay={1.4} color={t.color} />
        {room.surfaces.map((s) => (
          s.type === 'rug' ? <RugMesh key={s.id} surface={s} app={applied[s.id]} selected={selected.includes(s.id)} outdoor={room.outdoor} onPick={onPick} onHover={setHover} /> :
          <SurfaceMesh key={s.id} surface={s} app={applied[s.id]} selected={selected.includes(s.id)} outdoor={room.outdoor} onPick={onPick} onHover={setHover} />
        ))}
        <ShadowGroup>
          <Furniture room={room} />
        </ShadowGroup>
        <ContactShadows position={[0, 0.004, 0]} scale={[w, d]} resolution={1024} opacity={0.45} blur={2.4} far={1.6} frames={1} />
      </Canvas>
      {hover && <div className="hover-tag">{hover} · click to select{' '}<kbd>Shift</kbd> to add</div>}
    </div>
  )
}

