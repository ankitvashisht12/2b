import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run build` writes dash-v3/dist; the 2b server serves it at http://127.0.0.1:4423.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  // ponytail: one main bundle; only the graph and its Canvas library load as a separate chunk.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  // `npx vite dash-v3` serves the source with the API of a running 2b server.
  server: { proxy: { '/api': process.env.TWOB_API || 'http://127.0.0.1:4423' } },
})
