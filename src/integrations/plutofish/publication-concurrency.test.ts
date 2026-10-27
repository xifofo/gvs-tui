/** 两路独立上传与后续文件预校验；模拟 OSS 保留 PUT，验证暂停和退出不会串任务。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type OSS from 'ali-oss'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { OSSFactory } from './oss-upload.ts'
import type { UploadBudget } from './upload-traffic.ts'

test('最多两个 PUT，排队文件提前哈希，暂停一路不影响另一路，实时发送不落盘', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-two-'))
  const identity = { id: 'pub', name: 'Pub', kind: 'publisher' as const, sourceAccount: { id: 'source', alias: 'source', name: 'Source' }, capabilities: { uploadClientGrouping: true } }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.com', key: 'offline' }), verify: async () => identity })
  await connection.verify()
  const views = new Map<string, PublicationDraft>(), phases = new Set<string>(), clients = new Set<string>()
  const gates = new Map<string, () => void>(), active = new Set<string>()
  const budgets = new Map<string, UploadBudget>()
  let maximum = 0, live = 0
  connection.request = async <T>(_binding: unknown, route: string, body: unknown): Promise<T> => {
    const input = body as { action?: string; taskKey: string; clientId?: string }
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') return { outcome: 'applied' } as T
    if (route === 'files/report' || route === 'files/ed2k') return { accepted: true } as T
    if (route === 'uploads/prepare') {
      expect(input.clientId).toBeDefined(); clients.add(input.clientId!)
      if (input.action === 'credentials') return { credentials: { accessKeyId: 'ID', accessKeySecret: 'SECRET', securityToken: 'TOKEN', expiration: new Date(Date.now() + 3600000).toISOString(), endpoint: 'https://up-file.115.com', rate: 51200, rateScope: input.taskKey } } as T
      if (input.action === 'complete') return { dispatch: { status: 'ready', fileId: '123', pickCode: input.taskKey } } as T
      return { dispatch: { status: 'uploading', pickCode: input.taskKey, bucket: 'bucket', object: input.taskKey, endpoint: 'https://up-file.115.com', callback: '{}' } } as T
    }
    throw new Error(`Unexpected ${route}`)
  }
  const factory: OSSFactory = (dispatch, _token, signal, traffic) => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: dispatch.object } as OSS.InitMultipartUploadResult },
    async listParts() { return { uploadId: dispatch.object, bucket: 'bucket', name: dispatch.object, parts: [], isTruncated: false } as unknown as OSS.ListPartsResult },
    async uploadPart(name, _id, _part, buffer) {
      expect(traffic?.budget.limit).toBe(51200)
      budgets.set(name, traffic!.budget)
      active.add(name); maximum = Math.max(maximum, active.size)
      traffic?.sent(buffer.length / 2)
      try {
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason) }
          signal.addEventListener('abort', aborted, { once: true })
          gates.set(name, () => { signal.removeEventListener('abort', aborted); resolve() })
        })
        return { etag: createHash('md5').update(buffer).digest('hex') } as OSS.UploadPartResult
      } finally { active.delete(name); gates.delete(name) }
    },
    async completeMultipartUpload() { return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult },
  } })
  const worker = new PublicationWorker(connection, (draft, transient) => {
    views.set(draft.fileKey, draft)
    if (draft.progress?.phase === 'hashing') phases.add(draft.fileKey)
    if (transient && draft.progress?.transfer?.bytesPerSecond) live++
  }, { directory, factory, manual: true })
  const keys = [1, 2, 3, 4].map(n => `gvs-f1:${String(n).repeat(64)}`)
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 300; i++) { await worker.tick(); if (predicate()) return; await new Promise(r => setTimeout(r, 10)) }
    throw new Error('并发验收超时')
  }
  try {
    for (const [index, key] of keys.entries()) {
      const path = join(directory, `${index}.mkv`); writeFileSync(path, Buffer.alloc(256 * 1024, index))
      const draft: PublicationDraft = { schemaVersion: 1, binding: { url: 'https://example.com', publisherId: 'pub', sourceAccount: identity.sourceAccount },
        fileKey: key, releaseKey: 'release', existingReleaseId: 'a'.repeat(32), workTarget: { mediaType: 'tv', tmdbId: '123', category: 'tv' },
        title: 'Test', categoryLabel: 'TV', kind: 'video', output: path, updatedAt: '', seasonNumber: 1, episodeNumber: index + 1,
        measured: { file: { size: 256 * 1024 }, media: { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' } } }
      worker.event(draft, { id: index, done: true, status: '完成', pct: 1, log: '', err: '' })
    }
    await until(() => active.size === 2 && phases.has(keys[3]!) && live > 0)
    expect(maximum).toBe(2)
    expect(budgets.get(keys[0]!)).not.toBe(budgets.get(keys[1]!))
    expect(views.get(keys[0]!)!.progress!.uploadedBytes).toBe(0)
    expect(views.get(keys[0]!)!.progress!.transfer!.sentBytes).toBe(128 * 1024)
    for (const file of readdirSync(directory).filter(name => name.endsWith('.state.json'))) expect(readFileSync(join(directory, file), 'utf8')).not.toContain('bytesPerSecond')
    await worker.stop(keys[0]!, 'pause')
    expect(active.has(keys[1]!)).toBe(true)
    expect(views.get(keys[0]!)!.progress!.transfer).toBeUndefined()
    await until(() => active.has(keys[2]!))
    expect(active.has(keys[3]!)).toBe(false)
    gates.get(keys[1]!)!()
    await until(() => active.has(keys[3]!))
    await worker.close()
    expect(active.size).toBe(0)
    expect(clients.size).toBe(1)
    expect(maximum).toBe(2)
  } finally { await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) }
})
