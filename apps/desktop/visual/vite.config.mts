import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const visualDir = import.meta.dirname
const appDir = resolve(visualDir, '..')
const rendererDir = resolve(appDir, 'src/renderer/src')

export default defineConfig({
  root: visualDir,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      vitest: resolve(visualDir, 'vitest-shim.ts'),
      '@renderer': rendererDir
    }
  },
  server: {
    host: '127.0.0.1',
    fs: {
      allow: [appDir]
    }
  }
})
