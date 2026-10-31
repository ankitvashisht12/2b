import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run build:site` writes site/dist. Vercel serves it as static files (see vercel.json).
const pages = ['index.html', 'v1/index.html', 'v2/index.html', 'v3/index.html']

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: pages.map((page) => resolve(import.meta.dirname, page)) },
  },
})
