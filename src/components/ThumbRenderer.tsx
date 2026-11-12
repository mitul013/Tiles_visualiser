import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { getRoom } from '../data/rooms'
import { useStore } from '../store'

const Scene3D = lazy(() => import('./Scene3D'))

/** `?thumb=<roomId>` renders a bare room; used by scripts/thumbnails.mjs to build room preview images. */
export const readThumbRequest = () => new URLSearchParams(location.search).get('thumb')

export function ThumbRenderer({ roomId }: { roomId: string }) {
  const room = getRoom(roomId)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    useStore.getState().openRoom(roomId)
    useStore.setState({ selected: [] })
    setReady(true)
  }, [roomId])
  if (!room || !ready) return null
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Suspense fallback={null}>
        <Scene3D room={room} />
      </Suspense>
    </div>
  )
}

/** `?libgen=<roomId>` renders a library room: original + cut-out + exact surface planes (see scripts/library.cjs). */
export const readLibGenRequest = () => new URLSearchParams(location.search).get('libgen')

type V2 = [number, number]

/** Project a surface rectangle through the camera: visible area polygon + an in-front guide rectangle. */
async function projectSurfaces(room: NonNullable<ReturnType<typeof getRoom>>, camera: import('three').Camera) {
  const THREE = await import('three')
  const { CUTOUT_TYPES } = await import('./Scene3D')
  camera.updateMatrixWorld()
  const toCam = (p: import('three').Vector3) => p.clone().applyMatrix4(camera.matrixWorldInverse)
  const toImg = (p: import('three').Vector3): V2 => {
    const v = p.clone().project(camera)
    return [+((v.x + 1) / 2).toFixed(4), +((1 - v.y) / 2).toFixed(4)]
  }
  const NEAR = -0.25 // camera looks down -z; keep geometry at least this far in front
  const out = []
  for (const s of room.surfaces) {
    if (!CUTOUT_TYPES.has(s.type)) continue
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...s.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)), new THREE.Vector3(1, 1, 1))
    const [sw, sh] = s.size
    const world = (u: number, v: number) => new THREE.Vector3((u - 0.5) * sw, (0.5 - v) * sh, 0).applyMatrix4(m)
    // visible area: clip the rectangle against the near plane (Sutherland–Hodgman), then project
    const rect = [world(0, 0), world(1, 0), world(1, 1), world(0, 1)].map(toCam)
    const clipped: import('three').Vector3[] = []
    for (let i = 0; i < rect.length; i++) {
      const a = rect[i]
      const b = rect[(i + 1) % rect.length]
      const ain = a.z <= NEAR
      const bin = b.z <= NEAR
      if (ain) clipped.push(a)
      if (ain !== bin) clipped.push(a.clone().lerp(b, (NEAR - a.z) / (b.z - a.z)))
    }
    if (clipped.length < 3) continue
    const area = clipped.map((p) => toImg(p.clone().applyMatrix4(camera.matrixWorld)))
    // guide: shrink the rectangle (in surface units) until all four corners are in front of the camera
    let [u0, u1, v0, v1] = [0, 1, 0, 1]
    const depth = (u: number, v: number) => toCam(world(u, v)).z
    for (let it = 0; it < 60; it++) {
      const corners: V2[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
      if (corners.every(([u, v]) => depth(u, v) <= NEAR * 2)) break
      const edges: [string, number][] = [['u0', depth(u0, (v0 + v1) / 2)], ['u1', depth(u1, (v0 + v1) / 2)], ['v0', depth((u0 + u1) / 2, v0)], ['v1', depth((u0 + u1) / 2, v1)]]
      const worst = edges.sort((x, y) => y[1] - x[1])[0][0]
      if (worst === 'u0') u0 += 0.04
      else if (worst === 'u1') u1 -= 0.04
      else if (worst === 'v0') v0 += 0.04
      else v1 -= 0.04
    }
    const guide = [world(u0, v0), world(u1, v0), world(u1, v1), world(u0, v1)].map(toImg)
    out.push({ id: s.id, label: s.label, type: s.type, quad: guide, area, size: [+((u1 - u0) * sw).toFixed(3), +((v1 - v0) * sh).toFixed(3)] })
  }
  return out
}

export function LibGenRenderer({ roomId }: { roomId: string }) {
  const room = getRoom(roomId)
  const [ready, setReady] = useState(false)
  const [cutout, setCutout] = useState(false)
  const ref = useRef<{ gl: import('three').WebGLRenderer; camera: import('three').Camera } | null>(null)
  useEffect(() => {
    useStore.getState().openRoom(roomId)
    useStore.setState({ selected: [] })
    setReady(true)
  }, [roomId])
  useEffect(() => {
    if (!ready || !room) return
    const w = window as unknown as Record<string, unknown>
    let stop = false
    ;(async () => {
      await new Promise((r) => setTimeout(r, 7000))
      if (stop || !ref.current) return
      const original = ref.current.gl.domElement.toDataURL('image/jpeg', 0.92)
      setCutout(true)
      await new Promise((r) => setTimeout(r, 4000))
      if (stop || !ref.current) return
      const matt = ref.current.gl.domElement.toDataURL('image/png')
      const surfaces = await projectSurfaces(room, ref.current.camera)
      const { width, height } = ref.current.gl.domElement
      w.__libgen = { id: room.id, name: room.name, category: room.category, width, height, original, matt, surfaces }
    })()
    return () => {
      stop = true
    }
  }, [ready, room])
  if (!room || !ready) return null
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Suspense fallback={null}>
        <Scene3D room={room} cutout={cutout} onReady={(gl, camera) => (ref.current = { gl, camera })} />
      </Suspense>
    </div>
  )
}
