/** 使用临时文件和内存 OSS 验证分片恢复，不发送真实网盘请求。 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import type OSS from 'ali-oss'
import { createOSS, uploadParts, type OSSFactory } from './oss-upload.ts'
import { fingerprint, challengeHash } from './upload-file.ts'
import { PublicationStore, type PublicationState } from './publication-state.ts'
import type { Dispatch, UploadCheckpoint } from './upload-types.ts'
import { preparePublication } from './publication.ts'
import type { DlTask } from '../../lib/jobs.ts'
import { retryableError } from './retry.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'plutofish-upload-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }) })
const digest = (data: Buffer, algorithm = 'md5') => createHash(algorithm).update(data).digest('hex').toUpperCase()
const dispatch: Dispatch = { status: 'uploading', pickCode: 'original', bucket: 'fhnfile', object: 'original/object', endpoint: 'https://up-file.115.com', callback: '{"callbackUrl":"https://callback.115.com"}', callbackVar: '{}' }
const credentials = async () => ({ accessKeyId: 'TEMP-ID', accessKeySecret: 'TEMP-SECRET', securityToken: 'TEMP-TOKEN', endpoint: 'https://up-yunfile.115.com', expiration: new Date(Date.now() + 3600_000).toISOString(), rate: 102400 })

test.each([
  ['RequestError', 'ECONNRESET', true], ['RequestError', 'ENOTFOUND', true],
  ['ResponseTimeoutError', undefined, true], ['ConnectionTimeoutError', undefined, true],
  ['RequestError', 'CERT_HAS_EXPIRED', false], ['RequestError', 'EACCES', false],
] as const)('真实 OSS SDK 保留网络错误分类：%s / %s', async (name, code, retryable) => {
  const session = createOSS(dispatch, await credentials(), new AbortController().signal)
  const sdk = session.client as typeof session.client & { urllib: { request: () => Promise<unknown> } }
  sdk.urllib = { async request() { throw Object.assign(new Error('private-sdk-detail'), { name, code, status: -1 }) } }
  try {
    const failure = await sdk.initMultipartUpload(dispatch.object!).then(() => null, e => e)
    expect(failure).toBeInstanceOf(Error)
    expect(retryableError(failure)).toBe(retryable)
  } finally { session.close() }
})

test.each([false, true])('真实 OSS SDK 签名及上传域名，旧版区域地址=%s', async legacy => {
  const token = { ...await credentials(), ...(legacy ? { endpoint: 'https://oss-cn-shenzhen.aliyuncs.com' } : {}) }
  const route = { ...dispatch, ...(legacy ? { endpoint: undefined } : {}) }
  const session = createOSS(route, token, new AbortController().signal)
  const methods: string[] = [], etagValue = digest(Buffer.from('part'))
  type Request = { method: string; headers: Record<string, string> }
  const sdk = session.client as typeof session.client & { urllib: { request: (url: string, options: Request) => Promise<unknown> } }
  sdk.urllib = { async request(url, options) {
    const parsed = new URL(url)
    expect(parsed.origin).toBe(legacy ? 'https://fhnfile.oss-cn-shenzhen.aliyuncs.com' : dispatch.endpoint!)
    expect(parsed.pathname).toBe('/original/object')
    methods.push(options.method)
    const header = (key: string) => Object.entries(options.headers).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? ''
    const canonicalHeaders = Object.entries(options.headers).filter(([k]) => k.toLowerCase().startsWith('x-oss-')).map(([k,v]) => [k.toLowerCase(), v]).sort(([a], [b]) => a!.localeCompare(b!)).map(([k,v]) => `${k}:${v}\n`).join('')
    const subres = [...parsed.searchParams].filter(([k]) => ['uploads','sequential','uploadId','partNumber'].includes(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => v ? `${k}=${v}` : k).join('&')
    const canonical = `${options.method}\n${header('content-md5')}\n${header('content-type')}\n${header('x-oss-date')}\n${canonicalHeaders}/${dispatch.bucket}/${dispatch.object}${subres ? '?' + subres : ''}`
    expect(header('authorization')).toBe(`OSS ${token.accessKeyId}:${createHmac('sha1', token.accessKeySecret).update(canonical).digest('base64')}`)
    expect(header('x-oss-security-token')).toBe(token.securityToken)
    let data = '{"state":true}'
    if (parsed.searchParams.has('uploads')) { expect(parsed.searchParams.has('sequential')).toBeTrue(); data = '<InitiateMultipartUploadResult><UploadId>SDK-ID</UploadId></InitiateMultipartUploadResult>' }
    else if (options.method === 'GET') data = '<ListPartsResult><Bucket>fhnfile</Bucket><Key>original/object</Key><UploadId>SDK-ID</UploadId><IsTruncated>false</IsTruncated></ListPartsResult>'
    else if (options.method === 'PUT') expect(header('x-oss-traffic-limit')).toBe('819200')
    else expect(Buffer.from(header('x-oss-callback'), 'base64').toString()).toBe(dispatch.callback!)
    const headers = { etag: etagValue }
    return { status: 200, headers, data: Buffer.from(data), res: { status: 200, headers } }
  } }
  try {
    await sdk.initMultipartUpload(dispatch.object!)
    await sdk.listParts(dispatch.object!, 'SDK-ID', { 'encoding-type': 'url', 'max-parts': 1000, 'part-number-marker': 0 })
    await sdk.uploadPart(dispatch.object!, 'SDK-ID', 1, Buffer.from('part'), 0, 4, { headers: { 'x-oss-traffic-limit': '819200' } } as OSS.RequestOptions)
    await sdk.completeMultipartUpload(dispatch.object!, 'SDK-ID', [{ number: 1, etag: etagValue }], { headers: { 'x-oss-callback': Buffer.from(dispatch.callback!).toString('base64') } })
    expect(methods).toEqual(['POST', 'GET', 'PUT', 'POST'])
  } finally { session.close() }
})

test('范围校验闭区间、前 128 KiB 校验及文件变更拒绝', async () => {
  const path = join(temp(), 'media.bin'), data = Buffer.alloc(150000, 7)
  writeFileSync(path, data)
  const signal = new AbortController().signal
  const file = await fingerprint(path, signal)
  expect(file.sha1).toBe(digest(data, 'sha1'))
  expect(file.preId).toBe(digest(data.subarray(0, 131072), 'sha1'))
  expect(await challengeHash(path, '10-19', file, signal)).toBe(digest(data.subarray(10, 20), 'sha1'))
  await expect(challengeHash(path, '0-150000', file, signal)).rejects.toThrow('范围')
  writeFileSync(path, Buffer.alloc(1000))
  await expect(challengeHash(path, '0-10', file, signal)).rejects.toThrow('改变')
})

test.each([false, true])('失败后只补传缺失分片并保留地址和回调，旧版区域地址=%s', async legacy => {
  const path = join(temp(), 'media.bin'), data = Buffer.alloc(350000)
  for (let i = 0; i < data.length; i++) data[i] = i % 251
  writeFileSync(path, data)
  const signal = new AbortController().signal, file = await fingerprint(path, signal)
  let cp: UploadCheckpoint = { file, partSize: 128 * 1024, parts: [] }
  let saved = '', fail = true, initCount = 0, listCount = 0
  let activeDispatch = legacy ? { ...dispatch, endpoint: undefined } : dispatch
  const getCredentials = async () => ({ ...await credentials(), ...(legacy ? { endpoint: 'https://oss-cn-shenzhen.aliyuncs.com', rate: 0 } : {}) })
  const progress: number[] = []
  const calls: number[] = [], remote = new Map<number, Buffer>()
  const factory: OSSFactory = (route, token) => {
    expect(route.endpoint).toBe(activeDispatch.endpoint || 'https://oss-cn-shenzhen.aliyuncs.com')
    expect(token.accessKeySecret).toBe('TEMP-SECRET')
    return { close() {}, client: {
      async initMultipartUpload() { initCount++; return { uploadId: 'UPLOAD-1' } as OSS.InitMultipartUploadResult },
      async listParts(_name, id) {
        listCount++
        expect(id).toBe('UPLOAD-1')
        return { uploadId: id, bucket: route.bucket, name: route.object, isTruncated: 'false', parts: [...remote].map(([n, b]) => ({ PartNumber: n, Size: b.length, ETag: digest(b) })) } as unknown as OSS.ListPartsResult
      },
      async uploadPart(_name, id, n, buffer, start, end, options) {
        calls.push(n); expect(id).toBe('UPLOAD-1'); expect(start).toBe(0); expect(end).toBe(buffer.length)
        const trafficLimit = (options as unknown as { headers: Record<string, string> }).headers['x-oss-traffic-limit']
        if (legacy) expect(trafficLimit).toBeUndefined()
        else expect(trafficLimit).toBe('819200')
        if (n === 2 && fail) throw new Error('simulated network loss')
        remote.set(n, Buffer.from(buffer))
        return { etag: digest(buffer) } as OSS.UploadPartResult
      },
      async completeMultipartUpload(_name, _id, parts, options) {
        expect(parts.map(p => p.number)).toEqual([1, 2, 3])
        expect(Buffer.from((options?.headers as Record<string, string>)['x-oss-callback']!, 'base64').toString()).toBe(dispatch.callback!)
        return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult
      },
    } }
  }
  const options = () => ({ path, dispatch: activeDispatch, checkpoint: cp, signal, credentials: getCredentials, factory, save: () => { saved = JSON.stringify(cp) }, progress: (bytes: number) => { progress.push(bytes) } })
  await expect(uploadParts(options())).rejects.toThrow('network')
  expect(listCount).toBe(0)
  expect(cp.parts.map(p => p.number)).toEqual([1])
  expect(saved).not.toContain('TEMP-')
  cp = JSON.parse(saved); fail = false
  activeDispatch = { ...dispatch, endpoint: legacy ? undefined : 'https://up-yunfile.115.com' }
  await uploadParts(options())
  expect(initCount).toBe(1)
  expect(listCount).toBe(1)
  expect(cp.endpoint).toBe(activeDispatch.endpoint || 'https://oss-cn-shenzhen.aliyuncs.com')
  expect(progress).toEqual([0, 128 * 1024, 128 * 1024, 256 * 1024, data.length])
  expect(saved).not.toContain('TEMP-')
  expect(calls).toEqual([1, 2, 2, 3])
  expect(Buffer.concat([...remote.values()])).toEqual(data)
  expect(cp.completing).toBeTrue()
})

test('没有 TMDB 的身份不依赖名称和海报，清单租约与快照持久化', () => {
  const connection = { url: 'https://example.com', hasKey: true, status: 'verified' as const, error: '', identity: { id: 'pub', name: 'pub', kind: 'publisher' as const, sourceAccount: { id: 'source', alias: 'source', name: 'source' }, categories: [{ value: 'short', label: '短剧' }] } }
  const task = { provider: 'hongguo', sourceWorkId: '123', series: '作品', title: '第一集', vid: '1', season: 1, episode: 1, tmdbId: 0, quality: '1080p', codec: 'h264', group: 'GVS', plot: '简介', posterUrl: 'https://example.com/a.jpg' } as DlTask
  const draft = preparePublication(task, connection, 'short')
  const renamed = preparePublication({ ...task, series: '新名称', posterUrl: 'https://example.com/b.jpg' }, connection, 'short')
  expect(draft.fileKey).toBe(renamed.fileKey)
  expect(preparePublication(task, connection, 'short', '123').fileKey).not.toBe(draft.fileKey)
  expect(draft.workTarget.tmdbId).toBeUndefined()
  expect(draft.workTarget.overview).toBe('简介')
  expect(preparePublication({ ...task, sourceWorkId: 'different' }, connection, 'short').fileKey).not.toBe(draft.fileKey)
  const dir = temp(), store = new PublicationStore(dir), second = new PublicationStore(dir)
  const state: PublicationState = { draft, acknowledged: 0, snapshot: { taskKey: draft.fileKey, releaseKey: draft.releaseKey, sourceAccount: 'source', workTarget: draft.workTarget, title: draft.title, attempt: 1, sequence: 4, stage: 'downloading', downloadPercent: 50, uploadPercent: 0, sizeBytes: 0, uploadedBytes: 0 } }
  store.save(state)
  expect(() => second.load()).toThrow('另一发布器')
  store.close()
  expect(second.load()[0]?.snapshot.sequence).toBe(4)
  const file = readdirSync(dir).find(n => n.endsWith('.state.json'))!
  expect(readFileSync(join(dir, file), 'utf8')).not.toContain('TEMP-')
  second.close()
})

test.each([
  ['NoSuchUpload', true, true], ['NoSuchUpload', false, false], ['ETIMEDOUT', true, false],
] as const)('旧断点仅在文件未就绪且会话已失效时迁移：%s / %s', async (code, recoverLegacyUpload, succeeds) => {
  const path = join(temp(), 'legacy.bin'), data = Buffer.alloc(150000, 9)
  writeFileSync(path, data)
  const signal = new AbortController().signal, file = await fingerprint(path, signal)
  const cp: UploadCheckpoint = { file, partSize: 256 * 1024, uploadId: 'OLD', object: dispatch.object, bucket: dispatch.bucket, pickCode: dispatch.pickCode, parts: [{ number: 1, size: data.length, etag: digest(data) }], completing: true }
  let inits = 0, uploaded = 0
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { inits++; return { uploadId: 'NEW' } as OSS.InitMultipartUploadResult },
    async listParts(_name, id) {
      if (id === 'OLD') throw Object.assign(new Error('opaque provider details'), { code })
      return { uploadId: id, bucket: dispatch.bucket, name: dispatch.object, parts: [], isTruncated: 'false' } as unknown as OSS.ListPartsResult
    },
    async uploadPart(_name, id, _number, buffer) { expect(id).toBe('NEW'); uploaded += buffer.length; return { etag: digest(buffer) } as OSS.UploadPartResult },
    async completeMultipartUpload() { return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult },
  } })
  const run = uploadParts({ path, dispatch, checkpoint: cp, credentials, factory, signal, recoverLegacyUpload, save() {}, progress() {} })
  if (succeeds) {
    await run
    expect(cp.previousUploadId).toBe('OLD')
    expect(cp.sequential).toBe(true)
    expect(cp.pickCode).toBe(dispatch.pickCode)
    expect(inits).toBe(1)
    expect(uploaded).toBe(data.length)
  } else {
    await expect(run).rejects.toThrow('opaque provider details')
    expect(inits).toBe(0)
    expect(cp.uploadId).toBe('OLD')
  }
})

test('HTTP 成功但 115 合并回调拒绝不能当作上传成功', async () => {
  const path = join(temp(), 'callback.bin'), data = Buffer.alloc(150000, 3)
  writeFileSync(path, data)
  const signal = new AbortController().signal, file = await fingerprint(path, signal)
  const cp: UploadCheckpoint = { file, partSize: 256 * 1024, parts: [] }
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: 'NEW' } as OSS.InitMultipartUploadResult },
    async listParts(_name, id) { return { uploadId: id, bucket: dispatch.bucket, name: dispatch.object, parts: [], isTruncated: 'false' } as unknown as OSS.ListPartsResult },
    async uploadPart(_name, _id, _number, buffer) { return { etag: digest(buffer) } as OSS.UploadPartResult },
    async completeMultipartUpload() { return { data: { state: false, message: 'private-provider-details' } } as unknown as OSS.CompleteMultipartUploadResult },
  } })
  await expect(uploadParts({ path, dispatch, checkpoint: cp, credentials, factory, signal, save() {}, progress() {} })).rejects.toThrow('115 合并回调未确认成功')
  expect(cp.completing).toBe(true)
  expect(cp.parts).toHaveLength(1)
})

test('顺序分片合并回执未知且会话已消失时保留断点，等待原文件核验', async () => {
  const path = join(temp(), 'pending.bin'); writeFileSync(path, Buffer.alloc(150000))
  const signal = new AbortController().signal
  const cp: UploadCheckpoint = { file: await fingerprint(path, signal), partSize: 256 * 1024, parts: [], uploadId: 'OLD', sequential: true, completing: true,
    object: dispatch.object, bucket: dispatch.bucket, pickCode: dispatch.pickCode }
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { throw new Error('不得重新初始化') },
    async listParts() { throw Object.assign(new Error('session gone'), { code: 'NoSuchUpload' }) },
    async uploadPart() { throw new Error('不得重新上传') },
    async completeMultipartUpload() { throw new Error('不得重新合并') },
  } })
  const error = await uploadParts({ path, dispatch, checkpoint: cp, credentials, factory, signal, save() {}, progress() {} }).then(() => null, e => e)
  expect(retryableError(error)).toBe(true)
  expect(cp.uploadId).toBe('OLD'); expect(cp.completing).toBe(true)
})

test('等待临时凭据期间取消，响应到达后不能再创建 OSS 会话', async () => {
  const path = join(temp(), 'cancelled.bin'); writeFileSync(path, Buffer.alloc(150000))
  const abort = new AbortController()
  const cp: UploadCheckpoint = { file: await fingerprint(path, abort.signal), partSize: 256 * 1024, parts: [] }
  let created = false
  const error = new Error('test cancelled')
  await expect(uploadParts({ path, dispatch, checkpoint: cp, signal: abort.signal, save() {}, progress() {},
    credentials: async () => { const token = await credentials(); abort.abort(error); return token },
    factory: () => { created = true; throw new Error('不得创建会话') },
  })).rejects.toThrow('test cancelled')
  expect(created).toBe(false)
  expect(cp.uploadId).toBeUndefined()
})
