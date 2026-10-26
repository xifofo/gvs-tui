/** 上传错误从真实 HTTP 边界转换为固定提示，供应商正文不能进入 UI。 */
import { expect, test } from 'bun:test'
import { PlutoFishConnection } from './connection.ts'
import { PublisherError } from './retry.ts'
import { userMessage } from '../../lib/user-message.ts'
import { ossFailure, publicationFailure } from './publication-error.ts'

test('上传调度错误可读、保留原任务重试提示；撤权仍锁定连接', async () => {
  let status = 502, code = 'CLOUD_UPLOAD_RESPONSE'
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ error: { code, message: 'private-provider-token' } }, { status }) })
  const identity = { id: 'publisher', name: '上传端', kind: 'publisher' as const, sourceAccount: { id: 'source', name: '源账号', alias: 'main' } }
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'private-publisher-token' }), verify: async () => identity })
  const binding = { url: server.url.origin, publisherId: identity.id, sourceAccount: identity.sourceAccount }
  try {
    await connection.verify()
    for (const value of ['CLOUD_UPLOAD_RESPONSE', 'CLOUD_PROVIDER_RESPONSE', 'CLOUD_UPLOAD_UNCERTAIN', 'CLOUD_UPLOAD_MISMATCH']) {
      code = value
      const error = await connection.request(binding, 'uploads/prepare', {}).then(() => null, e => e as Error)
      expect(error).toBeInstanceOf(Error)
      expect(error!.message).toContain('重试')
      expect(error!.message).not.toContain('private-')
      expect(userMessage(error!.message)).toBe(error!.message)
      expect(connection.ready).toBe(true)
    }
    status = 403
    await expect(connection.request(binding, 'uploads/prepare', {})).rejects.toThrow('HTTP 403')
    expect(connection.ready).toBe(false)
  } finally { connection.close(); server.stop(true) }
})


test('115 限流和未知业务拒绝不能被 HTTP 502 转成自动重试', async () => {
  let code = 'CLOUD_ACCESS_LIMIT'
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ error: { code, message: 'private-provider-token' } }, { status: 502 }) })
  const identity = { id: 'publisher', name: '上传端', kind: 'publisher' as const, sourceAccount: { id: 'source', name: '源账号', alias: 'main' } }
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'offline-key' }), verify: async () => identity })
  try {
    await connection.verify()
    const binding = { url: server.url.origin, publisherId: identity.id, sourceAccount: identity.sourceAccount }
    for (code of ['CLOUD_ACCESS_LIMIT', 'CLOUD_UPLOAD_SEARCH_LIMIT', 'CLOUD_REFRESH_PAUSED', 'CLOUD_NEW_REJECTION']) {
      const error = await connection.request(binding, 'uploads/prepare', {}).then(() => null, error => error)
      expect(error).toBeInstanceOf(PublisherError)
      expect(error.retryable).toBe(false)
      expect(error.message).not.toContain('private-')
    }
  } finally { connection.close(); server.stop(true) }
})

test('错误详情保留阶段、HTTP 状态与系统码，不保存原始响应和访问地址', () => {
  const inner = Object.assign(new Error('Bearer SECRET https://storage.invalid/?token=SECRET'), { code: 'ECONNRESET', status: 502 })
  const error = Object.assign(new Error('private body'), { code: 'RequestError', cause: inner, requestId: '0123456789ABCDEF' })
  const failure = ossFailure(error, '上传第 2 片', 2)
  expect(failure.message).toBe('上传第 2 片失败：网络连接被重置')
  expect(failure.retryable).toBe(true)
  expect(failure.diagnostic).toEqual({ stage: '上传第 2 片', partNumber: 2, code: 'ECONNRESET', httpStatus: 502, requestId: '0123456789ABCDEF' })
  expect(publicationFailure(failure, '上传文件').diagnostic).toEqual(failure.diagnostic)
  expect(JSON.stringify(failure)).not.toContain('SECRET')
  expect(JSON.stringify(ossFailure({ code: 'https://secret', requestId: 'token=secret', status: -1 }, '核对续传分片'))).not.toContain('secret')
})

test('上传调度 502 的具体代码和请求编号保留到错误详情', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ error: { code: 'CLOUD_PROVIDER_RESPONSE', message: 'SECRET' } },
    { status: 502, headers: { 'x-request-id': '12345678-1234-1234-1234-123456789abc' } }) })
  const identity = { id: 'publisher', name: '上传端', kind: 'publisher' as const, sourceAccount: { id: 'source', name: '源账号', alias: 'main' } }
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'offline-key' }), verify: async () => identity })
  try {
    await connection.verify()
    const error = await connection.request({ url: server.url.origin, publisherId: identity.id, sourceAccount: identity.sourceAccount }, 'uploads/prepare', { action: 'start' }).catch(error => error)
    if (!(error instanceof PublisherError)) throw new Error('应返回结构化上传错误')
    expect(error.diagnostic).toEqual({ stage: '申请上传', code: 'CLOUD_PROVIDER_RESPONSE', httpStatus: 502, requestId: '12345678-1234-1234-1234-123456789abc' })
    expect(JSON.stringify(error)).not.toContain('SECRET')
  } finally { connection.close(); server.stop(true) }
})
