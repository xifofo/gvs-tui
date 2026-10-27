// 离线验收：生产 Core + renderer，临时配置目录，HTTP/网盘/下载入口全部替换或拦截。
// app/: bunx vite build --config scripts/release-picker-smoke.config.ts
// app/: node_modules/.bin/electron ../.build/release-picker/smoke.cjs
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { DEFAULT_UI_PREFS } from '../src/shared/ui-prefs'
import type { EnqueueRequest } from '../src/shared/api'
import type { ReleaseOption } from '../../src/integrations/plutofish/release-selection'
import { qualitiesFromTencentFormats } from '../../src/lib/quality'

const profile = mkdtempSync(join(tmpdir(), 'gvs-release-picker-'))
process.env.APPDATA = profile
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const output = resolve('../.build/release-picker')
mkdirSync(output, { recursive: true })
const id = 'a'.repeat(32)
const view = { url: 'https://example.invalid', status: 'verified', hasKey: true, error: '', identity: {
  id: 'publisher', name: '离线发布端', kind: 'publisher', sourceAccount: { id: 'source', alias: 'source', name: '测试源账号' }, categories: [{ value: 'anime', label: '动漫' }],
} }
// 稀疏目录预览没有编码；界面仍应默认选中唯一符合其余规格的版本。
const qualities = [{ id: '360p', label: '360P', width: 640, height: 360, codec: '', fps: 25, size: 0, drm: '', hdr: 'sdr' }]
const audios = [{ id: 'aac', lang: '国语', label: 'AAC 立体声', codec: 'AAC', isDefault: true, selected: true }]
const option: ReleaseOption = { id, name: 'S01.360p.YK.WEB-DL.H265-FPWeb', resolution: '360p', dynamicRange: 'SDR', status: 'published', latestEpisode: 2 }
let items: ReleaseOption[] = [option], fail = false, queryDelay = 0
let core: Core | undefined, win: BrowserWindow | undefined
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await app.whenReady()
  core = new Core({ state: () => {}, jobs: () => {}, toast: () => {} })
  const internal = core as any
  Object.assign(internal.cfg, { outDir: profile, releaseGroup: 'FPWeb', includeEpisodeTitle: false })
  internal.probes.set(701, { provider: 'youku', qualities, audios })
  internal.plutofish.view = () => structuredClone(view)
  internal.plutofish.assertReady = () => {}
  internal.plutofish.request = async (_binding: unknown, path: string, body: { page: number; seasonNumber?: number }) => {
    assert.equal(path, 'releases/query')
    const snapshot = structuredClone(items.filter(item => (item.seasonNumber ?? 1) === body.seasonNumber)), reject = fail, timeout = queryDelay
    await delay(timeout)
    if (reject) throw new Error('PlutoFish 版本查询失败（HTTP 503）')
    return { items: snapshot, total: snapshot.length, page: body.page, pageSize: 100 }
  }
  // 验证主进程入队校验，下载和上传后台不会启动。
  internal.gatewayAccountFor = () => undefined
  internal.client = () => ({ fixedAccount: () => ({}) })
  internal.hub.enqueue = () => {}
  internal.publications.register = () => {}
  internal.resolveFilenameTitle = async () => {}
  const req: EnqueueRequest = { token: 701, detail: { provider: 'youku', id: 'fixture-show', title: '山海回声', year: 2026, kind: 'show', poster: '' },
    episodes: [{ vid: 'e3', number: 3, title: '第三集', group: '', languages: [] }], quality: 0, audioIds: ['aac'], tmdb: null, publication: { category: 'anime' } }
  const matched = await core.publicationReleases(req)
  assert.ok(matched.name.endsWith('-FPWeb'))
  assert.equal(matched.matchedId, id)
  assert.equal(await core.enqueue({ ...req, publication: { category: 'anime', releaseSelection: { context: matched.context, mode: 'existing', releaseId: id } } }), 1)
  assert.equal(core.jobList().at(-1)?.publication?.existingReleaseId, id)
  const specialId = 'c'.repeat(32)
  const specialOption: ReleaseOption = { ...option, id: specialId, seasonNumber: 0, name: 'S00.360p.YK.WEB-DL.H265.DDP.5.1-WF' }
  items = [option, specialOption]
  const withSpecials = await core.publicationReleases(req)
  assert.deepEqual(withSpecials.items.map(item => item.seasonNumber), [1, 0])
  await assert.rejects(() => core!.enqueue({ ...req, publication: { category: 'anime', releaseSelection: { context: withSpecials.context, mode: 'existing', releaseId: specialId } } }), /不可用/)
  const specialReq = { ...req, naming: { season: 0 } }
  const specialChoices = await core.publicationReleases(specialReq)
  assert.equal(await core.enqueue({ ...specialReq, publication: { category: 'anime', releaseSelection: { context: specialChoices.context, mode: 'existing', releaseId: specialId } } }), 1)
  assert.equal(core.jobList().at(-1)?.publication?.seasonNumber, 0)
  assert.equal(core.jobList().at(-1)?.publication?.existingReleaseId, specialId)
  assert.ok((await core.namingPreview(specialReq)).file.includes('.S00E03.'))
  items = []
  await assert.rejects(() => core!.enqueue(req), /后续集数/)
  const unmatched = await core.publicationReleases(req)
  const forced = { ...req, publication: { category: 'anime', releaseSelection: { context: unmatched.context, mode: 'new' as const } } }
  await core.enqueue(forced)
  const firstKey = core.jobList().at(-1)?.publication?.releaseKey
  await core.enqueue(forced)
  assert.notEqual(core.jobList().at(-1)?.publication?.releaseKey, firstKey)
  assert.equal(core.jobList().at(-1)?.publication?.existingReleaseId, undefined)
  const before = core.jobList().length
  await assert.rejects(() => core!.enqueue({ ...forced, naming: { season: 2 } }), /已改变/)
  assert.equal(core.jobList().length, before)

  // 尚公主：真实 Core 从腾讯数字 profile 生成不完整预览，唯一匹配 WF 并自动绑定入队。
  internal.cfg.releaseGroup = 'WF'
  const txQualities = qualitiesFromTencentFormats([{ name: 'maxplus', id: '123', profile: '4', width: 3840, height: 2160, vfps: 60, hdr: 'hdr' }])
  const txAudios = [{ id: 'ddp', lang: '国语', label: 'DDP', codec: 'E-AC-3', isDefault: true, selected: true }]
  internal.probes.set(702, { provider: 'tencent', qualities: txQualities, audios: txAudios })
  const wf: ReleaseOption = { id, name: 'S01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.DDP.5.1.H.265-WF', resolution: '2160p', dynamicRange: 'HDR10', status: 'published', latestEpisode: 10 }
  items = [wf, { ...wf, id: 'b'.repeat(32), name: 'S01.2160p.TX.WEB-DL.1.DDP5.HFR.VIVID.HDR.60fps.HEVC.DDP.5.1-PFWEB' },
    { ...wf, id: 'd'.repeat(32), name: 'S01.2160p.TX.WEB-DL.1.DDP5.HFR.SDR.60fps.HEVC.DDP.5.1-SalmonWeb', dynamicRange: 'SDR' }]
  const txReq: EnqueueRequest = { ...req, token: 702, detail: { ...req.detail, provider: 'tencent', title: '尚公主' }, audioIds: ['ddp'],
    episodes: [{ vid: 'tx-e11', number: 11, title: '第十一集', group: '', languages: [] }] }
  const txMatch = await core.publicationReleases(txReq)
  assert.equal(txMatch.name, 'S01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.DDP-WF')
  assert.equal(txMatch.matchedId, id)
  assert.equal(txMatch.needsChoice, false)
  assert.equal(await core.enqueue(txReq), 1)
  assert.equal(core.jobList().at(-1)?.publication?.existingReleaseId, id)
  assert.equal(internal.jobs.get(core.jobList().at(-1)!.id).task.codec, '4') // 不用候选补造任务编码。
  items = [wf, { ...wf, id: 'b'.repeat(32), name: wf.name.replace('H.265', 'H.264') }]
  assert.equal((await core.publicationReleases(txReq)).needsChoice, true)
  await assert.rejects(() => core!.enqueue(txReq), /后续集数/)
  internal.cfg.releaseGroup = 'FPWeb'
  items = [option]

  ipcMain.handle('release-picker-smoke', (_event, method, request) => method === 'publicationReleases' ? core!.publicationReleases(request) : core!.namingPreview(request))
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
    .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
    .replace('snapshot,', "snapshot, setAutoUpload(value) { settings.plutofishAutoUpload = value; emit('state', state) },")
    .replace('const settings = {', `const settings = { ui: ${JSON.stringify({ ...DEFAULT_UI_PREFS, theme: 'light', motion: false })},`)
    .replace('Object.assign(settings, args[0]);', 'if (args[0].ui) args[0].ui = { ...settings.ui, ...args[0].ui }; Object.assign(settings, args[0]);')
    .replace('const state = {', `const state = { plutofish: ${JSON.stringify(view)},`)
    .replace("case 'publicationPreferences': return null", "case 'publicationPreferences': return { publication: { category: 'anime' }, tmdb: null }")
    .replace(/case 'namingPreview':[^\n]+/, "case 'namingPreview': case 'publicationReleases': return ipcRenderer.invoke('release-picker-smoke', method, args[0])")
  const start = preload.indexOf('const audios = '), end = preload.indexOf('let jobs = ')
  const qualityViews = qualities.map((q, index) => ({ ...q, index, stream: q.id, audios: audios.map(a => ({ ...a, embedded: false })) }))
  preload = preload.slice(0, start) + `const audios = ${JSON.stringify(audios)};\nconst qualities = ${JSON.stringify(qualityViews)};\n` + preload.slice(end)
  const preloadPath = join(output, 'preload.cjs')
  writeFileSync(preloadPath, preload)
  const errors: string[] = []
  for (const width of [1440, 760]) {
    items = [option]; fail = false
    win = new BrowserWindow({ width, height: 1100, useContentSize: true, show: false,
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `release-${width}` } })
    win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/i.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    const run = async (script: string) => {
      try { return await win!.webContents.executeJavaScript(script, true) }
      catch (error) { console.error('Renderer script:', script, errors); throw error }
    }
    const wait = async (script: string) => {
      const until = Date.now() + 10000
      while (Date.now() < until) { if (await run(`!!(${script})`)) return; await delay(80) }
      writeFileSync(join(output, `failure-${width}.json`), JSON.stringify({ script, errors, body: await run('document.body.innerText') }, null, 2))
      throw new Error(`Timeout: ${script}`)
    }
    const click = async (script: string) => { await wait(script); await run(`(${script}).click()`); await delay(100) }
    const button = 'Array.from(document.querySelectorAll("button")).find(e => e.textContent.includes("开始下载"))'
    const refresh = 'document.querySelector(".release-heading button")'
    await win.loadFile(resolve('out/renderer/index.html'))
    await wait('window.__uiFlowFixture.snapshot().ready')
    await wait('document.querySelector("input[type=search]")')
    await run('(() => { const e = document.querySelector("input[type=search]"); e.value="山海回声"; e.dispatchEvent(new Event("input",{bubbles:true})); e.form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); })()')
    await click(`document.querySelector('button[aria-label="打开 山海回声"]')`)
    await click(`document.querySelector('button[aria-label^="第 1 集"]')`)
    await click('Array.from(document.querySelectorAll("main button")).find(e => e.textContent.trim() === "选画质")')
    await wait(`document.querySelector('input[name="publication-release"]:checked')?.value === '${id}'`)
    await wait(`!(${button}).disabled`)
    await run('document.querySelector(".publication-card").scrollIntoView({block:"start"})')
    await delay(150)
    writeFileSync(join(output, `matched-${width}.png`), (await win.webContents.capturePage()).toPNG())

    items = []
    await click(refresh)
    await wait('document.querySelector(".release-option input:checked")?.value === ""')
    await wait(`!(${button}).disabled`)
    await run('document.querySelectorAll(".publication-fields details").forEach(e => e.open=true)')
    await run('(() => { const e=document.querySelector(".episode input"); e.value="3"; e.dispatchEvent(new Event("input",{bubbles:true})); })()')
    await wait('document.querySelector(".release-warning")')
    assert.equal(await run(`(${button}).disabled`), true)
    await click('document.querySelector("input[name=publication-release][value=new]")')
    await wait(`!(${button}).disabled`)
    await run('document.querySelector(".publication-card").scrollIntoView({block:"start"})')
    await delay(150)
    writeFileSync(join(output, `unmatched-${width}.png`), (await win.webContents.capturePage()).toPNG())

    // 两个相同规格候选不默认勾选，但用户可手动归入其中一个。
    items = [option, { ...option, id: 'b'.repeat(32), name: 'S01.360p.YOUKU.WEB-DL.SDR.HEVC.AAC.2.0-FPWeb' }]
    await click(refresh)
    await wait('document.querySelectorAll("input[name=publication-release]").length === 3')
    assert.equal(await run('document.querySelector("input[name=publication-release]:checked")'), null)
    await click(`document.querySelector('input[name="publication-release"][value="${id}"]')`)
    await wait(`!(${button}).disabled`)
    fail = true
    await click(refresh)
    await wait('document.querySelector(".release-picker .err")')
    assert.equal(await run(`(${button}).disabled`), true)
    fail = false
    items = [option]
    await click(refresh)
    await wait(`document.querySelector('input[name="publication-release"]:checked')?.value === '${id}'`)
    // 旧慢查询不得覆盖新季的结果。
    queryDelay = 600
    await click(refresh)
    items = []; queryDelay = 0
    await run('(() => { const e=document.querySelector("#manual-season"); e.value="2"; e.dispatchEvent(new Event("input",{bubbles:true})); })()')
    await wait('document.querySelector(".release-warning")')
    await delay(700)
    assert.equal(await run('document.querySelectorAll("input[name=publication-release]").length'), 1)
    // S00 appears alongside the current season. Choosing it refreshes the context,
    // preserves the explicit choice even when technical specs differ, and renames to S00.
    items = [option, specialOption]
    await click(refresh)
    await wait(`document.querySelector('input[name="publication-release"][value="${specialId}"]')`)
    await click(`document.querySelector('input[name="publication-release"][value="${specialId}"]')`)
    await wait(`document.querySelector('input[name="publication-release"]:checked')?.value === '${specialId}'`)
    await wait('document.querySelector("#manual-season")?.value === "0"')
    await wait('document.body.innerText.includes("S00E03")')
    await wait(`!(${button}).disabled`)
    writeFileSync(join(output, `special-${width}.png`), (await win.webContents.capturePage()).toPNG())
    // The same page reacts to the global switch without requiring classification or release lookup.
    await run('window.__uiFlowFixture.setAutoUpload(false)')
    await wait('!document.querySelector(".publication-fields") && !document.querySelector(".release-picker")')
    await wait(`!(${button}).disabled`)
    const releaseReads = await run('window.__uiFlowFixture.snapshot().calls.filter(call => call.method === "publicationReleases").length')
    await delay(400)
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(call => call.method === "publicationReleases").length'), releaseReads)
    writeFileSync(join(output, `local-${width}.png`), (await win.webContents.capturePage()).toPNG())
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
    await click(button)
    await wait('window.__uiFlowFixture.snapshot().calls.some(call => call.method === "enqueue")')
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.find(call => call.method === "enqueue").args[0].publication'), undefined)
    win.destroy(); win = undefined
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real Core matches the sparse Tencent WF preview, rejects ambiguous codecs and unmatched/stale selections, preserves existing choice, isolates forced batches; renderer checks sparse-preview default, first/later episodes, manual selection, force new, failures, stale responses and 1440/760px layout')
}

void main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  win?.destroy()
  if (core) { await core.shutdown(); core.dispose() }
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
