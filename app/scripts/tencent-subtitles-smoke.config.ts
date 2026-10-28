import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
import { tuiShims } from '../electron.vite.config'

export default defineConfig({
  plugins: [tuiShims()],
  resolve: { alias: { '@tui': resolve(__dirname, '../../src/lib'), '@shared': resolve(__dirname, '../src/shared') } },
  build: {
    outDir: resolve(__dirname, '../../.build/tencent-subtitles-ui'),
    lib: { entry: resolve(__dirname, 'tencent-subtitles-smoke.ts'), formats: ['cjs'], fileName: () => 'smoke.cjs' },
    rollupOptions: { external: ['ali-oss', 'electron', ...builtinModules, /^node:/] },
  },
})
