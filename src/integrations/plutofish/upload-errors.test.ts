/** 上传错误从真实 HTTP 边界转换为固定提示，供应商正文不能进入 UI。 */
import { expect, test } from 'bun:test'
import { PlutoFishConnection } from './connection.ts'
import { PublisherError } from './retry.ts'
import { userMessage } from '../../lib/user-message.ts'

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
