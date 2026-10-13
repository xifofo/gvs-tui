import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
import { tuiShims } from '../electron.vite.config'

export default defineConfig({
  plugins: [tuiShims()],
  build: {
    outDir: resolve(__dirname, '../../.build/media-probe-smoke'),
    lib: { entry: resolve(__dirname, 'media-probe-smoke.ts'), formats: ['cjs'], fileName: () => 'smoke.cjs' },
    rollupOptions: { external: ['electron', ...builtinModules, /^node:/] },
  },
})
