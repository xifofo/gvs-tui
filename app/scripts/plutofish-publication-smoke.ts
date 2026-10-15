/** 真实 Electron Core 的入队、完成和重启回归；网络、成品检测均为本地夹具，不下载媒体。 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { GwClient } from '../../src/lib/client'
import { publicationDirectory } from '../../src/integrations/plutofish/publication-store'
import { completePublication, preparePublication } from '../../src/integrations/plutofish/publication'
import type { EnqueueRequest } from '../src/shared/api'

const profile = mkdtempSync(join(tmpdir(), 'gvs-publication-core-'))
process.env.APPDATA = profile
app.setPath('userData', profile)
app.disableHardwareAcceleration()
let uploadStarts = 0, fileReports = 0, identityReads = 0
let identityCategories: Array<{ value: string; label: string }> | undefined = [{ value: 'anime', label: '动漫' }]
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/publisher/directories') {
    assert.equal(req.headers.authorization, 'Bearer fixture-only')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ sourceAccountId: 'source', path: [{ id: '0', name: '根目录' }, { id: '9007199254740993', name: '红果' }], items: [], nextCursor: '' }))
    return
  }
  if (req.url === '/api/v1/publisher/uploads/prepare') {
    let body = ''; for await (const chunk of req) body += chunk
    if (JSON.parse(body).action === 'start') uploadStarts++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ dispatch: { status: 'ready', fileId: 'fixture-file', pickCode: 'fixture-pick' } }))
    return
  }
  if (req.url === '/api/v1/publisher/files/report') {
    fileReports++
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ outcome: 'applied' })); return
  }
  if (req.url === '/api/v1/publisher/tasks/report') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ outcome: 'applied', dispatch: { status: 'uploading' } }))
    return
  }
  assert.equal(req.url, '/api/v1/publisher/me')
  identityReads++
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ id: 'publisher', name: '测试发布端', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: '测试源' }, categories: identityCategories }))
})
let core: Core | undefined
const request: EnqueueRequest = {
  token: 1, detail: { provider: 'youku', id: 'show', title: '测试剧集', year: 2026, kind: 'show', poster: '' },
  episodes: [1, 2].map(number => ({ vid: `ep${number}`, title: `第${number}集`, number, group: '', duration: 60, languages: [] })),
  quality: 0, audioIds: [], tmdb: { id: 123, name: '测试剧集', title: '测试剧集', year: 2026, overview: '', kind: 'show' }, tmdbSeason: 0,
  publication: { category: 'anime', directoryId: '9007199254740993', directoryPath: '/红果', episodeNumbers: { ep1: 0 } },
}

async function main() {
  await app.whenReady()
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let calls = 0
  async function create() {
    const value = new Core({ state: () => {}, jobs: () => {}, toast: () => {} })
    const internal = value as any
    await value.plutofish.verify({ url, key: 'fixture-only' })
    internal.cli = new GwClient(url, 'fixture-only')
    internal.keyInfo = { id: 'fixture', all: true }
    internal.probes.set(1, { provider: 'youku', qualities: [{ id: '4k', label: '4K', title: '4K', size: 0, width: 3840, height: 2160, codec: 'hevc', drm: '' }], audios: [] })
    internal.hub.enqueue = () => {
      ++calls
      const disk = JSON.parse(readFileSync(join(profile, 'jobs.json'), 'utf8'))
      assert.ok(disk.jobs.every((j: any) => j.task.publication?.fileKey))
    }
    return value
  }
  core = await create()
  identityCategories = undefined
  const readsBefore = identityReads
  const refreshed = await Promise.all([core.refreshPublicationCategories(), core.refreshPublicationCategories()])
  assert.equal(identityReads, readsBefore + 1, '同时请求分类应合并读取')
  assert.equal(refreshed[0].identity?.categories, undefined)
  await assert.rejects(() => core!.enqueue(request), /未返回资源分类/)
  identityCategories = [{ value: 'anime', label: '动漫' }]
  assert.deepEqual((await core.refreshPublicationCategories()).identity?.categories, identityCategories)
  assert.equal((await core.plutofish.directories('source', '9007199254740993')).path.at(-1)?.name, '红果')
  await assert.rejects(() => core!.enqueue({ ...request, publication: { category: 'disabled' } }), /分类/)
  await assert.rejects(() => core!.enqueue({ ...request, publication: { category: '' } }), /请选择|先选择/)
  assert.equal(calls, 0)
  assert.equal(await core.enqueue(request), 2)
  const before = core.jobList()
  assert.equal(before[0]!.publication!.directoryId, '9007199254740993')
  assert.equal(before[0]!.publication!.directoryPath, '/红果')
  assert.equal(before[0]!.publication!.releaseKey, before[1]!.publication!.releaseKey)
  assert.notEqual(before[0]!.publication!.fileKey, before[1]!.publication!.fileKey)
  assert.equal(before[0]!.publication!.episodeNumber, 0)
  assert.equal(before[0]!.publication!.seasonNumber, 0)
  const keys = before.map(j => j.publication!.fileKey)
  await core.shutdown(); core.dispose()
  core = await create()
  assert.deepEqual(core.jobList().map(j => j.publication!.fileKey), keys)
  assert.equal(core.jobList()[0]!.publication!.directoryPath, '/红果')
  assert.ok(core.jobList().every(j => j.state === 'paused'))
  await core.resumeJob(before[0]!.id)
  assert.equal(core.jobList()[0]!.publication!.fileKey, keys[0])
  ;(core as any).onJob({ id: before[0]!.id, status: '完成', pct: 1, log: '/tmp/fixture.mkv', err: '', done: true,
    completedMedia: { media: { status: 'probed', width: 1920, height: 1080, codec: 'h264' }, file: { size: 2048 } } })
  const completed = core.jobList()[0]!.publication!
  assert.equal(completed.measured!.media.height, 1080)
  assert.equal(completed.fileKey, keys[0])
  const manifest = readdirSync(publicationDirectory()).filter(p => p.endsWith('.json')).map(p => JSON.parse(readFileSync(join(publicationDirectory(), p), 'utf8'))).find(d => d.fileKey === keys[0])
  assert.equal(manifest.measured.media.height, 1080)
  await core.shutdown(); core.dispose()
  core = await create()
  assert.equal(core.jobList()[0]!.publication!.measured!.media.height, 1080)
  assert.equal(core.jobList()[0]!.state, 'done')
  core.clearFinished()
  assert.equal(core.jobList().length, 2, '尚未上传的成品必须保留操作入口')
  // 复现旧版允许无分类下载：重启后补全分类，沿用成品自动上传，不再调用下载器。
  const rec = (core as any).jobs.get(before[1]!.id)
  const output = join(profile, 'existing.mp4')
  writeFileSync(output, Buffer.alloc(2048, 1))
  const measured = { media: { status: 'probed' as const, width: 1920, height: 1080, codec: 'h264' }, file: { size: 2048 } }
  rec.task.publication = completePublication(preparePublication(rec.task, core.plutofish.view(), ''), output, measured)
  Object.assign(rec.view, { state: 'done', output, pct: 1, completedMedia: measured })
  ;(core as any).flushJobs(true)
  await core.shutdown(); core.dispose(); core = await create()
  assert.equal(core.jobList()[1]!.publication!.progress, undefined)
  core.clearFinished()
  assert.equal(core.jobList().length, 2, '未配置分类的成品不能被清除已完成移除')
  const downloadsBefore = calls
  await assert.rejects(() => core!.completePublicationSetup(before[1]!.id, ''), /分类/)
  await core.completePublicationSetup(before[1]!.id, 'anime')
  const deadline = Date.now() + 10000
  while (core.jobList()[1]!.publication!.progress?.stage !== 'completed' && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  assert.equal(core.jobList()[1]!.publication!.progress?.stage, 'completed')
  assert.equal(core.jobList()[1]!.publication!.progress?.uploadedBytes, 2048)
  assert.equal(core.jobList()[1]!.output, output)
  assert.equal(calls, downloadsBefore, '补全分类只能上传，不能重新下载')
  assert.equal(uploadStarts, 1)
  assert.equal(fileReports, 1)
  await assert.rejects(() => core!.completePublicationSetup(before[1]!.id, 'anime'), /已进入/)
  assert.equal(core.publicationPreferences({ provider: 'youku', sourceWorkId: 'show', kind: 'show' })?.publication.category, 'anime')
  const n = calls
  rmSync(join(profile, 'jobs.json')); mkdirSync(join(profile, 'jobs.json'))
  await assert.rejects(() => core!.enqueue(request), /任务保存失败/)
  assert.equal(calls, n)
  assert.equal(core.jobList().length, 2)
  console.log('PASS: Core validates required categories, restores incomplete downloads, uploads existing media automatically without re-downloading, remembers repaired settings, and preserves pending tasks')
}

void main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  if (core) { await core.shutdown(); core.dispose() }
  server.close()
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
