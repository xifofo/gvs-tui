/** 本地夹具验证旧任务补检及重试；服务端、115 回执均为模拟。 */
import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import { completePublication, preparePublication } from './publication.ts'
import { publicationStage, publicationStatus, type PublicationDraft } from './publication-types.ts'
import type { PublicationState } from './publication-state.ts'
import type { DlTask } from '../../lib/jobs.ts'
import { probeFinishedMedia } from '../../lib/gvs-record.ts'
import { localFileInUse } from '../../lib/local-file-use.ts'
import { fingerprint } from './upload-file.ts'

const specs = { status: 'probed' as const, width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' }

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'gvs-publication-media-'))
  const path = join(directory, 'Show.S03E02.1080p.APP.WEB-DL.SDR.AVC.mkv')
  writeFileSync(path, Buffer.alloc(2048, 7))
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.test', key: 'fixture' }), verify: async () => ({
    id: 'publisher', kind: 'publisher', name: 'Fixture', sourceAccount: { id: 'source', alias: 'main', name: 'Source' }, categories: [{ value: 'tv', label: '剧集' }],
  }) })
  await connection.verify()
  const draft = completePublication(preparePublication({ provider: 'appletvplus', sourceWorkId: 'show', series: 'Show', title: 'Episode 2', vid: 'ep2',
    season: 3, episode: 2, tmdbId: 123, quality: '1080', codec: 'h264', group: '', plot: '' } as DlTask, connection.view(), 'tv', '42', '/Shows'), path)
  const statePath = join(directory, draft.fileKey.replace(':', '-') + '.state.json')
  const uploads: string[] = [], reports: unknown[] = [], views: PublicationDraft[] = []
  let probes = 0, probe: typeof probeFinishedMedia = async () => specs
  connection.request = async <T>(_binding: unknown, route: string, payload: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') return { outcome: 'applied' } as T
    if (route === 'files/ed2k') return { accepted: true } as T
    if (route === 'files/report') { reports.push(payload); return { outcome: 'applied' } as T }
    if (route === 'uploads/prepare') {
      uploads.push((payload as { action: string }).action)
      return { dispatch: { status: 'ready', fileId: 'fixture', filePickCode: 'fixture' } } as T
    }
    throw new Error(`Unexpected route ${route}`)
  }
  const makeWorker = () => new PublicationWorker(connection, value => views.push(value), { directory, manual: true, autoUpload: () => false,
    probeMedia: (path, signal) => { probes++; return probe(path, signal) }, retention: { settings: () => ({ hours: 0 }) } })
  let worker = makeWorker()
  worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: path, err: '' })
  const saved = () => JSON.parse(readFileSync(statePath, 'utf8')) as PublicationState
  return {
    path, draft, uploads, reports, views, saved,
    get worker() { return worker }, get view() { return views.at(-1)! }, get probes() { return probes },
    probeWith(value: typeof probeFinishedMedia) { probe = value },
    async restart(edit?: (state: PublicationState) => void) {
      await worker.close()
      if (edit) { const state = saved(); edit(state); writeFileSync(statePath, JSON.stringify(state)) }
      worker = makeWorker(); worker.restored()
    },
    async until(predicate: () => boolean) {
      for (let i = 0; i < 300; i++) { await worker.tick(); if (predicate()) return; await Bun.sleep(10) }
      throw new Error(`Unexpected publication state: ${views.at(-1)?.progress?.stage} ${views.at(-1)?.progress?.error}`)
    },
    async close() { await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

test('旧失败任务重试时补检原文件，检测仍不可用则保留大小，重启后可再次检测并上传', async () => {
  const f = await fixture()
  try {
    await f.restart(state => { state.snapshot.stage = 'failed'; state.snapshot.errorMessage = '成品媒体规格待检查，尚未上传' })
    await f.worker.tick()
    expect(f.probes).toBe(0)
    f.probeWith(async () => ({ status: 'unavailable' }))
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'failed')
    expect(f.uploads).toEqual([])
    expect(f.view.progress?.sizeBytes).toBe(2048)
    expect(f.view.progress?.error).toContain('媒体规格检测失败')
    expect(f.view.progress?.errorDetails?.stage).toBe('检测媒体规格')
    await f.restart()
    await f.worker.tick()
    expect(f.probes).toBe(1)
    f.probeWith(async path => { expect(path).toBe(f.path); return specs })
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'completed')
    expect(f.probes).toBe(2)
    expect(f.uploads.filter(action => action === 'start')).toHaveLength(1)
    expect(f.reports).toHaveLength(1)
    expect(f.view).toMatchObject({ fileKey: f.draft.fileKey, releaseKey: f.draft.releaseKey, binding: f.draft.binding,
      directoryId: '42', output: f.path, seasonNumber: 3, episodeNumber: 2, measured: { media: specs, file: { size: 2048 } } })
    expect(f.saved().draft.measured).toEqual(f.view.measured)
    expect(f.views.some(view => publicationStage(view) === '检测媒体规格' && publicationStatus(view).startsWith('检测媒体规格'))).toBe(true)
    expect(readFileSync(f.path)).toEqual(Buffer.alloc(2048, 7))
    await f.restart()
    expect(f.view.measured?.media).toEqual(specs)
  } finally { await f.close() }
})

test('检测期间暂停会丢弃迟到结果，继续后重新检测且不丢失原任务', async () => {
  const f = await fixture()
  let finish!: () => void
  try {
    f.probeWith(async () => { await new Promise<void>(resolve => { finish = resolve }); return specs })
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.probes === 1)
    expect(localFileInUse(f.path)).toBe(true)
    f.worker.control(f.draft.fileKey, 'pause')
    finish()
    await f.until(() => !localFileInUse(f.path))
    expect(f.view.progress?.stage).toBe('paused')
    expect(f.saved().draft.measured).toBeUndefined()
    expect(f.uploads).toEqual([])
    f.probeWith(async () => specs)
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'completed')
    expect(f.probes).toBe(2)
  } finally { finish?.(); await f.close() }
})

test('检测时文件改变会阻止上传，并允许用户检查后重试', async () => {
  const f = await fixture()
  try {
    f.probeWith(async path => { writeFileSync(path, Buffer.alloc(4096, 9)); return specs })
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'failed')
    expect(f.view.progress?.error).toContain('媒体检测期间发生变化')
    expect(f.uploads).toEqual([])
    expect(f.saved().draft.measured).toBeUndefined()
    f.probeWith(async () => specs)
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'completed')
    expect(f.view.measured?.file.size).toBe(4096)
  } finally { await f.close() }
})

for (const missing of [true, false]) test(`原文件${missing ? '丢失' : '为空'}时停止，不发送上传请求`, async () => {
  const f = await fixture()
  try {
    if (missing) rmSync(f.path)
    else writeFileSync(f.path, '')
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'failed')
    expect(f.probes).toBe(0)
    expect(f.uploads).toEqual([])
    expect(f.view.progress?.error).toContain(missing ? '本地文件不存在' : '非空普通文件')
  } finally { await f.close() }
})

test('补检不会绕过原上传断点的文件身份核验', async () => {
  const f = await fixture()
  try {
    const file = await fingerprint(f.path, new AbortController().signal)
    await f.restart(state => { state.snapshot.stage = 'failed'; state.checkpoint = { file, partSize: 16 * 1024 * 1024, parts: [] } })
    writeFileSync(f.path, Buffer.alloc(2048, 8))
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'failed')
    expect(f.probes).toBe(1)
    expect(f.view.progress?.error).toContain('不能复用原上传断点')
    expect(f.uploads).toEqual(['release'])
    expect(f.saved().checkpoint?.file.sha1).toBe(file.sha1)
  } finally { await f.close() }
})

const mediaTest = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) ? test : test.skip
mediaTest('真实本地 MKV 缺失规格时读取视频和音轨，补检后完成模拟登记且文件不变', async () => {
  const f = await fixture()
  try {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '0.3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', f.path], { stdio: 'pipe', timeout: 20000 })
    const original = readFileSync(f.path)
    f.probeWith(probeFinishedMedia)
    f.worker.control(f.draft.fileKey, 'resume')
    await f.until(() => f.view.progress?.stage === 'completed')
    expect(f.view.measured).toMatchObject({ media: { status: 'probed', width: 160, height: 90, codec: 'h264', audio: { codec: 'aac' } }, file: { size: statSync(f.path).size } })
    expect(readFileSync(f.path)).toEqual(original)
    expect(f.reports).toHaveLength(1)
  } finally { await f.close() }
})
