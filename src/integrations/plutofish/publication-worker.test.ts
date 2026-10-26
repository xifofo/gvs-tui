/** 下载器流程离线测试覆盖完成回执丢失、重启恢复和失败后继续上报，不触碰用户网盘。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type OSS from 'ali-oss'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import { completePublication, preparePublication } from './publication.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { DlTask } from '../../lib/jobs.ts'
import type { OSSFactory } from './oss-upload.ts'
import { ed2kFile } from '../../lib/ed2k.ts'
import { PublisherError } from './retry.ts'

test('Complete 回执丢失后重启核验原文件，目录上报失败可重放且不重复上传', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'plutofish-worker-'))
  const path = join(directory, 'Show.S01E01.1080p.HG.WEB-DL.SDR.AVC-Team.Web-Release.mkv'), data = Buffer.alloc(1024, 9)
  writeFileSync(path, data)
  const identity = { id: 'pub', name: 'Publisher', kind: 'publisher' as const, sourceAccount: { id: 'source', alias: 'source', name: 'Source' }, categories: [{ value: 'short', label: '短剧' }], capabilities: { uploadClientGrouping: false, taskDiagnostics: true } }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.com', key: 'secret' }), verify: async () => identity })
  await connection.verify()
  const draft = completePublication(preparePublication({ provider: 'hongguo', sourceWorkId: 'series1', title: '第一集', series: '红果作品', vid: 'ep1', season: 1, episode: 1, tmdbId: 0, quality: '1080', codec: 'h264', group: '', plot: '' } as DlTask, connection.view(), 'short', '0', '/', { existingReleaseId: 'a'.repeat(32) }), path,
    { media: { status: 'probed', width: 1080, height: 1920, codec: 'h264', dynamicRange: 'SDR' }, file: { size: data.length } })
  let uploaded = false, catalogFail = true, verificationOffline = false, puts = 0, starts = 0, view: PublicationDraft = draft
  const finalReports: unknown[] = []
  const taskReports: Array<import('./publication-state').TaskSnapshot> = []
  connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, payload: unknown): Promise<T> => {
    const input = payload as { action?: string }
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') { taskReports.push(structuredClone(payload as import('./publication-state').TaskSnapshot)); return { outcome: 'applied' } as T }
    if (route === 'files/ed2k') return { accepted: true } as T
    if (input.action === 'release' || input.action === 'heartbeat') return { dispatch: { status: 'uploading' } } as T
    if (route === 'files/report') {
      finalReports.push(structuredClone(payload))
      if (catalogFail) throw new PublisherError('PlutoFish 上报失败（HTTP 503）', true)
      return { outcome: 'duplicate' } as T
    }
    if (input.action === 'verify') {
      if (verificationOffline) throw new PublisherError('PlutoFish 连接中断', true)
      if (!uploaded) throw new Error('115 文件未完成')
      return { dispatch: { status: 'ready', fileId: '123', pickCode: 'original', filePickCode: 'finishedfile' } } as T
    }
    if (input.action === 'credentials') return { credentials: { accessKeyId: 'TEMP-ID', accessKeySecret: 'TEMP-SECRET', securityToken: 'TEMP-TOKEN', expiration: new Date(Date.now() + 3600_000).toISOString(), endpoint: 'https://up-file.115.com', rate: 0 } } as T
    starts++
    return { dispatch: { status: 'uploading', pickCode: 'original', bucket: 'bucket', object: 'object', endpoint: 'https://up-file.115.com', callback: '{}' } } as T
  }
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: 'UPLOAD-1' } as OSS.InitMultipartUploadResult },
    async listParts() { return { uploadId: 'UPLOAD-1', bucket: 'bucket', name: 'object', parts: [], isTruncated: false } as unknown as OSS.ListPartsResult },
    async uploadPart(_name, _id, _number, buffer) { puts++; return { etag: createHash('md5').update(buffer).digest('hex') } as OSS.UploadPartResult },
    async completeMultipartUpload() { uploaded = true; throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }) },
  } })
  const phases: string[] = [], bytes: number[] = [], hashProgress: number[] = []
  const changed = (value: PublicationDraft) => { view = value; if (value.progress?.phase) phases.push(value.progress.phase); bytes.push(value.progress?.uploadedBytes ?? 0); if (value.ed2k?.state === 'running') hashProgress.push(value.ed2k.pct) }
  let hashStarts = 0
  let worker = new PublicationWorker(connection, changed, { directory, factory, manual: true,
    retention: { compute: (path, signal, progress) => { hashStarts++; progress?.(512, 1024); return ed2kFile(path, progress, signal) } } })
  const settle = async (stage: string) => {
    for (let i = 0; i < 100; i++) {
      await worker.tick()
      if (view.progress?.stage === stage) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`did not reach ${stage}: ${view.progress?.stage}`)
  }
  try {
    worker.register(draft)
    worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: path, err: '' })
    expect(hashStarts).toBe(1)
    expect(hashProgress).toContain(0.5)
    await settle('failed')
    expect(view.progress?.failure?.retryable).toBe(true)
    expect(puts).toBe(1)
    expect(phases).toContain('hashing')
    expect(phases).toContain('uploading')
    expect(bytes).toContain(data.length)
    expect(view.progress?.sizeBytes).toBe(data.length)
    expect(finalReports).toHaveLength(0)
    await worker.close()
    expect(view.ed2k?.state).toBe('done')
    const ed2kLink = view.ed2k?.link
    worker = new PublicationWorker(connection, changed, { directory, factory, manual: true })
    worker.register(draft)
    expect(view.progress?.failure?.retryable).toBe(true)
    expect(view.ed2k?.link).toBe(ed2kLink)
    expect(view.ed2k?.state).toBe('done')
    verificationOffline = true
    worker.control(draft.fileKey, 'resume')
    await settle('failed')
    expect(view.progress?.failure?.retryable).toBe(true)
    expect(starts).toBe(1); expect(puts).toBe(1); expect(finalReports).toHaveLength(0)
    verificationOffline = false
    worker.control(draft.fileKey, 'resume')
    await settle('failed')
    expect(finalReports).toHaveLength(1)
    catalogFail = false
    worker.control(draft.fileKey, 'resume')
    await settle('completed')
    await worker.tick()
    expect(finalReports).toHaveLength(2)
    expect(finalReports[0]).toEqual(finalReports[1])
    expect(finalReports[0]).toMatchObject({ resource: { pickCode: 'finishedfile' },
      releaseTarget: { existingReleaseId: 'a'.repeat(32), name: 'S01.1080p.HG.WEB-DL.SDR.AVC-Team.Web-Release', resolution: '1080p', dynamicRange: 'SDR', autoPublish: true } })
    expect(starts).toBe(1)
    expect(puts).toBe(1)
    expect(view.progress?.synced).toBeTrue()
    const failures = taskReports.filter(report => report.stage === 'failed')
    expect(failures).toHaveLength(3)
    expect(failures.every(report => !!report.errorDetails?.stage && !!report.errorDetails?.occurredAt)).toBeTrue()
    expect(new Set(failures.map(report => report.sequence)).size).toBe(3)
    expect(taskReports.at(-1)?.stage).toBe('completed')
    expect(phases).toContain('verifying')
    expect(phases).toContain('reporting')
    for (const name of readdirSync(directory).filter(n => n.endsWith('.json'))) expect(readFileSync(join(directory, name), 'utf8')).not.toContain('TEMP-')
  } finally { await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) }
})
