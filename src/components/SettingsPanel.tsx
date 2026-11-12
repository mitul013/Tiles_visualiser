import { useState } from 'react'
import { findProduct, useStore } from '../store'
import { GROUT_COLORS, LAYOUTS } from '../lib/layout'
import type { Application, SurfaceSettings } from '../types'
import { Icon } from './ui'
import { useT } from '../lib/i18n'

const SPARKLES = ['#d4af37', '#c0c0c0', '#b87333', '#7fb7ff', '#ff8fc8']

/** Layout / rotation / grout / finish controls for the selected tiled surfaces. */
export default function SettingsPanel() {
  const t = useT()
  const selected = useStore((s) => s.selected)
  const applied = useStore((s) => s.applied)
  const apply = useStore((s) => s.apply)
  const [open, setOpen] = useState(true)

  const tiled = selected.filter((id) => applied[id]?.kind === 'tile')
  const paints = selected.filter((id) => applied[id]?.kind === 'paint')
  if (!tiled.length && !paints.length) return null

  const first = tiled.length ? (applied[tiled[0]] as Extract<Application, { kind: 'tile' }>) : null
  const product = first ? findProduct(first.productId) : null
  const st = first?.settings

  const update = (patch: Partial<SurfaceSettings>) =>
    apply(tiled, (prev) => (prev?.kind === 'tile' ? { ...prev, settings: { ...prev.settings, ...patch } } : prev!))

  return (
    <div className={`settings-panel${open ? '' : ' closed'}`}>
      <button className="sp-head" onClick={() => setOpen(!open)}>
        <Icon name="settings" size={16} /> {t('Settings')}{product ? ` · ${product.name}` : ''}
        <span className="chev">{open ? '–' : '+'}</span>
      </button>
      {open && st && product && ['Wallpaper', 'Panel', 'Rug'].includes(product.material) && (
        <div className="sp-body">
          <label>{t('Surface finish')}</label>
          <p className="hint">{product.material === 'Rug' ? `${product.size[0]}×${product.size[1]} cm rug, placed at real size.` : 'Seamless product: no grout joints.'}</p>
          {product.material === 'Rug' && (
            <>
              <label>{t('Rotation')}</label>
              <div className="seg">
                {([0, 45, 90] as const).map((r) => (
                  <button key={r} className={st.rotation === r ? 'on' : ''} onClick={() => update({ rotation: r })}>
                    {r}°
                  </button>
                ))}
              </div>
              {(['Left / right', 'Back / front'] as const).map((lab, k) => (
                <label key={lab} className="slider">
                  {lab}
                  <input
                    type="range"
                    min={-2}
                    max={2}
                    step={0.05}
                    value={st.offset?.[k] ?? 0}
                    onChange={(e) => {
                      const o: [number, number] = [...(st.offset ?? [0, 0])] as [number, number]
                      o[k] = Number(e.target.value)
                      update({ offset: o })
                    }}
                  />
                </label>
              ))}
            </>
          )}
        </div>
      )}
      {open && st && !(product && ['Wallpaper', 'Panel', 'Rug'].includes(product.material)) && (
        <div className="sp-body">
          <label>{t('Layout')}</label>
          <div className="layout-grid">
            {LAYOUTS.map((l) => (
              <button key={l.id} className={st.layout === l.id ? 'on' : ''} onClick={() => update({ layout: l.id })} title={l.hint}>
                <LayoutIcon id={l.id} />
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          <label>{t('Rotation')}</label>
          <div className="seg">
            {([0, 45, 90] as const).map((r) => (
              <button key={r} className={st.rotation === r ? 'on' : ''} onClick={() => update({ rotation: r })}>
                {r}°
              </button>
            ))}
          </div>
          <label>
            {t('Grout size')} <b>{st.groutMm} mm</b>
          </label>
          <input type="range" min={0} max={12} step={0.5} value={st.groutMm} onChange={(e) => update({ groutMm: Number(e.target.value) })} />
          <label>{t('Grout colour')}</label>
          <div className="grout-colors">
            {GROUT_COLORS.map((c) => (
              <button key={c} className={st.groutColor === c ? 'on' : ''} style={{ background: c }} onClick={() => update({ groutColor: c })} aria-label={`Grout ${c}`} />
            ))}
            <label className="custom-color" title="Custom grout colour">
              <input type="color" value={st.groutColor} onChange={(e) => update({ groutColor: e.target.value })} />
              <Icon name="plus" size={14} />
            </label>
          </div>
          <label>{t('Sparkles')}</label>
          <div className="grout-colors">
            <button className={!st.sparkle ? 'on none' : 'none'} onClick={() => update({ sparkle: null })} aria-label="No sparkles" title="No sparkles">
              ⌀
            </button>
            {SPARKLES.map((c) => (
              <button key={c} className={`sparkle${st.sparkle === c ? ' on' : ''}`} style={{ background: `radial-gradient(circle at 30% 30%, #fff 0 12%, ${c} 40%)` }} onClick={() => update({ sparkle: c, groutMm: Math.max(st.groutMm, 3) })} aria-label={`Sparkle ${c}`} />
            ))}
          </div>
          <label>{t('Surface finish')}</label>
          <div className="seg">
            {(['glossy', 'matt'] as const).map((f) => (
              <button key={f} className={st.finish === f ? 'on' : ''} onClick={() => update({ finish: f })}>
                {f === 'glossy' ? t('Glossy') : t('Matt')}
              </button>
            ))}
          </div>
        </div>
      )}
      {open && !st && paints.length > 0 && (
        <div className="sp-body">
          <label>Paint finish</label>
          <div className="seg">
            {(['matt', 'glossy'] as const).map((f) => (
              <button
                key={f}
                className={(applied[paints[0]] as Extract<Application, { kind: 'paint' }>).finish === f ? 'on' : ''}
                onClick={() => apply(paints, (prev) => (prev?.kind === 'paint' ? { ...prev, finish: f } : prev!))}
              >
                {f === 'glossy' ? 'Satin' : 'Matt'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LayoutIcon({ id }: { id: string }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' }
  const r = (x: number, y: number, w: number, h: number, k: string | number, fill?: boolean) => <rect key={k} x={x} y={y} width={w} height={h} {...s} fill={fill ? 'currentColor' : 'none'} fillOpacity={fill ? 0.35 : 0} />
  let els: React.ReactNode[] = []
  if (id === 'grid') els = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => r(2 + i * 9, 2 + j * 9, 9, 9, `${i}${j}`)))
  if (id === 'brick') els = [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => r(2 + i * 12 - (j % 2) * 6, 2 + j * 9, 12, 9, `${i}${j}`)))
  if (id === 'third') els = [0, 1, 2].flatMap((j) => [0, 1, 2, 3].map((i) => r(2 + i * 12 - (j % 3) * 3, 2 + j * 9, 12, 9, `${i}${j}`)))
  if (id === 'random') els = [0, 1, 2, 3, 4].flatMap((j) => [0, 1, 2].map((i) => r(2 + i * 16 - [3, 11, 6, 14, 1][j], 2 + j * 5.4, 16, 5.4, `${i}${j}`)))
  if (id === 'bookmatch' || id === 'endmatch' || id === 'quadmatch')
    els = [0, 1].flatMap((i) => [0, 1].map((j) => {
      const sx = id !== 'endmatch' && i % 2 ? -1 : 1
      const sy = id !== 'bookmatch' && j % 2 ? -1 : 1
      const cx = 8.5 + i * 13
      const cy = 8.5 + j * 13
      return <g key={`${i}${j}`}>{r(2 + i * 13, 2 + j * 13, 13, 13, 'b')}<path d={`M${cx - 6.5 * sx} ${cy - 6.5 * sy} Q${cx} ${cy - 2 * sy} ${cx + 6.5 * sx} ${cy + 6.5 * sy}`} {...s} /></g>
    }))
  if (id === 'rows') els = [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => r(2 + i * 9, 2 + j * 9, 9, 9, `${i}${j}`, j === 1)))
  if (id === 'columns') els = [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => r(2 + i * 9, 2 + j * 9, 9, 9, `${i}${j}`, i === 1)))
  if (id === 'stack') els = [0, 1, 2, 3, 4].map((i) => r(2 + i * 5.4, 2, 5.4, 27, i))
  if (id === 'checkered') els = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => r(2 + i * 9, 2 + j * 9, 9, 9, `${i}${j}`, (i + j) % 2 === 1)))
  if (id === 'herringbone')
    els = [0, 1, 2].flatMap((k) => [r(2 + k * 6, 2 + k * 6, 6, 12, `v${k}`), r(8 + k * 6, 2 + k * 6, 12, 6, `h${k}`)])
  if (id === 'quarter')
    els = [0, 1].flatMap((i) => [0, 1].map((j) => <g key={`${i}${j}`} transform={`rotate(${(i * 2 + j) * 90} ${8.5 + i * 13} ${8.5 + j * 13})`}>{r(2 + i * 13, 2 + j * 13, 13, 13, 'b')}<path d={`M${2 + i * 13} ${2 + j * 13} l13 13`} {...s} /></g>))
  if (id === 'diagonal') els = [<g key="d" transform="rotate(45 15.5 15.5)">{[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => r(3 + i * 8.5, 3 + j * 8.5, 8.5, 8.5, `${i}${j}`)))}</g>]
  return (
    <svg viewBox="0 0 31 31" width={30} height={30}>
      <clipPath id={`c-${id}`}>
        <rect x="2" y="2" width="27" height="27" />
      </clipPath>
      <g clipPath={`url(#c-${id})`}>{els}</g>
    </svg>
  )
}
