import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { readThumbRequest, ThumbRenderer } from './components/ThumbRenderer'

const thumb = readThumbRequest()

// Test hook used by scripts/compare.cjs (only exposed with ?harness)
if (new URLSearchParams(location.search).has('harness')) {
  void Promise.all([import('./store'), import('./data/products')]).then(([store, products]) => {
    ;(window as unknown as Record<string, unknown>).__tv = { useStore: store.useStore, PRODUCTS: products.PRODUCTS }
  })
}

createRoot(document.getElementById('root')!).render(<StrictMode>{thumb ? <ThumbRenderer roomId={thumb} /> : <App />}</StrictMode>)
