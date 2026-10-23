/** 隔离 Core 合约验证；--interactive 打开真实渲染页面供界面验收，不自动操作 UI。 */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { GwClient } from '../../src/lib/client'
import { DEFAULT_UI_PREFS } from '../src/shared/ui-prefs'
import type { Recognition, EnqueueRequest } from '../src/shared/api'

const profile = mkdtempSync(join(tmpdir(), 'gvs-recognition-'))
process.env.APPDATA = profile
app.setPath('userData', profile); app.setName('GVS 识别验证'); app.disableHardwareAcceleration()
const output = resolve('../.build/recognition'); mkdirSync(output, { recursive: true })
const requests: Array<{ path: string; body: any }> = []
const sources = [{ id: 'first', alias: 'default', name: '默认账号', provider: '115' }, { id: 'second', alias: 'selected', name: '第二账号', provider: '115' }]
function result(fileName: string): Recognition {
  const work = { tmdbId: '123', mediaType: 'tv' as const, title: '星海纪行', originalTitle: 'Stars', englishTitle: 'Stars', year: 2024, posterUrl: '', category: { name: '动画番剧', value: 'anime', label: '动画番剧', status: 'matched' as const } }
  return { status: fileName.includes('Ambiguous') ? 'ambiguous' : 'compatible', canAutoFill: !fileName.includes('Ambiguous'), reasons: [], truncated: false, selectionBasis: '', parsed: { title: 'Stars', mediaType: 'tv', seasonNumber: 2, episodeNumber: 3, resolution: '1080p', source: 'WEB-DL', warnings: [] }, work, workTarget: fileName.includes('Ambiguous') ? null : { tmdbId: '123', mediaType: 'tv', category: 'anime' }, candidates: [{ work, conflicts: [] }] }
}
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}, path = req.url!
  requests.push({ path, body }); writeFileSync(join(output, 'requests.json'), JSON.stringify(requests, null, 2))
  if (path.endsWith('/me')) return void res.end(JSON.stringify({ id: 'p', name: '隔离识别测试', kind: 'publisher', sourceAccount: sources[0], sourceAccounts: sources, categories: [{ value: 'manual', label: '手动分类' }, { value: 'anime', label: '动画番剧' }], capabilities: { uploadClientGrouping: true } }))
  if (path.endsWith('/tmdb/recognize')) {
    assert.equal(req.headers.authorization, 'Bearer test-only')
    if (body.fileName.includes('Slow')) await new Promise(r => setTimeout(r, 5000))
    if (body.fileName.includes('Old')) { res.writeHead(404); return void res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } })) }
    return void res.end(JSON.stringify(result(body.fileName)))
  }
  if (path.endsWith('/releases/query')) return void res.end(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100, match: 'none' }))
  if (path.endsWith('/range-proofs/pending')) return void res.end(JSON.stringify({ jobs: [] }))
  if (path.endsWith('/tasks/report')) return void res.end(JSON.stringify({ outcome: 'applied' }))
  res.writeHead(500); res.end('unexpected test request')
})
let core: Core, win: BrowserWindow
async function main() {
  await app.whenReady(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  core = new Core({ state: () => {}, jobs: () => {}, toast: () => {} })
  const internal = core as any
  internal.cfg.tmdbKey = ''; internal.cfg.outDir = join(profile, 'downloads')
  internal.cli = new GwClient(url, 'test-only'); internal.keyInfo = { id: 'fixture', all: true }
  await core.plutofish.verify({ url, key: 'test-only' })
  internal.probes.set(701, { provider: 'youku', qualities: [{ id: '1080p', index: 0, label: '1080P', title: '', stream: '1080p', width: 1920, height: 1080, codec: 'hevc', size: 0, drm: '', hdr: '', fps: 25, audios: [] }], audios: [] })
  const queued: any[] = []; internal.hub.enqueue = (_cfg: unknown, _cli: unknown, _id: unknown, task: unknown) => queued.push(task)
  const recognized = await core.recognizePublication('second', 'Stars.S02E03.mkv')
  assert.equal(recognized.workTarget?.category, 'anime'); assert.equal(requests.at(-1)?.body.sourceAccount, 'selected')
  const req: EnqueueRequest = { token: 701, detail: { provider: 'youku', id: 'core-contract', title: '星海纪行', year: 2024, kind: 'show', poster: '' }, episodes: [{ vid: 'ep3', title: '第三集', number: 3, group: '', duration: 60, languages: [] }], quality: 0, audioIds: [], tmdb: { id: 123, kind: 'show', name: '星海纪行', title: 'Stars', year: 2024, overview: '' }, naming: { title: 'Stars', season: 2 }, publication: { category: 'anime', sourceAccountId: 'second', directoryId: '0', directoryPath: '/' } }
  req.publication!.releaseSelection = { mode: 'new', context: (await core.publicationReleases(req)).context }
  assert.equal(await core.enqueue(req), 1)
  assert.equal(queued[0].tmdbId, 123); assert.equal(queued[0].season, 2); assert.equal(queued[0].episode, 3)
  assert.equal(queued[0].publication.binding.sourceAccount.id, 'second'); assert.equal(queued[0].publication.workTarget.category, 'anime')
  assert.equal(core.publicationPreferences({ provider: 'youku', sourceWorkId: 'core-contract', kind: 'show', sourceAccountId: 'second' })?.tmdb?.id, 123)
  assert.match((await core.namingPreview(req)).file, /Stars.*S02E03/)
  assert.equal(await core.recognizePublication('second', 'Ambiguous.mkv').then(r => r.canAutoFill), false)
  await assert.rejects(core.recognizePublication('second', 'Old.mkv'), /尚不支持/)
  assert.equal(core.plutofish.ready, true)
  console.log('Core 识别、第二账号、作品/分类/季号入队、偏好回读、歧义与旧服务回退验证通过')
  if (!process.argv.includes('--interactive')) return void app.quit()
  ipcMain.handle('recognition-fixture', async (_event, method, ...args) => {
    if (method === 'recognizePublication') return core.recognizePublication(args[0], args[1])
    if (method === 'publicationPreferences') return core.publicationPreferences(args[0])
    if (method === 'savePublicationPreferences') return core.savePublicationPreferences(args[0], args[1])
    if (method === 'refreshPublicationCategories') return core.plutofish.view()
    if (method === 'namingPreview') return core.namingPreview({ ...args[0], token: 701, quality: 0 })
    if (method === 'publicationReleases') return core.publicationReleases({ ...args[0], token: 701, quality: 0 })
    if (method === 'enqueue') return core.enqueue({ ...args[0], token: 701, quality: 0 })
    throw new Error(`Unexpected test IPC ${method}`)
  })
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
    .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
    .replace('const settings = {', `const settings = { ui: ${JSON.stringify({ ...DEFAULT_UI_PREFS, theme: process.argv.includes('--narrow-dark') ? 'dark' : 'light', motion: false })},`)
    .replace('const cards = ', `state.plutofish = ${JSON.stringify(core.plutofish.view())};\nconst cards = `)
  for (const method of ['publicationPreferences', 'savePublicationPreferences', 'namingPreview', 'publicationReleases', 'enqueue']) {
    preload = preload.replace(new RegExp(`case '${method}':`), `case '${method}': return ipcRenderer.invoke('recognition-fixture', method, ...args);\ncase 'unused-${method}':`)
  }
  preload = preload.replace('switch (method) {', "switch (method) {\ncase 'publicationReleases': case 'recognizePublication': case 'refreshPublicationCategories': return ipcRenderer.invoke('recognition-fixture', method, ...args);")
  const preloadPath = join(output, 'preload.cjs'); writeFileSync(preloadPath, preload)
  win = new BrowserWindow({ width: process.argv.includes('--narrow-dark') ? 1000 : 1280, height: process.argv.includes('--narrow-dark') ? 720 : 900, title: 'GVS 识别验证', webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^(https?|wss?):/i.test(details.url) }))
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
  await win.loadFile(resolve('out/renderer/index.html'))
  console.log('交互验收已就绪：Slow / Ambiguous / Old 文件名前缀分别模拟慢响应、歧义和旧服务')
}
main().catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => { core?.dispose(); server.closeAllConnections(); server.close(); rmSync(profile, { recursive: true, force: true }) })
