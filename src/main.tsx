import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { loadBrand } from './lib/brand'
import { LibGenRenderer, readLibGenRequest, readThumbRequest, ThumbRenderer } from './components/ThumbRenderer'

const thumb = readThumbRequest()
const libgen = readLibGenRequest()

// Test hook used by scripts/compare.cjs (only exposed with ?harness)
if (new URLSearchParams(location.search).has('harness')) {
  void Promise.all([import('./store'), import('./data/products'), import('./lib/objectMask'), import('./lib/layout'), import('./lib/homography')]).then(([store, products, om, layout, homo]) => {
    ;(window as unknown as Record<string, unknown>).__tv = { useStore: store.useStore, PRODUCTS: products.PRODUCTS, refineMaskCanvas: om.refineMaskCanvas, renderTiledSurface: layout.renderTiledSurface, drawPerspective: homo.drawPerspective, coverQuad: homo.coverQuad }
  })
}

// shop branding and currency first (public/brand.json), then the app
void loadBrand().finally(() =>
  createRoot(document.getElementById('root')!).render(<StrictMode>{libgen ? <LibGenRenderer roomId={libgen} /> : thumb ? <ThumbRenderer roomId={thumb} /> : <App />}</StrictMode>),
)
