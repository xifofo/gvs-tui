// From app/: bunx vite build --config scripts/tencent-subtitles-smoke.config.ts
// node_modules/.bin/electron ../.build/tencent-subtitles-ui/smoke.cjs
// Production Core/probe/task builder + renderer; all gateway/IPC/media are isolated fixtures.
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Core } from '../src/main/core'
import { DEFAULT_UI_PREFS } from '../src/shared/ui-prefs'
import type { EnqueueRequest } from '../src/shared/api'

const profile = mkdtempSync(join(tmpdir(), 'gvs-tencent-subtitles-ui-'))
process.env.APPDATA = profile
app.setPath('userData', profile); app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const output = resolve('../.build/tencent-subtitles-ui'); mkdirSync(output, { recursive: true })
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
let core: Core | undefined, win: BrowserWindow | undefined
async function main() {
  await app.whenReady()
  core = new Core({ state: () => {}, jobs: () => {}, toast: () => {} })
  const internal = core as any
  Object.assign(internal.cfg, { outDir: join(profile, 'downloads'), tmdbKey: '' })
  internal.client = () => ({ extra: () => ({}), invoke: async (provider: string, action: string) => {
    assert.deepEqual([provider, action], ['tencent', 'play'])
    return {
      formats: ['soft', 'hard'].map((caption, i) => ({ id: String(123 + i), name: 'fhd', width: 1920, height: 1080, profile: 'h264', caption, vfps: 25 })),
      subtitles: [
        { id: 'hans', name: '简体中文', lang: 'zh-cn', format: 'vtt', url: 'https://fixture.invalid/hans.vtt.m3u8' },
        { id: 'hant', name: '繁體中文', lang: 'zh-tw', format: 'vtt', url: 'https://fixture.invalid/hant.vtt.m3u8' },
      ],
    }
  } })
  const episode = { vid: 'fixture-episode-1', title: '第1集', number: 1, group: '', duration: 60, languages: [] }
  const probe = await core.probe('tencent', [episode])
  assert.deepEqual(probe.subtitles?.map(s => [s.id, s.selected, s.isDefault]), [['hans', true, true], ['hant', true, false]])
  assert.ok(!JSON.stringify(probe.subtitles).includes('https:'))
  const soft = probe.qualities.findIndex(q => q.captionProbe === 'soft')
  const hard = probe.qualities.findIndex(q => q.captionProbe === 'hard')
  assert.ok(soft >= 0 && hard >= 0)
  const taskFor = (req: EnqueueRequest) => internal.buildTasks(req).tasks[0]
  ipcMain.handle('tencent-subtitle-preview', (_event, req: EnqueueRequest) => core!.namingPreview(req))
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
    .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
    .replace("const providers = ['youku', 'tencent'", "const providers = ['tencent', 'youku'")
    .replace('const settings = {', `const settings = { plutofishAutoUpload: false, ui: ${JSON.stringify({ ...DEFAULT_UI_PREFS, theme: 'light', motion: false })},`)
    .replace("case 'searchTargets': return ['youku', 'tencent', 'iqcn']", "case 'searchTargets': return ['tencent']")
    .replace('Object.assign(settings, args[0]);', 'if (args[0].ui) args[0].ui = { ...settings.ui, ...args[0].ui }; Object.assign(settings, args[0]);')
    .replace(/return \{ token: 701, qualities: clone\(qualities\)[^\n]+/, `return ${JSON.stringify(probe)}`)
    .replace(/case 'namingPreview':[^\n]+/, "case 'namingPreview': return ipcRenderer.invoke('tencent-subtitle-preview', args[0])")
  writeFileSync(join(output, 'preload.cjs'), preload)
  const checks: string[] = [], errors: string[] = []
  for (const width of [1280, 860]) {
    win = new BrowserWindow({ width, height: 920, useContentSize: true, show: false,
      webPreferences: { preload: join(output, 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `tencent-subs-${width}` } })
    win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/i.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    const run = async (script: string): Promise<any> => {
      try { return await win!.webContents.executeJavaScript(script) }
      catch (e) {
        writeFileSync(join(output, 'failure.json'), JSON.stringify({ script, errors,
          body: await win!.webContents.executeJavaScript('document.body.innerText') }, null, 2))
        throw e
      }
    }
    async function wait(script: string) {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) { if (await run(`!!(${script})`)) return; await delay(60) }
      writeFileSync(join(output, 'failure.json'), JSON.stringify({ script, errors, body: await run('document.body.innerText') }, null, 2))
      throw new Error(`Timeout: ${script}`)
    }
    async function click(script: string) { await wait(script); await run(`(${script}).click()`); await delay(100) }
    const section = 'Array.from(document.querySelectorAll(".qsec")).find(e => e.querySelector(".qsec-h")?.textContent.trim() === "字幕")'
    const last = 'window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "namingPreview").at(-1)?.args[0]'
    await win.loadFile(resolve('out/renderer/index.html'))
    await wait('window.__uiFlowFixture.snapshot().ready')
    await run('(() => { const original = console.error; console.error = (...args) => original(...args.map(arg => arg?.stack || arg)); })()')
    await click('Array.from(document.querySelectorAll(".side button")).find(e => e.textContent.trim() === "搜索")')
    await wait('document.querySelector(".pal input")')
    await run('(() => { const input = document.querySelector(".pal input"); input.value = "山海回声"; input.dispatchEvent(new Event("input", { bubbles: true })); })()')
    await wait('document.querySelector(".pal [role=option]")?.textContent.includes("搜索「山海回声」")')
    await click('document.querySelector(".pal [role=option]")')
    await click(`document.querySelector(${JSON.stringify('button[aria-label="打开 山海回声"]')})`)
    await click(`document.querySelector(${JSON.stringify('button[aria-label^="第 1 集"]')})`)
    await click('Array.from(document.querySelectorAll("main button")).find(e => e.textContent.trim() === "选画质")')
    await wait('document.querySelector(".filename-preview code")')
    await run('Array.from(document.querySelectorAll("main button")).find(e => e.textContent.trim().startsWith("手动选择画质"))?.click()')
    await click(`document.querySelectorAll('input[name=quality]')[${soft}]`)
    await wait(`(${section})?.querySelectorAll('input[type=checkbox]:checked').length === 2`)
    await wait(`(${last})?.subtitleIds?.length === 2`)
    const req = await run(last)
    assert.equal(req.detail.provider, 'tencent')
    assert.deepEqual(taskFor(req).subtitleTracks.map((s: any) => s.id), ['hans', 'hant'])
    assert.equal(await run(`(${section}).querySelector('.def .alang').textContent`), '简体中文')
    await run('document.fonts.ready.then(() => true)')
    await run(`(${section}).scrollIntoView({ block: 'center' })`)
    writeFileSync(join(output, `soft-${width}.png`), (await win.webContents.capturePage()).toPNG())
    await click(`(${section}).querySelectorAll('input[type=checkbox]')[0]`)
    await wait(`(${last})?.subtitleIds?.join(',') === 'hant'`)
    await wait(`(${section}).querySelector('.def .alang')?.textContent === '繁體中文'`)
    assert.deepEqual(taskFor(await run(last)).subtitleTracks.map((s: any) => s.id), ['hant'])
    await click(`document.querySelectorAll('input[name=quality]')[${hard}]`)
    await wait(`(${section}).textContent.includes('不额外挂入软字幕')`)
    await wait(`(${last})?.quality === ${hard} && (${last})?.subtitleIds?.length === 0`)
    assert.deepEqual(taskFor({ ...await run(last), subtitleIds: ['hans', 'hant'] }).subtitleTracks, [])
    assert.equal(await run(`(${section}).querySelectorAll('input[type=checkbox]').length`), 0)
    await click(`document.querySelectorAll('input[name=quality]')[${soft}]`)
    await wait(`(${section}).querySelectorAll('input[type=checkbox]:checked').length === 1`)
    await click(`(${section}).querySelectorAll('input[type=checkbox]')[1]`)
    await wait(`(${last})?.subtitleIds?.length === 0`)
    assert.deepEqual(taskFor(await run(last)).subtitleTracks, [])
    assert.equal(await run(`(${section}).querySelectorAll('.def').length`), 0)
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
    checks.push(`${width}: Chinese defaults, deselected default, hard caption guard, restored selection, empty selection, metadata-only task`)
    win.destroy(); win = undefined
  }
  if (errors.length) writeFileSync(join(output, 'console-errors.json'), JSON.stringify(errors, null, 2))
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log('PASS: Tencent subtitles production probe, Core task selections and renderer controls at 1280/860px')
}
let exitCode = 0
void main().catch(e => { console.error(e); exitCode = 1 }).finally(async () => {
  win?.destroy()
  if (core) { await core.shutdown(); core.dispose() }
  rmSync(profile, { recursive: true, force: true })
  app.exit(exitCode)
})
