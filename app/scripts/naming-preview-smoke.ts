// Run from app/: bunx vite build --config scripts/naming-preview-smoke.config.ts
// then node_modules/.bin/electron ../.build/naming-preview/smoke.cjs
// Uses production Core + built renderer with synthetic catalog/probe data; no downloads or external requests.
import { app, BrowserWindow, ipcMain, session } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { qualitiesFromTencentFormats } from '../../src/lib/quality'
import { completedFilename } from '../../src/lib/name'
import { jobNaming } from '../../src/lib/jobs'
import { matchRelease } from '../../src/integrations/plutofish/release-selection'
import { DEFAULT_UI_PREFS } from '../src/shared/ui-prefs'
import type { Audio, Quality } from '../../src/types'
import type { EnqueueRequest } from '../src/shared/api'

const profile = mkdtempSync(join(tmpdir(), 'gvs-naming-preview-'))
process.env.APPDATA = profile
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const output = resolve('../.build/naming-preview')
mkdirSync(output, { recursive: true })
const audios: Audio[] = [
  { id: 'zh-aac', lang: '国语', label: 'AAC 立体声', codec: 'AAC', isDefault: true, selected: true },
  { id: 'zh-eac3', lang: '国语', label: 'DDP 5.1 · 杜比全景声', codec: 'E-AC-3', isDefault: false, selected: false },
  { id: 'zh-dts', lang: '国语', label: 'DTS 5.1', codec: 'DTS', isDefault: false, selected: false },
]
const qualities: Quality[] = [
  { id: 'cmfv5hd4_dolbyvision_hfr_hbr_hq|frame_xiang', label: '杜比视界 · 帧享 · 60fps', title: 'dolbyvision',
    width: 3840, height: 2160, codec: 'DVH1', fps: 60, size: 0, drm: '' },
  { id: 'mp4hd3|tv', label: '1080P · TV · 25fps', title: 'mp4hd3',
    width: 1920, height: 1080, codec: 'AVC1', hdr: 'sdr', fps: 25, size: 0, drm: '' },
]
const request: EnqueueRequest = {
  token: 701, detail: { provider: 'youku', id: 'show', title: '此处通往繁星', year: 2026, kind: 'show', poster: '' },
  episodes: [{ vid: 'ep1', title: '此处通往繁星', number: 1, group: '', duration: 60, languages: [] }],
  quality: 0, audioIds: audios.map(a => a.id), defaultAudioId: 'zh-eac3',
  tmdb: { id: 296203, name: '此处通往繁星', title: '此处通往繁星', year: 2026, overview: '', kind: 'show' },
}
let core: Core | undefined, win: BrowserWindow | undefined
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await app.whenReady()
  let titleRequests = 0
  session.defaultSession.protocol.handle('https', req => {
    const url = new URL(req.url)
    assert.equal(url.pathname, '/3/tv/296203/translations')
    titleRequests++
    return Response.json({ id: 296203, translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { name: 'The Road to the Stars' } },
      { iso_639_1: 'zh', iso_3166_1: 'CN', data: { name: '此处通往繁星' } },
    ] })
  })
  core = new Core({ state: () => {}, jobs: () => {}, toast: () => {} })
  const internal = core as any
  Object.assign(internal.cfg, { outDir: '/Downloads', releaseGroup: 'FPWeb', includeEpisodeTitle: false, tmdbKey: 'fixture-only' })
  internal.probes.set(701, { provider: 'youku', qualities, audios })
  const before = JSON.stringify({ qualities, audios })
  assert.equal((await core.namingPreview(request)).file,
    'The.Road.to.the.Stars.2026.S01E01.2160p.YOUKU.WEB-DL.HQ.DV.60fps.DDP.5.1.Atmos.H.265-FPWeb.mp4')
  assert.ok((await core.namingPreview({ ...request, defaultAudioId: 'zh-aac' })).file.endsWith('.AAC.2.0.H.265-FPWeb.mp4'))
  assert.ok((await core.namingPreview({ ...request, quality: 1 })).file.includes('.1080p.YOUKU.WEB-DL.SDR.DDP.5.1.Atmos.H.264-'))
  const special = await core.namingPreview({ ...request, tmdbSeason: 0, publication: { category: '', episodeNumbers: { ep1: 298 } } })
  assert.ok(special.file.includes('.S00E298.'))
  assert.ok(special.folder.endsWith('Season 00'))
  assert.ok(special.folder.includes('此处通往繁星 (2026)'))
  const edited = await core.namingPreview({ ...request, naming: { title: 'Custom English Name', year: 2024, season: 2 } })
  assert.ok(edited.file.startsWith('Custom.English.Name.2024.S02E01.'))
  assert.ok(edited.folder.includes('此处通往繁星 (2024)'))
  assert.ok(edited.folder.endsWith('Season 02'))
  assert.deepEqual([edited.title, edited.year, edited.season], ['Custom English Name', 2024, 2])
  const unmatched = await core.namingPreview({ ...request, tmdb: null, naming: { title: 'Manual Without TMDB', year: 2025, season: 0 } })
  assert.ok(unmatched.file.startsWith('Manual.Without.TMDB.2025.S00E01.'))
  await assert.rejects(() => core!.namingPreview({ ...request, naming: { year: 25 } }), /年份/)
  assert.equal(titleRequests, 1)
  assert.equal(JSON.stringify({ qualities, audios }), before)
  assert.equal(core.jobList().length, 0)
  await assert.rejects(() => core!.namingPreview({ ...request, token: -1 }), /过期/)

  // Reproduce the screenshot through the production task builder, including an
  // opaque Tencent profile and an already enabled legacy episode-title option.
  Object.assign(internal.cfg, { releaseGroup: 'PFWEB', includeEpisodeTitle: true })
  internal.probes.set(702, { provider: 'tencent', qualities: qualitiesFromTencentFormats([
    { id: '123', name: 'maxplus', profile: '4', vencoding: 'h265', width: 3840, height: 2160, vfps: 60, hdr: 'hdr' },
  ]), audios })
  const tencentRequest: EnqueueRequest = { ...request, token: 702,
    detail: { ...request.detail, provider: 'tencent', title: '尚公主' },
    tmdb: null, naming: { title: 'Tigers Sniff the Rose' },
    episodes: [{ ...request.episodes[0]!, title: '尚公主 第01集' }],
  }
  const tencentPreview = await core.namingPreview(tencentRequest)
  assert.equal(tencentPreview.file,
    'Tigers.Sniff.the.Rose.2026.S01E01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.DDP.5.1.Atmos.H.265-PFWEB.mkv')
  const savedTask = JSON.parse(JSON.stringify(internal.buildTasks(tencentRequest).tasks[0]))
  assert.equal(completedFilename(jobNaming(savedTask, internal.cfg), { status: 'probed', width: 3840, height: 2160,
    codec: 'hevc', dynamicRange: 'HDR', fps: 60, audio: { status: 'confirmed', codec: 'eac3', channels: 6, atmos: true } }, 'MAXPLUS'), tencentPreview.file)
  const versionName = `S01.${tencentPreview.file.slice(tencentPreview.file.indexOf('2160p.')).replace(/\.mkv$/, '')}`
  assert.deepEqual(matchRelease([{ id: 'existing', name: 'S01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.HEVC.DDP.5.1.Atmos-PFWEB',
    resolution: '2160p', dynamicRange: 'HDR', status: 'published' }], versionName), { matchedId: 'existing', match: 'specs' })
  Object.assign(internal.cfg, { releaseGroup: 'FPWeb', includeEpisodeTitle: false })

  ipcMain.handle('naming-preview-smoke', (_event, req) => core!.namingPreview(req))
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
    .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
    .replace("const title = '山海回声'", "const title = '此处通往繁星'")
    .replace("tmdbKey: ''", "tmdbKey: 'fixture-only'")
    .replace("case 'publicationPreferences':", `case 'tmdbSearch': return [${JSON.stringify(request.tmdb)}]; case 'tmdbSeasons': return { seasons: [], warning: '' }; case 'publicationPreferences':`)
    .replace('const settings = {', `const settings = { ui: ${JSON.stringify({ ...DEFAULT_UI_PREFS, theme: 'light', motion: false })},`)
    .replace('Object.assign(settings, args[0]);', 'if (args[0].ui) args[0].ui = { ...settings.ui, ...args[0].ui }; Object.assign(settings, args[0]);')
  const start = preload.indexOf('const audios = '), end = preload.indexOf('let jobs = ')
  assert.ok(start > 0 && end > start)
  const views = qualities.map((q, index) => ({ ...q, index, stream: q.id, hdr: q.hdr || '', audios: audios.map(a => ({ ...a, embedded: false })) }))
  preload = preload.slice(0, start) + `const audios = ${JSON.stringify(audios)};\nconst qualities = ${JSON.stringify(views)};\n` + preload.slice(end)
  preload = preload.replace(/case 'namingPreview':[^\n]+/, "case 'namingPreview': return ipcRenderer.invoke('naming-preview-smoke', args[0])")
  const preloadPath = join(output, 'preload.cjs')
  writeFileSync(preloadPath, preload)
  const errors: string[] = []
  for (const width of [1440, 1040, 760]) {
    win = new BrowserWindow({ width, height: 900, useContentSize: true, show: false,
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `naming-${width}` } })
    win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/i.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    const run = async (script: string) => {
      try { return await win!.webContents.executeJavaScript(script) }
      catch (error) {
        writeFileSync(join(output, `failure-${width}.json`), JSON.stringify({ script, errors,
          body: await win!.webContents.executeJavaScript('document.body.innerText') }, null, 2))
        throw error
      }
    }
    async function wait(script: string) {
      const until = Date.now() + 15000
      while (Date.now() < until) { if (await run(`!!(${script})`)) return; await delay(80) }
      writeFileSync(join(output, `failure-${width}.json`), JSON.stringify({ script, errors,
        body: await run('document.body.innerText'), calls: await run('window.__uiFlowFixture.snapshot().calls') }, null, 2))
      throw new Error(`Timeout: ${script}; see failure-${width}.json`)
    }
    async function click(script: string) { await wait(`!!(${script})`); await run(`(${script}).click()`); await delay(100) }
    const clickSelector = (selector: string) => click(`document.querySelector(${JSON.stringify(selector)})`)
    await win.loadFile(resolve('out/renderer/index.html'))
    await wait('window.__uiFlowFixture.snapshot().ready')
    await wait('document.querySelector("input[type=search]")')
    await run('(() => { const input = document.querySelector("input[type=search]"); input.value = "此处通往繁星"; input.dispatchEvent(new Event("input", { bubbles: true })); input.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()')
    await clickSelector('button[aria-label="打开 此处通往繁星"]')
    await clickSelector('button[aria-label^="第 1 集"]')
    await click('Array.from(document.querySelectorAll("main button")).find(e => e.textContent.trim() === "选画质")')
    await wait('document.querySelector(".filename-preview code")')
    await run('Array.from(document.querySelectorAll("main button")).find(e => e.textContent.trim().startsWith("手动选择画质"))?.click()')
    await wait('document.querySelectorAll("input[name=quality]").length === 2')
    await wait('document.querySelector(".filename-preview code")?.textContent.includes("HQ.DV.60fps.AAC.2.0.H.265")')
    await run('document.querySelectorAll("details").forEach(e => e.open = true)')
    await clickSelector('button[aria-label="国语 DDP 5.1 · 杜比全景声 设为默认"]')
    await wait('document.querySelector(".filename-preview code")?.textContent.includes("HQ.DV.60fps.DDP.5.1.Atmos.H.265")')
    await wait('document.querySelector(".filename-preview code")?.textContent.startsWith("The.Road.to.the.Stars.2026.S01E01.")')
    const fill = async (selector: string, value: string) => {
      await run(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    }
    await fill('#output-title', 'Custom English Name')
    await fill('#output-year', '2024')
    await fill('#manual-season', '2')
    await wait('document.querySelector(".filename-preview code")?.textContent.startsWith("Custom.English.Name.2024.S02E01.")')
    assert.ok(await run('document.querySelector(".folder-preview code").textContent.endsWith("Season 02")'))
    await fill('#output-year', '25')
    await wait('document.querySelector(".output-settings [role=alert]")?.textContent.includes("年份")')
    assert.equal(await run('Array.from(document.querySelectorAll("button")).find(e => e.textContent.includes("开始下载"))?.disabled'), true)
    await fill('#output-year', '2024')
    await wait('!document.querySelector(".output-settings [role=alert]")')
    await click('Array.from(document.querySelectorAll(".output-heading button")).find(e => e.textContent.trim() === "恢复自动")')
    await wait('document.querySelector(".filename-preview code")?.textContent.startsWith("The.Road.to.the.Stars.2026.S01E01.")')
    await fill('#manual-season', '0')
    await wait('document.querySelector(".filename-preview code")?.textContent.includes(".2026.S00E01.")')
    await click('Array.from(document.querySelectorAll(".output-heading button")).find(e => e.textContent.trim() === "恢复自动")')
    await wait('document.querySelector(".filename-preview code")?.textContent.includes(".2026.S01E01.")')
    await run('document.querySelector(".output-card").scrollIntoView({ block: "start" })')
    await run("Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.__copiedFilename = text } })")
    await click('document.querySelector(".preview-heading button")')
    assert.equal(await run('window.__copiedFilename'), await run('document.querySelector(".filename-preview code").textContent'))
    await run('document.fonts.ready.then(() => true)')
    await delay(200)
    writeFileSync(join(output, `preview-${width}.png`), (await win.webContents.capturePage()).toPNG())
    const overflow = await run('({ page: document.documentElement.scrollWidth > innerWidth + 1, name: document.querySelector(".filename-preview").scrollWidth > document.querySelector(".filename-preview").clientWidth + 1 })')
    assert.deepEqual(overflow, { page: false, name: false })
    await click('document.querySelectorAll("input[name=quality]")[1]')
    await wait('document.querySelector(".filename-preview code")?.textContent.includes("1080p.YOUKU.WEB-DL.SDR.DDP.5.1.Atmos.H.264")')
    assert.ok(!await run('document.querySelector(".filename-preview code").textContent.includes("HQ.DV")'))
    win.destroy(); win = undefined
  }
  assert.deepEqual(errors, [])
  console.log('PASS: production Core and renderer preview full specs, update quality/default audio, preserve numbering and manual title/year/season, reset, copy, and wrap at 1440/1040/760px')
}

void main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  win?.destroy()
  if (core) { await core.shutdown(); core.dispose() }
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
