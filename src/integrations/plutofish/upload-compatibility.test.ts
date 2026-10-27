/** 真实回环 HTTP 验证新旧契约与热更新；OSS 仅消费本地文件，不联系网盘。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type OSS from 'ali-oss'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { OSSFactory } from './oss-upload.ts'

test('旧服务端单路上传和提前准备；升级、回滚排空当前协议后切换，所有请求保持租约身份', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-compat-'))
  const sourceAccount = { id: 'source', alias: 'source', name: 'Source' }
  let advertised = false, rejectExtensions = true, rejectInput = false
  const requests: Array<{ taskKey: string; clientId?: string; action: string }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const route = new URL(req.url).pathname.split('/').at(-1)
    if (route === 'me') return Response.json({ id: 'pub', name: 'Pub', kind: 'publisher', sourceAccount,
      ...(advertised ? { capabilities: { uploadClientGrouping: true, futureFeature: true } } : {}) })
    const input = await req.json() as { taskKey: string; clientId?: string; action: string }
    if (route === 'pending') return Response.json({ jobs: [] })
    if (route !== 'prepare') return Response.json({ outcome: 'applied', accepted: true })
    requests.push(input)
    if (rejectInput && input.action === 'start') return Response.json({ error: { code: 'VALIDATION_FAILED', fieldErrors: { body: 'private error detail' } } }, { status: 422 })
    if (rejectExtensions && Object.hasOwn(input, 'clientId')) return Response.json({ error: { code: 'VALIDATION_FAILED', fieldErrors: { body: 'unknown property' } } }, { status: 422 })
    if (input.action === 'credentials') return Response.json({ credentials: { accessKeyId: 'ID', accessKeySecret: 'SECRET', securityToken: 'TOKEN', expiration: new Date(Date.now() + 3600000).toISOString(), endpoint: 'https://up-file.115.com', rate: 0, rateScope: 'shared' } })
    return Response.json({ dispatch: { status: ['verify', 'complete'].includes(input.action) ? 'ready' : 'uploading', fileId: '123', pickCode: input.taskKey,
      bucket: 'bucket', object: input.taskKey, endpoint: 'https://up-file.115.com', callback: '{}' } })
  } })
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'offline' }) })
  const gates = new Map<string, () => void>(), active = new Set<string>(), phases = new Set<string>()
  const views = new Map<string, PublicationDraft>()
  const factory: OSSFactory = (dispatch, _token, signal) => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: dispatch.object } as OSS.InitMultipartUploadResult },
    async listParts() { return { uploadId: dispatch.object, bucket: 'bucket', name: dispatch.object, parts: [], isTruncated: false } as unknown as OSS.ListPartsResult },
    async uploadPart(name, _id, _part, buffer) {
      active.add(name)
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
  const worker = new PublicationWorker(connection, draft => {
    views.set(draft.fileKey, draft)
    if (draft.progress?.phase === 'hashing') phases.add(draft.fileKey)
  }, { directory, factory, manual: true })
  const keys = [1, 2, 3, 4, 5].map(n => `gvs-f1:${String(n).repeat(64)}`)
  const until = async (predicate: () => boolean, timeout = 5000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { await worker.tick(); if (predicate()) return; await Bun.sleep(10) }
    throw new Error(`兼容验收超时：${JSON.stringify([...views.values()].map(v => ({ key: v.fileKey, progress: v.progress })))}`)
  }
  const settle = async () => { for (let i = 0; i < 10; i++) { await worker.tick(); await Bun.sleep(10) } }
  try {
    await connection.verify()
    expect(connection.view().uploadNotice).toContain('单文件兼容')
    for (const [i, key] of keys.entries()) {
      const path = join(directory, `${i}.mkv`); writeFileSync(path, Buffer.alloc(1024, i))
      const draft: PublicationDraft = { schemaVersion: 1, binding: { url: server.url.origin, publisherId: 'pub', sourceAccount },
        fileKey: key, releaseKey: 'release', existingReleaseId: 'a'.repeat(32), workTarget: { mediaType: 'tv', tmdbId: '123', category: 'tv' },
        title: 'Test', categoryLabel: 'TV', kind: 'video', output: path, updatedAt: '', seasonNumber: 1, episodeNumber: i + 1,
        measured: { file: { size: 1024 }, media: { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' } } }
      worker.event(draft, { id: i, done: true, status: '完成', pct: 1, log: '', err: '' })
    }
    await until(() => active.has(keys[0]!) && phases.has(keys[2]!))
    await settle()
    expect([...active]).toEqual([keys[0]!])
    expect(requests.every(r => !Object.hasOwn(r, 'clientId'))).toBe(true)

    // 部署新服务不会把正在上传的旧租约中途升级；20 秒心跳也必须沿用旧请求体。
    advertised = true; rejectExtensions = false
    await connection.verify(undefined, true)
    expect(connection.groupedUploads).toBe(true)
    await until(() => requests.some(r => r.action === 'heartbeat'), 22000)
    expect([...active]).toEqual([keys[0]!])
    gates.get(keys[0]!)!()
    await until(() => active.has(keys[1]!) && active.has(keys[2]!))
    const legacy = requests.filter(r => r.taskKey === keys[0])
    expect(legacy.every(r => !Object.hasOwn(r, 'clientId'))).toBe(true)
    expect(legacy.map(r => r.action)).toEqual(expect.arrayContaining(['start', 'credentials', 'heartbeat', 'complete', 'release']))

    // 撤销能力后不再补充并发槽；原两路租约各自完成和释放后再进入旧协议。
    advertised = false
    await connection.verify(undefined, true)
    await until(() => phases.has(keys[4]!))
    gates.get(keys[1]!)!()
    await until(() => views.get(keys[1]!)?.progress?.stage === 'completed')
    await settle()
    expect([...active]).toEqual([keys[2]!])
    gates.get(keys[2]!)!()
    await until(() => active.has(keys[3]!))
    expect(active.size).toBe(1)
    const grouped = requests.filter(r => [keys[1], keys[2]].includes(r.taskKey))
    expect(grouped.every(r => /^[a-f0-9-]{36}$/.test(r.clientId ?? ''))).toBe(true)
    expect(new Set(grouped.map(r => r.clientId)).size).toBe(1)
    expect(grouped.filter(r => r.action === 'release').length).toBe(2)
    expect(requests.filter(r => r.taskKey === keys[3]).every(r => !Object.hasOwn(r, 'clientId'))).toBe(true)
    await worker.stop(keys[3]!, 'pause')
    const saved = readdirSync(directory).filter(f => f.endsWith('.state.json')).map(f => JSON.parse(readFileSync(join(directory, f), 'utf8')))
    expect(saved.find(s => s.draft.fileKey === keys[3])?.checkpoint.partSize).toBe(16 * 1024 * 1024)

    // 普通 422 不能被误判成旧后端并去掉 clientId 重发，避免掩盖真实参数问题。
    advertised = true; rejectInput = true
    await connection.verify(undefined, true)
    await until(() => views.get(keys[4]!)?.progress?.stage === 'failed')
    const rejected = requests.filter(r => r.taskKey === keys[4] && r.action === 'start')
    expect(rejected.length).toBe(1)
    expect(rejected[0]?.clientId).toBeDefined()
    expect(views.get(keys[4]!)?.progress?.error).toContain('422')
    expect(views.get(keys[4]!)?.progress?.error).not.toContain('private error detail')
  } finally { await worker.close(); connection.close(); server.stop(true); rmSync(directory, { recursive: true, force: true }) }
}, 35000)
