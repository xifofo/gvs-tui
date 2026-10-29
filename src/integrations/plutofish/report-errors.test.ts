/** 真实 HTTP 错误响应验证资源登记提示、原请求诊断与敏感正文隔离。 */
import { expect, test } from 'bun:test'
import { PlutoFishConnection } from './connection'
import { PublisherError } from './retry'

test('resource registration shows concrete safe reasons and retains the request ID', async () => {
  let code = 'CONTENT_EDITION_MISSING', status = 500
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ error: {
    code, message: 'PRIVATE database password and SQL', detail: 'PRIVATE file and pickCode',
  } }, { status, headers: { 'x-request-id': '0123456789abcdef0123456789abcdef', 'retry-after': '5' } }) })
  const identity = { id: 'publisher', name: 'publisher', kind: 'publisher' as const, sourceAccount: { id: 'source', name: 'source', alias: 'source' } }
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'PRIVATE-key' }), verify: async () => identity })
  try {
    await connection.verify()
    const request = async () => {
      try {
        await connection.request({ url: server.url.origin, publisherId: identity.id, sourceAccount: identity.sourceAccount }, 'files/report', {})
        throw new Error('expected registration failure')
      } catch (error) {
        if (!(error instanceof PublisherError)) throw error
        expect(error.message + JSON.stringify(error)).not.toContain('PRIVATE')
        expect(error.diagnostic?.stage).toBe('登记资源')
        expect(error.diagnostic?.requestId).toBe('0123456789abcdef0123456789abcdef')
        expect(error.diagnostic?.httpStatus).toBe(status)
        return error
      }
    }

    const missing = await request()
    expect(missing.message).toContain('数据库缺少发行规格字段（edition）')
    expect(missing.message).toContain('HTTP 500')
    expect(missing.retryable).toBe(false)
    expect(connection.ready).toBe(true)

    for (const [next, hint, retryable] of [
      ['CONTENT_SCHEMA_MISMATCH', '数据库迁移', false],
      ['CONTENT_DATABASE_CONSTRAINT', '一致性校验', false],
      ['CONTENT_DATABASE_BUSY', '事务冲突', true],
      ['CONTENT_DATABASE_UNAVAILABLE', '无法连接数据库', true],
      ['CONTENT_DATABASE_PLAN_STALE', '旧结构', true],
    ] as const) {
      code = next
      const error = await request()
      expect(error.message).toContain(hint)
      expect(error.retryable).toBe(retryable)
    }

    status = 409; code = 'CONTENT_FILE_REMOVED'
    const removed = await request()
    expect(removed.message).toContain('该文件已从版本中删除')
    expect(removed.retryable).toBe(false)

    status = 500
    for (const unknown of ['INTERNAL_ERROR', 'toString', '__proto__']) {
      code = unknown
      const error = await request()
      expect(error.message).toContain('服务端未提供可识别的具体原因')
      expect(error.retryable).toBe(true)
    }

    // 即使服务端错误码不一致，鉴权状态仍按 HTTP 状态处理，不被登记错误映射绕过。
    status = 401; code = 'CONTENT_EDITION_MISSING'
    await request()
    expect(connection.ready).toBe(false)
  } finally { connection.close(); server.stop(true) }
})
