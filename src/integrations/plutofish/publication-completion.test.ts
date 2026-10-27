/** 官方成功回执直接登记就绪；回执登记或目录登记断网后重启只重放，不查询网盘。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type OSS from 'ali-oss'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import { PublisherError } from './retry.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { UploadCompletion } from './upload-types.ts'
import type { OSSFactory } from './oss-upload.ts'

test.each(['rapid', 'multipart-empty', 'multipart-metadata'])('115 成功直接就绪并支持重启重放：%s', async mode => {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-complete-'))
  const path = join(directory, 'E01.mkv'), data = Buffer.alloc(1024, 7)
  writeFileSync(path, data)
  const sourceAccount = { id: 'source', alias: 'source', name: 'Source' }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.com', key: 'offline' }),
    verify: async () => ({ id: 'pub', name: 'Pub', kind: 'publisher', sourceAccount }) })
  await connection.verify()
  const draft: PublicationDraft = { schemaVersion: 1, binding: { url: 'https://example.com', publisherId: 'pub', sourceAccount },
    fileKey: `gvs-f1:${'1'.repeat(64)}`, releaseKey: 'release', existingReleaseId: 'a'.repeat(32),
    workTarget: { mediaType: 'tv', tmdbId: '123', category: 'tv' }, title: 'Test', categoryLabel: 'TV',
    kind: 'video', output: path, updatedAt: '', seasonNumber: 1, episodeNumber: 1,
    measured: { file: { size: data.length }, media: { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' } } }
  let view = draft, starts = 0, puts = 0, completes = 0, verifies = 0
  let loseCompletion = mode !== 'rapid', loseReport = true
  const reports: Array<{ resource: { fileId: string; pickCode: string }; status: string }> = []
  const phases: string[] = []
  connection.request = async <T>(_binding: unknown, route: string, body: unknown): Promise<T> => {
    const input = body as { action?: string; completion?: UploadCompletion }
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') return { outcome: 'applied' } as T
    if (route === 'files/ed2k') return { accepted: true } as T
    if (route === 'files/report') {
      reports.push(structuredClone(body) as typeof reports[number])
      if (loseReport) throw new PublisherError('登记回执丢失', true)
      return { accepted: true } as T
    }
    if (input.action === 'verify') { verifies++; throw new Error('success must not query file details') }
    if (input.action === 'complete') {
      completes++
      expect(input.completion?.pickCode).toBe('uploadTask')
      if (loseCompletion) throw new PublisherError('完成回执登记中断', true)
      return { dispatch: { status: 'ready', ...input.completion } } as T
    }
    if (input.action === 'credentials') return { credentials: { accessKeyId: 'ID', accessKeySecret: 'SECRET', securityToken: 'TOKEN',
      expiration: new Date(Date.now() + 3600000).toISOString(), endpoint: 'https://up-file.115.com', rate: 0 } } as T
    if (input.action === 'start') {
      starts++
      return { dispatch: { status: mode === 'rapid' ? 'ready' : 'uploading', pickCode: 'uploadTask',
        bucket: 'bucket', object: 'object', endpoint: 'https://up-file.115.com', callback: '{}' } } as T
    }
    return { dispatch: { status: 'uploading' } } as T
  }
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: 'upload' } as OSS.InitMultipartUploadResult },
    async listParts() { throw new Error('confirmed upload must not resume OSS') },
    async uploadPart(_name, _id, _number, buffer) { puts++; return { etag: createHash('md5').update(buffer).digest('hex') } as OSS.UploadPartResult },
    async completeMultipartUpload() { return { data: { state: true, ...(mode === 'multipart-metadata' ? { data: { file_id: '9007199254740993', pick_code: 'actualFile' } } : {}) } } as unknown as OSS.CompleteMultipartUploadResult },
  } })
  const makeWorker = () => new PublicationWorker(connection, value => {
    view = value
    if (value.progress?.phase) phases.push(value.progress.phase)
  }, { directory, factory, manual: true })
  let worker = makeWorker()
  const settle = async (stage: string) => {
    for (let i = 0; i < 200; i++) {
      await worker.tick()
      if (view.progress?.stage === stage) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`expected ${stage}: ${view.progress?.error}`)
  }
  const restart = async () => { await worker.close(); worker = makeWorker(); worker.register(draft); worker.control(draft.fileKey, 'resume') }
  try {
    worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: '', err: '' })
    await settle('failed')
    if (mode !== 'rapid') {
      expect(reports).toHaveLength(0)
      loseCompletion = false
      await restart()
      await settle('failed')
      expect(completes).toBe(2)
    }
    loseReport = false
    await restart()
    await settle('completed')
    expect(starts).toBe(1)
    expect(puts).toBe(mode === 'rapid' ? 0 : 1)
    expect(verifies).toBe(0)
    expect(phases).not.toContain('verifying')
    expect(reports).toHaveLength(2)
    expect(reports[0]).toEqual(reports[1])
    expect(reports[1]).toMatchObject({ status: 'ready', resource: mode === 'multipart-metadata'
      ? { fileId: '9007199254740993', pickCode: 'actualFile' } : { fileId: '', pickCode: '' } })
  } finally { await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) }
})
