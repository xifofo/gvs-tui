/** 暂停可能丢失分片回执：只用远端列表与本地 MD5 核对，不读取网盘片段。 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type OSS from 'ali-oss'
import { fingerprint } from './upload-file.ts'
import { uploadParts, type OSSFactory } from './oss-upload.ts'
import type { Dispatch, UploadCheckpoint } from './upload-types.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const digest = (data: Buffer) => createHash('md5').update(data).digest('hex').toUpperCase()
const dispatch: Dispatch = { status: 'uploading', pickCode: 'original', bucket: 'bucket', object: 'original/object',
  endpoint: 'https://up-file.115.com', callback: '{}' }
const credentials = async () => ({ accessKeyId: 'TEMP-ID', accessKeySecret: 'TEMP-SECRET', securityToken: 'TEMP-TOKEN',
  expiration: new Date(Date.now() + 3600000).toISOString(), endpoint: dispatch.endpoint!, rate: 0 })

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), '115-lost-receipt-')); dirs.push(dir)
  const path = join(dir, 'file.bin'), data = Buffer.alloc(300000), partSize = 128 * 1024
  for (let i = 0; i < data.length; i++) data[i] = i % 251
  writeFileSync(path, data)
  const signal = new AbortController().signal
  const cp: UploadCheckpoint = { file: await fingerprint(path, signal), partSize, parts: [] }
  const part = (number: number) => {
    const bytes = data.subarray((number - 1) * partSize, number * partSize)
    return { PartNumber: number, Size: bytes.length, ETag: `"${digest(bytes).toLowerCase()}"` }
  }
  const page = (parts: ReturnType<typeof part>[]) => ({ uploadId: 'ACTIVE', bucket: dispatch.bucket,
    name: encodeURIComponent(dispatch.object!), isTruncated: false, parts }) as unknown as OSS.ListPartsResult
  const options = { path, signal, checkpoint: cp, dispatch, credentials, save() {}, progress(_bytes: number) {} }
  return { cp, data, part, page, options }
}

test('暂停时远端已接收但本地未保存回执，重启后核对并续传，不重复 PUT', async () => {
  const f = await fixture(), abort = new AbortController()
  let saved = '', lost = true, inits = 0
  const remote = new Map<number, ReturnType<typeof f.part>>(), puts: number[] = [], progress: number[] = []
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { inits++; return { uploadId: 'ACTIVE' } as OSS.InitMultipartUploadResult },
    async listParts() { return f.page([...remote.values()]) },
    async uploadPart(_name, _id, number, buffer) {
      puts.push(number)
      if (remote.has(number)) throw Object.assign(new Error('already accepted'), { code: 'PartAlreadyExist', status: 409 })
      remote.set(number, f.part(number))
      if (number === 2 && lost) { abort.abort(new Error('paused')); throw abort.signal.reason }
      return { etag: digest(buffer) } as OSS.UploadPartResult
    },
    async completeMultipartUpload(_name, id, parts) {
      expect(id).toBe('ACTIVE'); expect(parts.map(p => p.number)).toEqual([1, 2, 3])
      return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult
    },
  } })
  let cp = f.cp
  const run = (signal: AbortSignal) => uploadParts({ ...f.options, checkpoint: cp, signal, factory,
    save() { saved = JSON.stringify(cp) }, progress(bytes) { progress.push(bytes) } })
  await expect(run(abort.signal)).rejects.toThrow()
  expect(cp.parts.map(p => p.number)).toEqual([1])
  cp = JSON.parse(saved); lost = false
  await run(new AbortController().signal)
  expect(inits).toBe(1); expect(puts).toEqual([1, 2, 3])
  expect(cp.parts.map(p => p.number)).toEqual([1, 2, 3])
  expect(cp.completion).toEqual({ pickCode: 'original' })
  expect(progress.at(-1)).toBe(f.data.length)
  expect(saved).not.toContain('TEMP-')
})

test('跨页恢复全部未落盘回执，包含最后不足一片的内容，核对后才持久化', async () => {
  const f = await fixture()
  Object.assign(f.cp, { uploadId: 'ACTIVE', pickCode: dispatch.pickCode, sequential: true })
  const markers: number[] = [], saved: string[] = []
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { throw new Error('must keep upload') },
    async listParts(_name, _id, options) {
      const marker = Number(options!['part-number-marker']); markers.push(marker)
      return marker === 0 ? { ...f.page([f.part(1), f.part(2)]), isTruncated: true, nextPartNumberMarker: 2 } : f.page([f.part(3)])
    },
    async uploadPart() { throw new Error('must not overwrite verified part') },
    async completeMultipartUpload(_name, _id, parts) {
      expect(parts.map(p => p.number)).toEqual([1, 2, 3])
      return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult
    },
  } })
  await uploadParts({ ...f.options, factory, save() { saved.push(JSON.stringify(f.cp)) } })
  expect(markers).toEqual([0, 2])
  expect(saved.some(value => JSON.parse(value).parts.length === 1)).toBe(true)
  expect(f.cp.parts.at(-1)?.size).toBe(f.part(3).Size)
})

test.each(['md5', 'size', 'etag'])('远端未落盘分片不匹配时保留会话，禁止覆盖或合并：%s', async mismatch => {
  const f = await fixture()
  Object.assign(f.cp, { uploadId: 'ACTIVE', pickCode: dispatch.pickCode, sequential: true })
  const part = f.part(1)
  if (mismatch === 'md5') part.ETag = 'A'.repeat(32)
  if (mismatch === 'size') part.Size--
  if (mismatch === 'etag') part.ETag = 'invalid'
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { throw new Error('must keep upload') },
    async listParts() { return f.page([part]) },
    async uploadPart() { throw new Error('must not overwrite mismatched part') },
    async completeMultipartUpload() { throw new Error('must not complete') },
  } })
  await expect(uploadParts({ ...f.options, factory })).rejects.toThrow('与本地文件不一致')
  expect(f.cp.uploadId).toBe('ACTIVE'); expect(f.cp.parts).toEqual([]); expect(f.cp.completion).toBeUndefined()
})

test.each(['match', 'missing', 'md5', 'size', 'uploadId', 'bucket', 'object', 'network', 'abort'])('PUT 返回 PartAlreadyExist 后只核对该片，不盲目确认：%s', async result => {
  const f = await fixture(), abort = new AbortController()
  let lists = 0, completed = false
  const puts: number[] = []
  const factory: OSSFactory = () => ({ close() {}, client: {
    async initMultipartUpload() { return { uploadId: 'ACTIVE' } as OSS.InitMultipartUploadResult },
    async listParts(name, id, options) {
      lists++; expect(name).toBe(dispatch.object!); expect(id).toBe('ACTIVE')
      expect(options).toMatchObject({ 'part-number-marker': 0, 'max-parts': 1 })
      if (result === 'network') throw Object.assign(new Error('private token'), { code: 'ECONNRESET' })
      if (result === 'abort') abort.abort(new Error('paused'))
      const part = f.part(1)
      if (result === 'md5') part.ETag = 'A'.repeat(32)
      if (result === 'size') part.Size--
      const page = f.page(result === 'missing' ? [f.part(2)] : [part])
      if (result === 'uploadId') page.uploadId = 'OTHER'
      if (result === 'bucket') page.bucket = 'other-bucket'
      if (result === 'object') page.name = 'other/object'
      return page
    },
    async uploadPart(_name, _id, number, buffer) {
      puts.push(number)
      if (number === 1) throw Object.assign(new Error('private token'), { code: 'PartAlreadyExist', status: 409, requestId: '0123456789ABCDEF' })
      return { etag: digest(buffer) } as OSS.UploadPartResult
    },
    async completeMultipartUpload() { completed = true; return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult },
  } })
  const run = uploadParts({ ...f.options, signal: abort.signal, factory })
  if (result === 'match') {
    await run
    expect(f.cp.parts.map(p => p.number)).toEqual([1, 2, 3]); expect(completed).toBe(true)
    expect(puts).toEqual([1, 2, 3])
  } else {
    await expect(run).rejects.toThrow()
    expect(f.cp.parts).toEqual([]); expect(completed).toBe(false); expect(puts).toEqual([1])
    expect(f.cp.uploadId).toBe('ACTIVE')
  }
  expect(lists).toBe(1)
})
