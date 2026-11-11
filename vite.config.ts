import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works from any static host / sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
