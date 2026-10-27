/** 续传使用 115 最新路由；分片可继续则续办，明确失效才重建，错误和未知结果保留断点。 */
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
const old = { status: 'uploading', pickCode: 'original', bucket: 'fhnfile', object: 'old/object',
  endpoint: 'https://up-file.115.com', callback: 'old-callback', callbackVar: 'old-vars' } satisfies Dispatch
const current = { ...old, bucket: 'fhnyunfile', object: 'new/object', endpoint: 'https://up-yunfile.115.com',
  callback: 'new-callback', callbackVar: 'new-vars' } satisfies Dispatch
const credentials = async () => ({ accessKeyId: 'TEMP-ID', accessKeySecret: 'TEMP-SECRET', securityToken: 'TEMP-TOKEN',
  expiration: new Date(Date.now() + 3600000).toISOString(), endpoint: old.endpoint!, rate: 0 })

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), '115-redispatch-')); dirs.push(dir)
  const path = join(dir, 'file.bin'), data = Buffer.alloc(200000, 5), partSize = 128 * 1024
  writeFileSync(path, data)
  const signal = new AbortController().signal
  const cp: UploadCheckpoint = { file: await fingerprint(path, signal), partSize,
    uploadId: 'OLD', pickCode: old.pickCode, bucket: old.bucket, object: old.object, endpoint: old.endpoint,
    sequential: true, completing: false, parts: [{ number: 1, size: partSize, etag: digest(data.subarray(0, partSize)) }] }
  return { path, data, signal, cp }
}

test.each(['bucket', 'object', 'all'])('新续传参数生效，仍有效的分片会话继续且重启不丢断点：%s', async change => {
  const f = await fixture()
  const dispatch = { ...current, ...(change === 'bucket' ? { object: old.object } : change === 'object' ? { bucket: old.bucket } : {}) }
  let cp = f.cp, saved = '', fail = true, lists = 0, inits = 0
  const puts: number[] = []
  const factory: OSSFactory = route => {
    expect(route).toEqual(dispatch)
    return { close() {}, client: {
      async initMultipartUpload() { inits++; throw new Error('valid upload must not be recreated') },
      async listParts(name, id) {
        lists++; expect(name).toBe(dispatch.object); expect(id).toBe('OLD')
        return { uploadId: id, bucket: dispatch.bucket, name: encodeURIComponent(dispatch.object!), isTruncated: false,
          parts: [{ PartNumber: 1, Size: cp.partSize, ETag: cp.parts[0]!.etag }] } as unknown as OSS.ListPartsResult
      },
      async uploadPart(name, id, number, buffer) {
        expect(name).toBe(dispatch.object); expect(id).toBe('OLD'); puts.push(number)
        expect(JSON.parse(saved)).toMatchObject({ object: dispatch.object, bucket: dispatch.bucket, endpoint: dispatch.endpoint })
        if (fail) throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' })
        return { etag: digest(buffer) } as OSS.UploadPartResult
      },
      async completeMultipartUpload(name, id, parts, options) {
        expect(name).toBe(dispatch.object); expect(id).toBe('OLD')
        expect(parts.map(p => p.number)).toEqual([1, 2])
        const headers = options!.headers as Record<string, string>
        expect(Buffer.from(headers['x-oss-callback']!, 'base64').toString()).toBe(current.callback!)
        expect(Buffer.from(headers['x-oss-callback-var']!, 'base64').toString()).toBe(current.callbackVar!)
        return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult
      },
    } }
  }
  const run = () => uploadParts({ ...f, dispatch, checkpoint: cp, credentials, factory, save() { saved = JSON.stringify(cp) }, progress() {} })
  await expect(run()).rejects.toThrow('上传第 2 片失败')
  cp = JSON.parse(saved); fail = false
  await run()
  expect(lists).toBe(2); expect(inits).toBe(0); expect(puts).toEqual([2, 2])
  expect(cp.completion).toEqual({ pickCode: 'original' })
  expect(saved).not.toContain('TEMP-')
})

test('新路由明确返回旧会话不存在，清除旧分片后按新参数建会话，初始化断网后仍可恢复', async () => {
  const f = await fixture()
  let cp = f.cp, saved = '', failInit = true, inits = 0, lists = 0
  const puts: number[] = [], progress: number[] = []
  const factory: OSSFactory = route => {
    expect(route).toEqual(current)
    return { close() {}, client: {
      async listParts(name, id) {
        lists++; expect(name).toBe(current.object); expect(id).toBe('OLD')
        throw Object.assign(new Error('session absent'), { code: 'NoSuchUpload' })
      },
      async initMultipartUpload(name) {
        inits++; expect(name).toBe(current.object)
        expect(JSON.parse(saved)).toMatchObject({ bucket: current.bucket, object: current.object, parts: [], previousUploadId: 'OLD' })
        if (failInit) throw Object.assign(new Error('not connected'), { code: 'ECONNRESET' })
        return { uploadId: 'NEW' } as OSS.InitMultipartUploadResult
      },
      async uploadPart(name, id, number, buffer) {
        expect(name).toBe(current.object); expect(id).toBe('NEW'); puts.push(number)
        return { etag: digest(buffer) } as OSS.UploadPartResult
      },
      async completeMultipartUpload(name, id, parts) {
        expect(name).toBe(current.object); expect(id).toBe('NEW'); expect(parts.map(p => p.number)).toEqual([1, 2])
        return { data: { state: true } } as unknown as OSS.CompleteMultipartUploadResult
      },
    } }
  }
  const run = () => uploadParts({ ...f, dispatch: current, checkpoint: cp, credentials, factory, save() { saved = JSON.stringify(cp) }, progress(bytes) { progress.push(bytes) } })
  await expect(run()).rejects.toThrow('创建上传会话失败')
  cp = JSON.parse(saved)
  expect(cp.uploadId).toBeUndefined(); expect(cp.parts).toEqual([])
  failInit = false
  await run()
  expect(lists).toBe(1); expect(inits).toBe(2); expect(puts).toEqual([1, 2])
  expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(f.data.length)
  expect(cp).toMatchObject({ uploadId: 'NEW', object: current.object, bucket: current.bucket, completion: { pickCode: 'original' } })
})

test.each(['ECONNRESET', 'AccessDenied', 'SlowDown', 'NoSuchUpload'])('续传变更路由不把错误或合并未知变成重建：%s', async code => {
  const f = await fixture()
  f.cp.completing = code === 'NoSuchUpload'
  const before = structuredClone(f.cp)
  let mutations = 0
  const factory: OSSFactory = route => {
    expect(route).toEqual(current)
    return { close() {}, client: {
      async listParts(name, id) { expect(name).toBe(current.object); expect(id).toBe('OLD'); throw Object.assign(new Error('private details'), { code }) },
      async initMultipartUpload() { mutations++; throw new Error('must not initialize') },
      async uploadPart() { mutations++; throw new Error('must not upload') },
      async completeMultipartUpload() { mutations++; throw new Error('must not complete') },
    } }
  }
  await expect(uploadParts({ ...f, dispatch: current, checkpoint: f.cp, credentials, factory, save() {}, progress() {} })).rejects.toThrow()
  expect(mutations).toBe(0)
  expect(f.cp.uploadId).toBe(before.uploadId); expect(f.cp.parts).toEqual(before.parts)
  expect(f.cp.completing).toBe(before.completing!); expect(f.cp.completion).toBeUndefined()
})

test('对象存储参数可变，原上传任务码仍不能替换', async () => {
  const f = await fixture()
  let requests = 0
  await expect(uploadParts({ ...f, dispatch: { ...current, pickCode: 'different' }, checkpoint: f.cp,
    credentials: async () => { requests++; return credentials() }, save() {}, progress() {} })).rejects.toThrow('续传任务标识变化')
  expect(requests).toBe(0); expect(f.cp.uploadId).toBe('OLD')
})
