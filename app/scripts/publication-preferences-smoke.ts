// Production Core, subscription scheduler and renderer, isolated profile + local fixtures only.
import { app, BrowserWindow, ipcMain, session } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { SubscriptionManager } from '../src/main/subscriptions'
import { DEFAULT_UI_PREFS } from '../src/shared/ui-prefs'
import { GwClient } from '../../src/lib/client'
import { publicationPreferencesPath } from '../../src/integrations/plutofish/publication-preferences'
import type { DetailView, EnqueueRequest, PublicationContext, PlutoFishView } from '../src/shared/api'
import type { DlTask } from '../../src/lib/jobs'

const profile = mkdtempSync(join(tmpdir(), 'gvs-preferences-smoke-'))
process.env.APPDATA = profile
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const output = resolve('../.build/publication-preferences')
mkdirSync(output, { recursive: true })
let identity: NonNullable<PlutoFishView['identity']> = { id: 'publisher', name: '测试发布端', kind: 'publisher',
  sourceAccount: { id: 'source', alias: 'main', name: '测试源账号' }, categories: [{ value: 'tv', label: '电视剧' }] }
const directory = { category: 'tv', directoryId: '9007199254740993', directoryPath: '/电视剧/此处通往繁星' }
let createdPage: any, failCreate = true
const createRequests: Array<{ directoryId: string; segments: string[] }> = []
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/publisher/directories/create') {
    let raw = ''; for await (const part of req) raw += part
    const input = JSON.parse(raw); createRequests.push(input)
    assert.equal(input.directoryId, '0')
    assert.equal(req.headers.authorization, 'Bearer fixture-only')
    if (failCreate) { failCreate = false; res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'CLOUD_DIRECTORY_CREATE_FAILED' } })); return }
    createdPage = { sourceAccountId: 'source', path: [{ id: '0', name: '根目录' }, ...input.segments.map((name: string, i: number) => ({ id: '900719925474099' + (6 + i), name }))], items: [], nextCursor: '' }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(createdPage)); return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  if (req.url === '/api/v1/publisher/me') { res.end(JSON.stringify(identity)); return }
  if (req.url === '/api/v1/publisher/directories') {
    let raw = ''; for await (const part of req) raw += part
    const input = JSON.parse(raw), root = input.directoryId === '0'
    if (createdPage?.path.at(-1)?.id === input.directoryId) { res.end(JSON.stringify(createdPage)); return }
    res.end(JSON.stringify({ sourceAccountId: 'source', path: [{ id: '0', name: '根目录' },
      ...(!root ? [{ id: '10', name: '电视剧' }, { id: directory.directoryId, name: '此处通往繁星' }] : [])],
      items: root ? [{ id: directory.directoryId, name: '此处通往繁星' }] : [], nextCursor: '' }))
    return
  }
  assert.equal(req.url, '/api/v1/publisher/tasks/report')
  res.end(JSON.stringify({ outcome: 'applied' }))
})
let core: Core | undefined, win: BrowserWindow | undefined
let manager: SubscriptionManager
const queued: DlTask[] = []
const episode = (number: number) => ({ vid: `ep${number}`, title: `第${number}集`, number, group: '', duration: 60, languages: [] })
const request: EnqueueRequest = { token: 701, detail: { provider: 'youku', id: 'show', title: '此处通往繁星', year: 2026, kind: 'show', poster: '' },
  episodes: [episode(1)], quality: 0, audioIds: [], tmdb: { id: 296203, kind: 'show', name: '此处通往繁星', title: '此处通往繁星', year: 2026, overview: '' },
  tmdbSeason: 0, publication: { ...directory, episodeNumbers: { ep1: 99 } } }
const context: PublicationContext = { provider: 'youku', sourceWorkId: 'show', kind: 'show' }
const quality = (height: number) => ({ id: `${height}p`, index: 0, label: height === 2160 ? '4K' : '1080P', title: '', stream: `${height}p`,
  width: height * 16 / 9, height, codec: 'hevc', size: 0, drm: '', hdr: '', fps: 25, audios: [] })
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await app.whenReady()
  session.defaultSession.protocol.handle('https', req => {
    const id = Number(new URL(req.url).pathname.match(/tv\/(\d+)\/translations/)?.[1])
    assert.ok([296203, 296204].includes(id))
    return Response.json({ id, translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { name: 'The Road to the Stars' } },
    ] })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  async function create() {
    const value = new Core({ state: () => {}, jobs: () => {}, toast: () => {} }), internal = value as any
    await value.plutofish.verify({ url, key: 'fixture-only' })
    internal.cfg.tmdbKey = 'fixture-only'
    internal.cli = new GwClient(url, 'fixture-only'); internal.keyInfo = { id: 'fixture', all: true }
    internal.probes.set(701, { provider: 'youku', qualities: [quality(1080)], audios: [] })
    internal.hub.enqueue = (_cfg: unknown, _client: unknown, _id: number, task: DlTask) => queued.push(task)
    return value
  }
  core = await create()
  assert.equal(await core.enqueue(request), 1)
  assert.equal(queued[0]!.episode, 99)
  assert.equal(queued[0]!.filenameTitle, 'The Road to the Stars')
  await core.shutdown(); core.dispose()
  // Simulate an upgrade from the old task-only format: migrate existing episode 1.
  rmSync(publicationPreferencesPath())
  core = await create()
  assert.deepEqual(core.publicationPreferences(context)!.publication, directory)
  assert.equal([...(core as any).jobs.values()][0].task.filenameTitle, 'The Road to the Stars')
  assert.equal(await core.enqueue({ ...request, publication: undefined, tmdb: null, tmdbSeason: undefined, episodes: [episode(2)] }), 1)
  const second = queued.at(-1)!
  assert.equal(second.publication!.directoryId, directory.directoryId)
  assert.equal(second.tmdbId, 296203); assert.equal(second.season, 0); assert.equal(second.episode, 2)
  const secondKey = second.publication!.fileKey

  const manualNaming = { title: 'Remembered English Name', year: 2024, season: 0 }
  core.savePublicationPreferences({ ...context, tmdb: request.tmdb, tmdbSeason: 0, naming: manualNaming }, directory)
  let episodeCount = 2, height = 1080, savedSubscriptions = ''
  manager = new SubscriptionManager({
    detail: async () => ({ ...request.detail, episodeCount: 99, episodes: Array.from({ length: episodeCount }, (_, i) => episode(i + 1)),
      tags: [], score: '', vip: false, drm: '', pickNoun: '集', desc: '', category: '' }) as DetailView,
    probe: async () => {
      ;(core as any).probes.set(701, { provider: 'youku', qualities: [quality(height)], audios: [] })
      return { token: 701, qualities: [quality(height)], audios: [], vip: null, warning: '' }
    },
    enqueue: r => core!.enqueue(r), notify: () => {}, changed: () => {}, load: () => savedSubscriptions || null,
    save: value => { savedSubscriptions = value },
  })
  const subscription = manager.subscribe({ provider: 'youku', showId: 'show', title: '此处通往繁星', poster: '', kind: 'show', rules: '4K > any', upgrade: true })
  await manager.checkNow(subscription.id)
  const before = queued.length
  episodeCount = 3
  await manager.checkNow(subscription.id)
  assert.equal(queued.length, before + 1)
  assert.equal(queued.at(-1)!.episode, 3)
  assert.equal(queued.at(-1)!.filenameTitle, manualNaming.title)
  assert.equal(queued.at(-1)!.year, 2024)
  assert.equal(queued.at(-1)!.season, 0)
  assert.equal(queued.at(-1)!.publication!.directoryId, directory.directoryId)
  const nextDirectory = { ...directory, directoryId: '42', directoryPath: '/新目录' }
  core.savePublicationPreferences({ ...context, tmdb: request.tmdb, tmdbSeason: 0 }, nextDirectory)
  height = 2160
  await manager.checkNow(subscription.id)
  assert.equal(queued.length, before + 2, '洗版应该创建新任务')
  assert.equal(queued.at(-1)!.publication!.directoryId, '42')
  assert.equal(second.publication!.directoryId, directory.directoryId)
  assert.equal(second.publication!.fileKey, secondKey)
  await core.shutdown(); core.dispose(); core = await create()
  assert.equal(core.publicationPreferences(context)!.publication.directoryId, '42', '历史任务不能覆盖后来保存的设置')
  identity = { ...identity, sourceAccount: { ...identity.sourceAccount!, id: 'other' } }
  await core.plutofish.verify({ url, key: 'fixture-only' })

  ;(core as any).probes.set(701, { provider: 'youku', qualities: [quality(1080)], audios: [
    { id: 'zh-aac', lang: '国语', label: 'AAC 立体声', codec: 'AAC', isDefault: true },
    { id: 'zh-eac3', lang: '国语', label: '杜比全景声', codec: 'E-AC-3' },
    { id: 'zh-dts', lang: '国语', label: 'DTS 5.1', codec: 'DTS' },
    { id: 'yue-aac', lang: '粤语', label: 'AAC 立体声', codec: 'AAC' },
    { id: 'en-aac', lang: '英语', label: 'AAC 立体声', codec: 'AAC' },
  ] })
  assert.equal(core.publicationPreferences(context), null)
  identity = { ...identity, sourceAccount: { ...identity.sourceAccount!, id: 'source' } }
  await core.plutofish.verify({ url, key: 'fixture-only' })

  ipcMain.handle('publication-preferences-smoke', async (_event, method, ...args) => {
    if (method === 'publicationPreferences') return core!.publicationPreferences(args[0])
    if (method === 'savePublicationPreferences') return core!.savePublicationPreferences(args[0], args[1])
    if (method === 'createPublisherDirectories') return core!.plutofish.createDirectories(args[0], args[1], args[2])
    if (method === 'publisherDirectories') return core!.plutofish.directories(args[0], args[1], args[2])
    if (method === 'namingPreview') return core!.namingPreview({ ...args[0], token: 701 })
    if (method === 'subscriptions') return manager.view()
    if (method === 'subscribe') return manager.subscribe(args[0])
    if (method === 'updateSubscription') return manager.update(args[0], args[1])
    throw new Error(`Unexpected IPC: ${method}`)
  })
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
    .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
    .replace("const title = '山海回声'", "const title = '此处通往繁星'")
    .replace('const settings = {', `const settings = { ui: ${JSON.stringify({ ...DEFAULT_UI_PREFS, theme: 'light', motion: false })},`)
    .replace('Object.assign(settings, args[0]);', 'if (args[0].ui) args[0].ui = { ...settings.ui, ...args[0].ui }; Object.assign(settings, args[0]);')
    .replace('const cards = ', `state.plutofish = ${JSON.stringify(core.plutofish.view())};\nconst cards = `)
    .replace('let nextProbeDelay = 180', 'let nextProbeDelay = 180; let probeToken = 700')
    .replace('return { token: 701,', 'return { token: ++probeToken,')
  for (const method of ['publicationPreferences', 'savePublicationPreferences', 'namingPreview']) {
    preload = preload.replace(new RegExp(`case '${method}':[^\\n]+`), `case '${method}': return ipcRenderer.invoke('publication-preferences-smoke', method, ...args)`)
  }
  preload = preload.replace('switch (method) {', `switch (method) {
    case 'createPublisherDirectories': case 'publisherDirectories': case 'subscriptions': return ipcRenderer.invoke('publication-preferences-smoke', method, ...args)
    case 'subscribe': case 'updateSubscription': {
      const result = await ipcRenderer.invoke('publication-preferences-smoke', method, ...args)
      emit('subs', await ipcRenderer.invoke('publication-preferences-smoke', 'subscriptions'))
      return result
    }
    case 'tmdbSeasons': return { seasons: [], warning: '' }
  `)
  const preloadPath = join(output, 'preload.cjs'); writeFileSync(preloadPath, preload)
  const errors: string[] = []
  const dom = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
  const run = (script: string) => win!.webContents.executeJavaScript(script)
  async function wait(script: string) {
    const until = Date.now() + 12000
    while (Date.now() < until) { if (await run(`!!(${script})`)) return; await delay(60) }
    writeFileSync(join(output, 'failure.json'), JSON.stringify({ script, errors, body: await run('document.body.innerText'), calls: await run('window.__uiFlowFixture.snapshot().calls') }, null, 2))
    throw new Error(`Timeout: ${script}`)
  }
  async function click(selector: string) { await wait(`document.querySelector(${JSON.stringify(selector)})`); await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(80) }
  async function clickText(text: string, within = 'main') {
    const selector = `Array.from(document.querySelectorAll(${JSON.stringify(within + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(text)})`
    await wait(selector); await run(`(${selector}).click()`); await delay(80)
  }
  async function openEpisode(number: number) {
    win = new BrowserWindow({ width: 1040, height: 900, useContentSize: true, show: false,
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
    win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/i.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    await win.loadFile(resolve(process.env.GVS_SMOKE_RENDERER || 'out/renderer/index.html'))
    await wait('window.__uiFlowFixture.snapshot().ready')
    await wait('document.querySelector("input[type=search]")')
    await run('(() => { const input = document.querySelector("input[type=search]"); input.value = "此处通往繁星"; input.dispatchEvent(new Event("input", { bubbles: true })); input.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()')
    await click('button[aria-label="打开 此处通往繁星"]')
    await click(`button[aria-label^="第 ${number} 集"]`)
    await clickText('选画质')
    await wait('document.querySelector(".publication-fields select:not(:disabled)")')
    await run('document.querySelectorAll("details").forEach(e => e.open = true)')
  }
  await openEpisode(1)
  await run('(() => { const el = document.querySelector(".publication-fields select"); el.value = "tv"; el.dispatchEvent(new Event("change", { bubbles: true })); })()')
  await clickText('选择目录')
  await clickText('此处通往繁星', '.directory-dialog')
  await clickText('选择此目录', '.directory-dialog')
  await wait('document.querySelector(".directory-value span").textContent === "/电视剧/此处通往繁星"')
  const lastContext = await run('window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "savePublicationPreferences").at(-1)?.args[0]')
  assert.ok(lastContext, '选择目录必须调用保存接口')
  const uiContext: PublicationContext = { provider: lastContext.provider, sourceWorkId: lastContext.sourceWorkId, kind: lastContext.kind }
  await delay(100)
  assert.deepEqual(core.publicationPreferences(uiContext)!.publication, directory)
  // Manual match promotes the platform preference; the selected directory must survive.
  await run(`(() => { const el = ${dom('input[aria-label="TMDB ID"]')}; el.value = "296204"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`)
  await clickText('采用')
  await wait('document.querySelector(".directory-value span").textContent === "/电视剧/此处通往繁星"')
  await wait('document.querySelector("#output-title:not(:disabled)")')
  await run(`(() => { for (const [selector, value] of [['#output-title', 'UI English Override'], ['#output-year', '2023'], ['#manual-season', '2']]) { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`)
  await wait('document.querySelector(".filename-preview code").textContent.startsWith("UI.English.Override.2023.S02E01.")')
  await clickText('订阅追更')
  await delay(100)
  assert.equal(core.publicationPreferences(uiContext)!.tmdb!.id, 296204)
  win.destroy(); win = undefined
  await openEpisode(2)
  await wait('document.querySelector(".publication-fields select").value === "tv" && document.querySelector(".directory-value span").textContent === "/电视剧/此处通往繁星"')
  await wait('document.querySelector(".filename-preview code").textContent.startsWith("UI.English.Override.2023.S02E02.")')
  assert.equal(await run('document.querySelector(".publication-fields").textContent.includes("TMDB 296204")'), true)
  await run('document.querySelector(".publication-fields").scrollIntoView({ block: "center" })')
  writeFileSync(join(output, 'restored-episode-2.png'), (await win.webContents.capturePage()).toPNG())
  await click('.nav button[aria-label="订阅"]')
  await click('button[aria-label="编辑"]')
  await wait(`${dom('[aria-label="编辑订阅"] .directory-value span')}?.textContent === "/电视剧/此处通往繁星"`)
  await run(`(() => { const el = ${dom('[aria-label="编辑订阅"] .publication-fields select')}; el.value = ""; el.dispatchEvent(new Event("change", { bubbles: true })); })()`)
  await wait(`Array.from(document.querySelectorAll('[aria-label="编辑订阅"] button')).find(e => e.textContent.trim() === '保存')?.disabled`)
  await clickText('取消', '[aria-label="编辑订阅"]')
  assert.equal(core.publicationPreferences(uiContext)!.publication.category, 'tv', '取消订阅编辑不能修改偏好')
  await click('button[aria-label="编辑"]')
  await wait(dom('[aria-label="编辑订阅"] .publication-fields select:not(:disabled)'))
  await clickText('选择目录', '[aria-label="编辑订阅"]')
  await clickText('根目录', '.directory-dialog')
  await clickText('选择此目录', '.directory-dialog')
  await clickText('保存', '[aria-label="编辑订阅"]')
  await wait(`!${dom('[aria-label="编辑订阅"]')}`)
  assert.equal(core.publicationPreferences(uiContext)!.publication.directoryId, '0')
  assert.deepEqual(core.publicationPreferences(uiContext)!.naming, { title: 'UI English Override', year: 2023, season: 2 })
  win.destroy(); win = undefined
  await openEpisode(3)
  await wait('document.querySelector(".filename-preview code").textContent.startsWith("UI.English.Override.2023.S02E03.")')
  await clickText('选择目录')
  await wait('document.querySelector(".create-output .output-folders")?.textContent.includes("Season 02")')
  const expectedFolders = ['此处通往繁星 (2023) {tmdb-296204}', 'Season 02']
  assert.equal(await run('document.querySelector(".output-folders").textContent'), expectedFolders.join(' / '))
  await run('document.fonts.ready.then(() => true)')
  writeFileSync(join(output, 'create-directory-desktop.png'), (await win.webContents.capturePage()).toPNG())
  win.setContentSize(760, 820)
  await delay(120)
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
  writeFileSync(join(output, 'create-directory-narrow.png'), (await win.webContents.capturePage()).toPNG())
  await clickText('创建并选择', '.directory-dialog')
  await wait('document.querySelector(".create-output [role=alert]")')
  assert.equal(createRequests.length, 1, '创建失败不能自动重试')
  assert.equal(core.publicationPreferences(uiContext)!.publication.directoryId, '0', '失败不能覆盖已选目录')
  await clickText('创建并选择', '.directory-dialog')
  await wait('!document.querySelector(".directory-dialog")')
  await wait('document.querySelector(".directory-value span").textContent.includes("Season 02")')
  assert.deepEqual(createRequests.map(r => r.segments), [expectedFolders, expectedFolders])
  assert.equal(core.publicationPreferences(uiContext)!.publication.directoryId, '9007199254740997')
  assert.equal(core.publicationPreferences(uiContext)!.publication.directoryPath, '/' + expectedFolders.join('/'))
  await clickText('选择目录')
  await wait('document.querySelector(".create-output").textContent.includes("当前目录已匹配")')
  assert.equal(await run('!!Array.from(document.querySelectorAll(".directory-dialog button")).find(e => e.textContent.trim() === "创建并选择")'), false)
  await clickText('取消', '.directory-dialog')
  assert.equal(createRequests.length, 2)
  assert.deepEqual(errors, [])
  assert.ok(queued.length >= 4 && queued.slice(2).every(t => t.filenameTitle === manualNaming.title && t.year === 2024))
  console.log('PASS: old-task migration, restart, E2 numbering, subscription new episodes/upgrades, account isolation, renderer refill, subscription save/cancel, create directory preview/retry/persistence/reopen')
}

void main().catch(async error => {
  if (win) writeFileSync(join(output, 'failure-state.json'), JSON.stringify(await win.webContents.executeJavaScript('({ body: document.body.innerText, fixture: window.__uiFlowFixture.snapshot() })'), null, 2))
  console.error(error); process.exitCode = 1
}).finally(async () => {
  win?.destroy(); manager?.stop()
  if (core) { await core.shutdown(); core.dispose() }
  server.close(); rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
