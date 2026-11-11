import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { readThumbRequest, ThumbRenderer } from './components/ThumbRenderer'

const thumb = readThumbRequest()

createRoot(document.getElementById('root')!).render(<StrictMode>{thumb ? <ThumbRenderer roomId={thumb} /> : <App />}</StrictMode>)
