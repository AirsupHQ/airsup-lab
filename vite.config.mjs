import { defineConfig } from 'vite'

// BASE lets you host it under a sub path, for example BASE=/my-repo/ for GitHub Pages.
export default defineConfig({
  base: process.env.BASE ?? '/',
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2500 },
  server: { host: '127.0.0.1', port: 5173 },
})
