import './vue-sfc.ts'
import { expect, test } from 'bun:test'
import { PassThrough, Writable } from 'node:stream'
import { defineComponent, h } from '@vue/runtime-core'
import { createApp, useRenderer } from 'vue-termui'
import { demoSnapshot } from '../src/lib/demo.ts'
import type { Snapshot } from '../src/types.ts'

type Renderer = { currentRenderBuffer: { getRealCharBytes(trim: boolean): Uint8Array }; destroy(): void }

async function renderScene(name: 'Detail' | 'Settings', state: Snapshot) {
  const component = (await import(`../src/scenes/${name}Scene.vue`)).default
  let renderer: Renderer | undefined
  const probe = defineComponent({ setup() {
    renderer = useRenderer() as unknown as Renderer
    return () => h(component, { state, width: 58, height: 14 })
  } })
  const app = await createApp(probe, null, {
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stdout: new Writable({ write(_chunk, _encoding, done) { done() } }) as unknown as NodeJS.WriteStream,
    width: 58, height: 14, exitOnCtrlC: false, consoleMode: 'disabled', screenMode: 'main-screen',
  })
  const errors: unknown[] = []
  app.config.errorHandler = error => errors.push(error)
  try {
    app.mount()
    await Bun.sleep(100)
    if (errors.length) throw errors[0]
    return new TextDecoder().decode(renderer!.currentRenderBuffer.getRealCharBytes(true))
  } finally { app.unmount(); renderer?.destroy() }
}

test('expanded synopsis renders and scrolls the complete text instead of the episode grid', async () => {
  const state = demoSnapshot('detail')
  state.detail = { ...state.detail!, desc: Array.from({ length: 24 }, (_, index) => `简介段落 ${String(index + 1).padStart(2, '0')}`).join('\n') }
  state.detailExpanded = true
  const first = await renderScene('Detail', state)
  expect(first).toContain('完整简介')
  expect(first).toContain('简介段落 01')
  expect(first).not.toContain('简介段落 24')
  expect(first).not.toContain('151 集')
  state.contentOffset = 12
  const last = await renderScene('Detail', state)
  expect(last).toContain('简介段落 24')
  expect(last).not.toContain('简介段落 01')
})

test('expanded setting shows its entire value and uses the snapshot scroll position', async () => {
  const state = demoSnapshot('settings')
  state.settings = [{ label: '下载目录', value: Array.from({ length: 24 }, (_, index) => `目录段 ${String(index + 1).padStart(2, '0')}`).join('\n') }]
  state.cursor = 0
  state.settingsExpanded = true
  state.contentOffset = 14
  const frame = await renderScene('Settings', state)
  expect(frame).toContain('I / Esc 收起')
  expect(frame).toContain('目录段 24')
  expect(frame).not.toContain('目录段 01')
  expect(frame).not.toContain('按 I 查看完整详情')
})

test('60-column detail with facts, synopsis and groups renders exactly seven episode rows', async () => {
  const state = demoSnapshot('detail')
  state.cursor = 0
  state.episodeGroups = ['正片', '预告']
  state.episodeGroup = '正片'
  const frame = await renderScene('Detail', state)
  const visibleEpisodes = [...frame.matchAll(/[✓·]\s+(\d{1,3})(?=\s)/g)].map(match => Number(match[1]))
  expect(visibleEpisodes).toHaveLength(56)
  expect(visibleEpisodes[0]).toBe(1)
  expect(visibleEpisodes.at(-1)).toBe(56)
})
