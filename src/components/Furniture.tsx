import type { ReactNode } from 'react'
import type { Room } from '../data/rooms'

type V3 = [number, number, number]

const Box = ({ p, s, c, r = 0.6, m = 0, rot }: { p: V3; s: V3; c: string; r?: number; m?: number; rot?: V3 }) => (
  <mesh position={p} rotation={rot}>
    <boxGeometry args={s} />
    <meshStandardMaterial color={c} roughness={r} metalness={m} />
  </mesh>
)
const Cyl = ({ p, rt, rb, h, c, r = 0.6, m = 0, seg = 24 }: { p: V3; rt: number; rb: number; h: number; c: string; r?: number; m?: number; seg?: number }) => (
  <mesh position={p}>
    <cylinderGeometry args={[rt, rb, h, seg]} />
    <meshStandardMaterial color={c} roughness={r} metalness={m} />
  </mesh>
)
const Ball = ({ p, rad, c, r = 0.8 }: { p: V3; rad: number; c: string; r?: number }) => (
  <mesh position={p}>
    <sphereGeometry args={[rad, 20, 16]} />
    <meshStandardMaterial color={c} roughness={r} />
  </mesh>
)
const G = ({ p = [0, 0, 0], ry = 0, children }: { p?: V3; ry?: number; children: ReactNode }) => (
  <group position={p} rotation={[0, ry, 0]}>
    {children}
  </group>
)

function Plant({ p, scale = 1 }: { p: V3; scale?: number }) {
  return (
    <group position={p} scale={scale}>
      <Cyl p={[0, 0.22, 0]} rt={0.2} rb={0.15} h={0.44} c="#e8e2d6" r={0.4} />
      {[
        [0, 0.75, 0, 0.26],
        [0.14, 0.95, 0.05, 0.2],
        [-0.12, 1.05, -0.06, 0.22],
        [0.02, 1.25, 0.04, 0.18],
        [-0.15, 0.8, 0.1, 0.18],
      ].map(([x, y, z, r], i) => (
        <Ball key={i} p={[x, y, z]} rad={r} c={i % 2 ? '#4b7a3f' : '#3d6b35'} />
      ))}
      <Cyl p={[0, 0.6, 0]} rt={0.02} rb={0.025} h={0.4} c="#5b4330" />
    </group>
  )
}

/** Window: frame + glowing glass placed just in front of a wall. */
function Window({ p, w, h, ry = 0 }: { p: V3; w: number; h: number; ry?: number }) {
  return (
    <G p={p} ry={ry}>
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#dfeefa" emissive="#cfe6fb" emissiveIntensity={0.9} roughness={0.1} />
      </mesh>
      <Box p={[0, h / 2, 0.03]} s={[w + 0.1, 0.06, 0.06]} c="#f4f4f2" />
      <Box p={[0, -h / 2, 0.05]} s={[w + 0.2, 0.06, 0.12]} c="#f4f4f2" />
      <Box p={[-w / 2, 0, 0.03]} s={[0.06, h, 0.06]} c="#f4f4f2" />
      <Box p={[w / 2, 0, 0.03]} s={[0.06, h, 0.06]} c="#f4f4f2" />
      <Box p={[0, 0, 0.03]} s={[0.04, h, 0.04]} c="#f4f4f2" />
    </G>
  )
}

function Art({ p, w, h, colors, ry = 0 }: { p: V3; w: number; h: number; colors: string[]; ry?: number }) {
  return (
    <G p={p} ry={ry}>
      <Box p={[0, 0, 0.015]} s={[w + 0.06, h + 0.06, 0.03]} c="#2b2b2b" />
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={colors[0]} roughness={0.9} />
      </mesh>
      <mesh position={[-w * 0.15, h * 0.05, 0.034]}>
        <circleGeometry args={[Math.min(w, h) * 0.28, 32]} />
        <meshStandardMaterial color={colors[1]} roughness={0.9} />
      </mesh>
      <mesh position={[w * 0.18, -h * 0.12, 0.036]}>
        <planeGeometry args={[w * 0.35, h * 0.5]} />
        <meshStandardMaterial color={colors[2]} roughness={0.9} />
      </mesh>
    </G>
  )
}

function Sofa({ p, ry = 0, c = '#8d8a83', w = 2.3 }: { p: V3; ry?: number; c?: string; w?: number }) {
  return (
    <G p={p} ry={ry}>
      <Box p={[0, 0.2, 0]} s={[w, 0.26, 0.95]} c={c} r={0.95} />
      <Box p={[-w / 4 + 0.02, 0.4, 0.06]} s={[w / 2 - 0.12, 0.16, 0.78]} c={c} r={0.95} />
      <Box p={[w / 4 - 0.02, 0.4, 0.06]} s={[w / 2 - 0.12, 0.16, 0.78]} c={c} r={0.95} />
      <Box p={[0, 0.62, -0.38]} s={[w, 0.6, 0.2]} c={c} r={0.95} />
      <Box p={[-w / 2 + 0.08, 0.45, 0]} s={[0.16, 0.36, 0.95]} c={c} r={0.95} />
      <Box p={[w / 2 - 0.08, 0.45, 0]} s={[0.16, 0.36, 0.95]} c={c} r={0.95} />
      <Box p={[-w / 4, 0.68, -0.22]} s={[0.45, 0.4, 0.12]} c="#c9a77c" r={0.95} rot={[-0.2, 0.1, 0]} />
      <Box p={[w / 4, 0.68, -0.22]} s={[0.45, 0.4, 0.12]} c="#e9e4da" r={0.95} rot={[-0.2, -0.1, 0]} />
      {[-w / 2 + 0.1, w / 2 - 0.1].map((x) => (
        <Cyl key={x} p={[x, 0.04, 0.35]} rt={0.025} rb={0.02} h={0.08} c="#222" />
      ))}
    </G>
  )
}

function Armchair({ p, ry = 0, c = '#c4a582' }: { p: V3; ry?: number; c?: string }) {
  return (
    <G p={p} ry={ry}>
      <Box p={[0, 0.25, 0]} s={[0.8, 0.22, 0.8]} c={c} r={0.95} />
      <Box p={[0, 0.58, -0.32]} s={[0.8, 0.5, 0.16]} c={c} r={0.95} />
      <Box p={[-0.36, 0.42, 0]} s={[0.1, 0.24, 0.8]} c={c} r={0.95} />
      <Box p={[0.36, 0.42, 0]} s={[0.1, 0.24, 0.8]} c={c} r={0.95} />
      {[[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]].map(([x, z]) => (
        <Cyl key={`${x}${z}`} p={[x, 0.07, z]} rt={0.02} rb={0.015} h={0.14} c="#5b4330" />
      ))}
    </G>
  )
}

function Table({ p, w, d, h, top = '#5b4330', leg = '#2a2a2a', round = false }: { p: V3; w: number; d: number; h: number; top?: string; leg?: string; round?: boolean }) {
  return (
    <G p={p}>
      {round ? <Cyl p={[0, h, 0]} rt={w / 2} rb={w / 2} h={0.04} c={top} r={0.4} seg={40} /> : <Box p={[0, h, 0]} s={[w, 0.04, d]} c={top} r={0.4} />}
      {round ? (
        <Cyl p={[0, h / 2, 0]} rt={0.04} rb={0.12} h={h} c={leg} m={0.6} r={0.3} />
      ) : (
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => <Box key={`${x}${z}`} p={[(x * (w - 0.08)) / 2, h / 2, (z * (d - 0.08)) / 2]} s={[0.04, h, 0.04]} c={leg} m={0.5} r={0.3} />)
      )}
    </G>
  )
}

function FloorLamp({ p }: { p: V3 }) {
  return (
    <G p={p}>
      <Cyl p={[0, 0.015, 0]} rt={0.16} rb={0.16} h={0.03} c="#222" m={0.7} r={0.3} />
      <Cyl p={[0, 0.8, 0]} rt={0.012} rb={0.012} h={1.6} c="#222" m={0.7} r={0.3} />
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 0.3, 24, 1, true]} />
        <meshStandardMaterial color="#f7ecd8" emissive="#ffdca0" emissiveIntensity={0.6} side={2} />
      </mesh>
    </G>
  )
}

function Pendant({ p, c = '#1f1f1f' }: { p: V3; c?: string }) {
  return (
    <G p={p}>
      <Cyl p={[0, 0.4, 0]} rt={0.004} rb={0.004} h={0.8} c="#111" />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.16, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={c} metalness={0.6} roughness={0.35} side={2} />
      </mesh>
      <Ball p={[0, -0.02, 0]} rad={0.05} c="#fff4d8" />
    </G>
  )
}

function Door({ p, ry = 0 }: { p: V3; ry?: number }) {
  return (
    <G p={p} ry={ry}>
      <Box p={[0, 1.05, 0.02]} s={[0.96, 2.1, 0.04]} c="#e9e5dd" r={0.5} />
      <Box p={[0, 1.05, 0.005]} s={[1.06, 2.16, 0.02]} c="#ffffff" />
      <Cyl p={[0.38, 1.0, 0.06]} rt={0.02} rb={0.02} h={0.06} c="#b8b8b8" m={0.9} r={0.2} />
    </G>
  )
}

function Living({ room }: { room: Room }) {
  const { w, d } = room.dims
  return (
    <>
      <Sofa p={[0, 0, -d / 2 + 0.75]} />
      <Armchair p={[-1.9, 0, -0.4]} ry={0.9} />
      <Armchair p={[1.9, 0, -0.4]} ry={-0.9} c="#7a8a7c" />
      <Table p={[0, 0, -0.9]} w={1.2} d={0.6} h={0.4} top="#3b2c22" />
      <Ball p={[0.25, 0.48, -0.9]} rad={0.07} c="#c96f4a" r={0.4} />
      <FloorLamp p={[-1.55, 0, -d / 2 + 0.45]} />
      <Plant p={[1.55, 0, -d / 2 + 0.4]} />
      <Plant p={[w / 2 - 0.4, 0, 1.4]} scale={1.2} />
      <Window p={[w / 2 - 0.001, 1.5, -0.6]} ry={-Math.PI / 2} w={1.8} h={1.6} />
      <Art p={[0, 1.75, -d / 2 + 0.001]} w={1.4} h={0.8} colors={['#efe8dc', '#c96f4a', '#2f4a3b']} />
      <Box p={[-w / 2 + 0.25, 0.3, -0.5]} s={[0.45, 0.6, 1.8]} c="#2f2925" r={0.5} />
      <Box p={[-w / 2 + 0.06, 1.45, -0.5]} s={[0.05, 0.8, 1.35]} c="#111" r={0.2} m={0.2} />
      <Pendant p={[0, room.dims.h - 0.9, -0.9]} />
    </>
  )
}

function Bedroom({ room }: { room: Room }) {
  const { w, d } = room.dims
  const z = -d / 2 + 1.1
  return (
    <>
      <G p={[0, 0, z]}>
        <Box p={[0, 0.17, 0]} s={[1.8, 0.24, 2.1]} c="#6b5444" r={0.6} />
        <Box p={[0, 0.39, 0.02]} s={[1.72, 0.2, 2.02]} c="#f4f1ec" r={1} />
        <Box p={[0, 0.5, 0.35]} s={[1.78, 0.06, 1.4]} c="#9fb0a6" r={1} />
        <Box p={[-0.42, 0.56, -0.78]} s={[0.66, 0.14, 0.4]} c="#ffffff" r={1} />
        <Box p={[0.42, 0.56, -0.78]} s={[0.66, 0.14, 0.4]} c="#ffffff" r={1} />
        <Box p={[0, 0.65, -1.02]} s={[1.9, 1.1, 0.08]} c="#d7c9b6" r={0.95} />
      </G>
      {[-1.2, 1.2].map((x) => (
        <G key={x} p={[x, 0, -d / 2 + 0.3]}>
          <Box p={[0, 0.25, 0]} s={[0.5, 0.5, 0.42]} c="#3b2c22" r={0.5} />
          <Cyl p={[0, 0.6, 0]} rt={0.06} rb={0.09} h={0.2} c="#d9cfbf" />
          <mesh position={[0, 0.78, 0]}>
            <cylinderGeometry args={[0.11, 0.15, 0.18, 24, 1, true]} />
            <meshStandardMaterial color="#f7ecd8" emissive="#ffd9a0" emissiveIntensity={0.7} side={2} />
          </mesh>
        </G>
      ))}
      <Window p={[-w / 2 + 0.001, 1.5, 0.2]} ry={Math.PI / 2} w={1.6} h={1.5} />
      <Art p={[0, 1.85, -d / 2 + 0.001]} w={1.0} h={0.55} colors={['#ece6dc', '#9fb0a6', '#c7a98a']} />
      <Box p={[w / 2 - 0.3, 0.45, 0.6]} s={[0.55, 0.9, 1.4]} c="#e8e2d6" r={0.6} />
      <Plant p={[w / 2 - 0.35, 0.9, 0.2]} scale={0.6} />
    </>
  )
}

function Kitchen({ room }: { room: Room }) {
  const { w, d, h } = room.dims
  const z = -d / 2
  const run = 4.2
  const cx = -0.3
  const doors = Array.from({ length: 7 }, (_, i) => cx - run / 2 + run / 14 + (i * run) / 7)
  return (
    <>
      {/* base cabinets */}
      <Box p={[cx, 0.45, z + 0.31]} s={[run, 0.86, 0.6]} c="#2f3e46" r={0.5} />
      {doors.map((x) => (
        <Box key={x} p={[x, 0.45, z + 0.615]} s={[run / 7 - 0.03, 0.78, 0.01]} c="#34454e" r={0.45} />
      ))}
      {/* sink & tap */}
      <Box p={[cx + 0.6, 0.926, z + 0.33]} s={[0.6, 0.006, 0.4]} c="#9aa0a6" m={0.9} r={0.25} />
      <Cyl p={[cx + 0.6, 1.08, z + 0.1]} rt={0.015} rb={0.02} h={0.32} c="#c0c0c0" m={1} r={0.2} />
      {/* hob */}
      <Box p={[cx - 1.1, 0.926, z + 0.33]} s={[0.6, 0.006, 0.5]} c="#111" r={0.1} />
      {/* upper cabinets */}
      <Box p={[cx - 1.8, 1.88, z + 0.18]} s={[0.6, 0.72, 0.35]} c="#eae6df" r={0.5} />
      <Box p={[cx + 0.15, 1.88, z + 0.18]} s={[1.7, 0.72, 0.35]} c="#eae6df" r={0.5} />
      <Box p={[cx + 1.65, 1.88, z + 0.18]} s={[0.9, 0.72, 0.35]} c="#eae6df" r={0.5} />
      {/* hood */}
      <Box p={[cx - 1.1, 2.0, z + 0.25]} s={[0.7, 0.12, 0.5]} c="#c8c8c8" m={0.8} r={0.3} />
      <Box p={[cx - 1.1, (2.06 + h) / 2, z + 0.15]} s={[0.3, h - 2.06, 0.3]} c="#c8c8c8" m={0.8} r={0.3} />
      {/* fridge */}
      <Box p={[w / 2 - 0.4, 1.0, z + 0.36]} s={[0.78, 2.0, 0.7]} c="#d2d4d6" m={0.6} r={0.3} />
      <Box p={[w / 2 - 0.08, 1.2, z + 0.75]} s={[0.03, 0.6, 0.03]} c="#888" m={1} />
      {/* island */}
      <Box p={[0, 0.45, 0]} s={[2.0, 0.86, 0.8]} c="#2f3e46" r={0.5} />
      {[-0.6, 0, 0.6].map((x) => (
        <G key={x} p={[x, 0, 0.75]}>
          <Cyl p={[0, 0.66, 0]} rt={0.18} rb={0.18} h={0.06} c="#c9a77c" r={0.6} />
          <Cyl p={[0, 0.33, 0]} rt={0.02} rb={0.02} h={0.66} c="#222" m={0.7} r={0.3} />
          <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.14, 0.01, 8, 24]} />
            <meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} />
          </mesh>
        </G>
      ))}
      {[-0.6, 0, 0.6].map((x) => (
        <Pendant key={x} p={[x, h - 0.95, 0]} c="#c9a24a" />
      ))}
      <Ball p={[0.5, 0.99, 0.1]} rad={0.07} c="#e2a33b" r={0.5} />
      <Ball p={[0.38, 0.99, 0.0]} rad={0.07} c="#7fa043" r={0.5} />
      <Plant p={[-0.65, 0.92, 0.05]} scale={0.35} />
      <Window p={[-w / 2 + 0.001, 1.55, 0.2]} ry={Math.PI / 2} w={1.4} h={1.2} />
    </>
  )
}

function Bathroom({ room }: { room: Room }) {
  const { w, d } = room.dims
  return (
    <>
      {/* bathtub along back wall */}
      <G p={[0.3, 0, -d / 2 + 0.4]}>
        <Box p={[0, 0.28, 0]} s={[1.7, 0.56, 0.78]} c="#fbfbfa" r={0.15} />
        <Box p={[0, 0.5, 0]} s={[1.5, 0.12, 0.6]} c="#d9e3e8" r={0.05} />
        <Cyl p={[0.75, 0.9, -0.3]} rt={0.015} rb={0.015} h={0.5} c="#c0c0c0" m={1} r={0.15} />
      </G>
      {/* glass shower screen */}
      <mesh position={[-0.55, 1.15, -d / 2 + 0.4]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.78, 1.5]} />
        <meshStandardMaterial color="#e6f2f5" transparent opacity={0.25} roughness={0.05} />
      </mesh>
      {/* vanity on left wall */}
      <G p={[-w / 2 + 0.28, 0, 0.35]}>
        <Box p={[0, 0.55, 0]} s={[0.55, 0.58, 1.4]} c="#7a5134" r={0.5} />
        <Cyl p={[0.03, 0.91, 0]} rt={0.2} rb={0.14} h={0.12} c="#ffffff" r={0.15} seg={32} />
        <Cyl p={[-0.2, 1.0, 0]} rt={0.012} rb={0.015} h={0.28} c="#c0c0c0" m={1} r={0.15} />
      </G>
      {/* mirror */}
      <mesh position={[-w / 2 + 0.012, 1.6, 0.35]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.1, 0.85]} />
        <meshStandardMaterial color="#cfd8dc" metalness={1} roughness={0.02} />
      </mesh>
      {/* toilet */}
      <G p={[w / 2 - 0.4, 0, 0.1]} ry={-Math.PI / 2}>
        <Cyl p={[0, 0.2, 0.05]} rt={0.2} rb={0.16} h={0.4} c="#fbfbfa" r={0.15} />
        <Box p={[0, 0.55, -0.22]} s={[0.4, 0.4, 0.18]} c="#fbfbfa" r={0.15} />
      </G>
      <Plant p={[w / 2 - 0.3, 0, -0.9]} scale={0.7} />
      <Box p={[w / 2 - 0.05, 1.25, 1.0]} s={[0.04, 0.04, 0.6]} c="#c0c0c0" m={1} r={0.2} />
      <Box p={[w / 2 - 0.08, 1.0, 1.0]} s={[0.03, 0.5, 0.45]} c="#e9e4da" r={1} />
    </>
  )
}

function Outdoor({ room }: { room: Room }) {
  const { w, d } = room.dims
  return (
    <>
      {/* lawn surrounding the patio */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#6f9a4a" roughness={1} />
      </mesh>
      <Door p={[-1.6, 0, -d / 2 + 0.001]} />
      <Window p={[1.4, 1.6, -d / 2 + 0.001]} w={2.2} h={1.5} />
      <Box p={[0, 3.25, -d / 2 + 0.4]} s={[w, 0.1, 0.9]} c="#3b3b3b" />
      {/* loungers */}
      {[-1.0, 0.4].map((x) => (
        <G key={x} p={[x, 0, 0.8]} ry={0.15}>
          <Box p={[0, 0.3, 0]} s={[0.7, 0.1, 1.8]} c="#f0ebe2" r={0.9} />
          <Box p={[0, 0.55, -0.75]} s={[0.7, 0.5, 0.1]} c="#f0ebe2" r={0.9} rot={[0.5, 0, 0]} />
          <Box p={[0, 0.13, 0]} s={[0.6, 0.26, 1.6]} c="#5b4330" r={0.7} />
        </G>
      ))}
      {/* umbrella */}
      <G p={[3.0, 0, -1.4]}>
        <Cyl p={[0, 1.2, 0]} rt={0.025} rb={0.025} h={2.4} c="#ddd" m={0.5} />
        <mesh position={[0, 2.35, 0]}>
          <coneGeometry args={[1.4, 0.45, 8, 1, true]} />
          <meshStandardMaterial color="#e8d6b8" side={2} roughness={0.9} />
        </mesh>
        <Table p={[0, 0, 0]} w={0.9} d={0.9} h={0.72} round top="#efefef" />
      </G>
      <Plant p={[-w / 2 + 0.6, 0, -d / 2 + 0.6]} scale={1.4} />
      <Plant p={[w / 2 - 0.6, 0, -d / 2 + 0.6]} scale={1.4} />
      <Plant p={[-3.2, 0, 2.2]} scale={1.1} />
      {/* trees in the distance */}
      {[[-9, -10], [-4, -14], [6, -12], [11, -8], [-13, -4]].map(([x, z], i) => (
        <G key={i} p={[x, 0, z]}>
          <Cyl p={[0, 1.2, 0]} rt={0.15} rb={0.22} h={2.4} c="#5b4330" />
          <Ball p={[0, 3.2, 0]} rad={1.6} c="#4b7a3f" />
        </G>
      ))}
    </>
  )
}

function Lobby({ room }: { room: Room }) {
  const { w, d, h } = room.dims
  return (
    <>
      {/* reception desk */}
      <G p={[0, 0, -d / 2 + 1.4]}>
        <Box p={[0, 0.55, 0]} s={[3.2, 1.1, 0.7]} c="#f2efe9" r={0.3} />
        <Box p={[0, 1.12, 0.05]} s={[3.3, 0.05, 0.85]} c="#2b2b2b" r={0.2} />
        <Box p={[0, 0.55, 0.36]} s={[3.0, 0.06, 0.01]} c="#c9a24a" m={0.9} r={0.25} />
      </G>
      <Art p={[0, 2.2, -d / 2 + 0.001]} w={2.6} h={0.9} colors={['#1f2a33', '#c9a24a', '#e8e2d6']} />
      {[-3, 3].map((x) => (
        <G key={x} p={[x, 0, -0.5]}>
          <Cyl p={[0, h / 2, 0]} rt={0.3} rb={0.3} h={h} c="#efebe4" r={0.4} seg={32} />
          <Cyl p={[0, 0.05, 0]} rt={0.36} rb={0.36} h={0.1} c="#c9a24a" m={0.9} r={0.3} />
        </G>
      ))}
      <Sofa p={[-2.6, 0, 1.6]} ry={Math.PI / 2} c="#2f4a5b" w={2.0} />
      <Sofa p={[2.6, 0, 1.6]} ry={-Math.PI / 2} c="#2f4a5b" w={2.0} />
      <Table p={[0, 0, 1.6]} w={1.0} d={1.0} h={0.42} round top="#2b2b2b" leg="#c9a24a" />
      <Plant p={[-w / 2 + 0.6, 0, -d / 2 + 0.6]} scale={1.6} />
      <Plant p={[w / 2 - 0.6, 0, -d / 2 + 0.6]} scale={1.6} />
      <G p={[0, h - 0.6, 1.6]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.7, 0.03, 12, 48]} />
          <meshStandardMaterial color="#c9a24a" metalness={0.9} roughness={0.25} emissive="#ffcf70" emissiveIntensity={0.25} />
        </mesh>
        <Cyl p={[0, 0.3, 0]} rt={0.005} rb={0.005} h={0.6} c="#111" />
      </G>
      <Window p={[-w / 2 + 0.001, 1.8, 1.2]} ry={Math.PI / 2} w={3} h={2.2} />
      <Window p={[w / 2 - 0.001, 1.8, 1.2]} ry={-Math.PI / 2} w={3} h={2.2} />
    </>
  )
}

export function Furniture({ room }: { room: Room }) {
  switch (room.id) {
    case 'living':
      return <Living room={room} />
    case 'bedroom':
      return <Bedroom room={room} />
    case 'kitchen':
      return <Kitchen room={room} />
    case 'bathroom':
      return <Bathroom room={room} />
    case 'outdoor':
      return <Outdoor room={room} />
    case 'lobby':
      return <Lobby room={room} />
    default:
      return null
  }
}
