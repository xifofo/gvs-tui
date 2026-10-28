/** 真实 Electron Core 的入队、完成和重启回归；网络、成品检测均为本地夹具，不下载媒体。 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { GwClient } from '../../src/lib/client'
import { publicationDirectory } from '../../src/integrations/plutofish/publication-store'
import { completePublication, preparePublication } from '../../src/integrations/plutofish/publication'
import type { EnqueueRequest, JobView } from '../src/shared/api'

const profile = mkdtempSync(join(tmpdir(), 'gvs-publication-core-'))
process.env.APPDATA = profile
app.setPath('userData', profile)
app.disableHardwareAcceleration()
let uploadStarts = 0, fileReports = 0, identityReads = 0, releaseReads = 0
const uploadNames: string[] = [], reportedFiles: Array<{ name: string; episodeNumber?: number; releaseTarget: { seasonNumber?: number } }> = []
let identityCategories: Array<{ value: string; label: string }> | undefined = [{ value: 'anime', label: '动漫' }]
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/publisher/releases/query') {
    releaseReads++
    res.setHeader('content-type', 'application/json')
    const releaseId = 'a'.repeat(32)
    res.end(JSON.stringify({ items: [{ id: releaseId, name: '4K', resolution: '2160p', dynamicRange: 'sdr', status: 'draft' }],
      total: 1, page: 1, pageSize: 100, boundReleaseId: releaseId })); return
  }
  if (req.url === '/api/v1/publisher/range-proofs/pending') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ jobs: [] })); return
  }
  if (req.url === '/api/v1/publisher/files/ed2k') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ accepted: true })); return
  }
  if (req.url === '/api/v1/publisher/directories') {
    assert.equal(req.headers.authorization, 'Bearer fixture-only')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ sourceAccountId: 'source', path: [{ id: '0', name: '根目录' }, { id: '9007199254740993', name: '红果' }], items: [], nextCursor: '' }))
    return
  }
  if (req.url === '/api/v1/publisher/uploads/prepare') {
    let body = ''; for await (const chunk of req) body += chunk
    if (JSON.parse(body).action === 'start') { uploadStarts++; uploadNames.push(JSON.parse(body).name) }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ dispatch: { status: 'ready', fileId: 'fixture-file', pickCode: 'fixture-pick' } }))
    return
  }
  if (req.url === '/api/v1/publisher/files/report') {
    let body = ''; for await (const chunk of req) body += chunk
    reportedFiles.push(JSON.parse(body))
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
  const fullEvents: JobView[][] = [], patches: JobView[][] = []
  const settle = () => new Promise(resolve => setTimeout(resolve, 180))
  async function create() {
    const value = new Core({ state: () => {}, jobs: jobs => fullEvents.push(structuredClone(jobs)),
      jobPatch: jobs => patches.push(structuredClone(jobs)), toast: () => {} })
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
  await settle()
  assert.equal(core.jobList()[0]!.publication!.fileKey, keys[0])
  fullEvents.length = 0; patches.length = 0
  ;(core as any).onJob({ id: before[0]!.id, status: '完成', pct: 1, log: '/tmp/fixture.mkv', err: '', done: true,
    completedMedia: { media: { status: 'probed', width: 1920, height: 1080, codec: 'h264' }, file: { size: 2048 } } })
  const completed = core.jobList()[0]!.publication!
  await settle()
  assert.equal(fullEvents.length, 0, '下载完成只推送变化任务，不能重发所有历史记录')
  assert.ok(patches.length > 0)
  assert.ok(patches.every(jobs => jobs.length === 1 && jobs[0]!.id === before[0]!.id))
  assert.equal(patches.at(-1)![0]!.publication!.measured!.media.height, 1080)
  fullEvents.length = 0; patches.length = 0
  for (let i = 0; i < 30; i++) {
    const draft = structuredClone(completed)
    draft.progress = { ...draft.progress!, stage: 'uploading', phase: 'uploading', uploadPercent: i }
    ;(core as any).publications.changed(draft, true)
  }
  await settle()
  assert.equal(fullEvents.length, 0, '瞬时上传进度必须使用增量事件')
  assert.equal(patches.length, 1, '多个上传进度必须合并刷新')
  assert.equal(patches[0]![0]!.publication!.progress!.uploadPercent, 29)
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
  // Global OFF bypasses publication validation, stale hidden inputs and all release requests.
  await core.saveSettings({ plutofishAutoUpload: false })
  const readsBeforeLocal = releaseReads
  assert.equal(await core.enqueue({ ...request, publication: undefined }), 2)
  assert.equal(await core.enqueue({ ...request, publication: { category: 'disabled', directoryId: 'invalid', episodeNumbers: { ep1: 999 } } }), 2)
  assert.equal(releaseReads, readsBeforeLocal)
  const localJobs = core.jobList().slice(2)
  assert.equal(localJobs.length, 4)
  for (const job of localJobs) {
    assert.equal(job.publication!.workTarget.category, '')
    assert.equal(job.publication!.directoryId, '0')
    assert.equal(job.publication!.existingReleaseId, undefined)
  }
  assert.equal(localJobs[2]!.publication!.episodeNumber, 1, '隐藏的发布集号不能修改本地下载')
  assert.equal(localJobs[2]!.publication!.seasonNumber, 0, '显式本地命名季号 0 必须保留')
  const originalLocal = join(profile, 'Original.S00E01.mkv'), renamedLocal = join(profile, 'Natural.High.2023.S00E151.1080p.TX.WEB-DL.AVC-WF.mkv')
  writeFileSync(originalLocal, Buffer.alloc(2048, 3))
  ;(core as any).onJob({ id: localJobs[0]!.id, status: '完成', pct: 1, log: originalLocal, err: '', done: true, completedMedia: measured })
  core.probePublicationMedia = async () => measured.media
  const inspectedOnly = await core.inspectPublicationFile(localJobs[0]!.id, originalLocal)
  assert.equal(core.jobList()[2]!.output, originalLocal, '取消选择不能改动任务')
  renameSync(originalLocal, renamedLocal)
  await assert.rejects(() => core!.relinkPublicationFile(localJobs[0]!.id, inspectedOnly.token), /找不到/)
  const renamedChoice = await core.inspectPublicationFile(localJobs[0]!.id, renamedLocal)
  assert.deepEqual([renamedChoice.seasonNumber, renamedChoice.episodeNumber, renamedChoice.numbersFromName, renamedChoice.canEditNumbers], [0, 151, true, true])
  await assert.rejects(() => core!.relinkPublicationFile(localJobs[0]!.id, 'invalid'), /失效/)
  await core.relinkPublicationFile(localJobs[0]!.id, renamedChoice.token, { seasonNumber: 0, episodeNumber: 151 })
  assert.equal(core.jobList()[2]!.output, renamedLocal)
  assert.equal(core.jobList()[2]!.label, 'S00E151')
  assert.equal(core.jobList()[2]!.publication!.episodeNumber, 151)
  assert.equal(existsSync(originalLocal), false, '不能把用户文件改回旧名称')
  assert.equal(uploadStarts, 1, '确认关联只更新文件，不启动上传')
  await assert.rejects(() => core!.relinkPublicationFile(localJobs[0]!.id, renamedChoice.token), /失效/)
  await core.shutdown(); core.dispose(); core = await create()
  await core.saveSettings({ plutofishAutoUpload: true })
  await settle()
  assert.equal(core.jobList()[2]!.publication!.workTarget.category, '')
  assert.equal(uploadStarts, 1, '重新开启不能上传关闭期间创建的本地任务')
  assert.equal(core.jobList()[2]!.output, renamedLocal)
  assert.equal(core.jobList()[2]!.publication!.episodeNumber, 151)
  await core.completePublicationSetup(localJobs[0]!.id, 'anime')
  const renamedDeadline = Date.now() + 10000
  while (core.jobList()[2]!.publication!.progress?.stage !== 'completed' && Date.now() < renamedDeadline) await new Promise(r => setTimeout(r, 50))
  assert.equal(core.jobList()[2]!.publication!.progress?.stage, 'completed')
  assert.equal(uploadNames.at(-1), 'Natural.High.2023.S00E151.1080p.TX.WEB-DL.AVC-WF.mkv')
  assert.equal(reportedFiles.at(-1)!.name, uploadNames.at(-1))
  assert.equal(reportedFiles.at(-1)!.releaseTarget.seasonNumber, 0)
  assert.equal(reportedFiles.at(-1)!.episodeNumber, 151)
  assert.equal(calls, downloadsBefore + 4, '改名后的手动上传不能触发重新下载')
  // 缺少成品规格的旧任务：首次检测失败，重启后点重试读取同一个文件。
  await core.saveSettings({ plutofishAutoUpload: false })
  assert.equal(await core.enqueue({ ...request, episodes: [{ ...request.episodes[0]!, vid: 'legacy-ep3', number: 3 }], publication: undefined }), 1)
  const retryId = core.jobList().at(-1)!.id, retryPath = join(profile, 'Existing.S00E03.1080p.APP.WEB-DL.mkv')
  writeFileSync(retryPath, Buffer.alloc(2048, 5))
  ;(core as any).onJob({ id: retryId, status: '完成', pct: 1, log: retryPath, err: '', done: true })
  const stage = () => core!.jobList().find(job => job.id === retryId)!.publication!.progress?.stage
  async function untilStage(expected: string) {
    const deadline = Date.now() + 5000
    while (stage() !== expected && Date.now() < deadline) {
      await (core as any).publications.tick()
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(stage(), expected)
  }
  let probeCalls = 0
  core.probePublicationMedia = async path => { assert.equal(path, retryPath); probeCalls++; return { status: 'unavailable' } }
  const startsBeforeRetry = uploadStarts, downloadsBeforeRetry = calls
  await core.completePublicationSetup(retryId, 'anime')
  await untilStage('failed')
  assert.equal(probeCalls, 1)
  assert.equal(uploadStarts, startsBeforeRetry)
  const retryKey = core.jobList().find(job => job.id === retryId)!.publication!.fileKey
  await core.shutdown(); core.dispose(); core = await create()
  core.probePublicationMedia = async path => { assert.equal(path, retryPath); probeCalls++; return measured.media }
  await (core as any).publications.tick()
  assert.equal(stage(), 'failed', '重启不能自行重试失败任务')
  assert.equal(probeCalls, 1)
  await core.controlPublication(retryId, 'resume')
  await untilStage('completed')
  const retried = core.jobList().find(job => job.id === retryId)!
  assert.equal(probeCalls, 2)
  assert.equal(calls, downloadsBeforeRetry, '重试上传只能补检现有文件，不能重新下载')
  assert.equal(uploadStarts, startsBeforeRetry + 1)
  assert.equal(retried.publication!.fileKey, retryKey)
  assert.equal(retried.output, retryPath)
  assert.deepEqual(retried.completedMedia, measured)
  assert.deepEqual(retried.publication!.measured, measured)
  assert.deepEqual(readFileSync(retryPath), Buffer.alloc(2048, 5))
  const countBeforeFailure = core.jobList().length
  const n = calls
  rmSync(join(profile, 'jobs.json')); mkdirSync(join(profile, 'jobs.json'))
  await assert.rejects(() => core!.enqueue(request), /任务保存失败/)
  assert.equal(calls, n)
  assert.equal(core.jobList().length, countBeforeFailure)
  console.log('PASS: Core validates required categories, restores incomplete downloads, uploads existing media automatically without re-downloading, remembers repaired settings, and preserves pending tasks')
}

void main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  if (core) { await core.shutdown(); core.dispose() }
  server.close()
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
