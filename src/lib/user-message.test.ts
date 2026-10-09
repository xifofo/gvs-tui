import { expect, test } from 'bun:test'
import { userMessage, userFacing } from './user-message'
import { errorCatalog } from './user-message-catalog'

test('unknown and legacy errors become readable text without speculative causes', () => {
  for (const input of [
    'PROVIDER_UNAVAILABLE: IQ_DASH_PROGRAM_MISSING; diagnostic={"msg":"VIP_REQUIRED"}',
    'IQ_DASH_PROGRAM_MISSING',
  ]) {
    const message = userMessage(new Error(input))
    expect(message).toContain('播放内容')
    expect(message).not.toMatch(/VIP|地区|diagnostic|IQ_DASH/)
  }
  expect(userMessage('a future server error')).toContain('联系客服')
  expect(userMessage('请填写订单号后再查询。')).toBe('请填写订单号后再查询。')
})

test('machine code takes precedence and messages are idempotent', () => {
  for (const rule of errorCatalog) {
    const message = userMessage({ errorCode: rule.code, message: 'unrelated diagnostic' })
    expect(message).toBe(rule.message)
    expect(userMessage(message)).toBe(message)
    expect(message).not.toMatch(/[A-Z]+_[A-Z_]+|diagnostic|https?:\/\//)
  }
})

test('customer display hides internal paths, tokens, HTML, JSON and stack traces', () => {
  for (const raw of [
    '读取失败: {"token":"private-secret"}',
    'http 502: <html>private-host</html>',
    'ENOENT: C:\\private\\secret.txt',
    '错误：SQL SELECT token FROM accounts',
    'Get "https://private.example?token=secret": dial tcp 10.0.0.1:443',
    'TypeError: Cannot read properties of undefined',
    '失败：' + 'secret'.repeat(500),
  ]) expect(userMessage(raw)).not.toMatch(/private|secret|SELECT|TypeError|token|10\.0\.0\.1|<html>/)
  expect(userMessage(new DOMException('The operation was aborted', 'AbortError'))).toContain('取消')
  expect(userMessage('ENOSPC')).toContain('磁盘空间不足')
})

test('snapshots and stored jobs are sanitized without mutating IDs or successful data', () => {
  const data = { jobs: [{ err: 'IQ_DASH_PROGRAM_MISSING', id: 'IQ_DASH_PROGRAM_MISSING', log: 'technical log' }], keyError: 'INVALID_API_KEY', nested: { error: '' } }
  const result = userFacing(data)
  expect(result.jobs[0]!.err).toContain('播放内容')
  expect(result.jobs[0]!.id).toBe('IQ_DASH_PROGRAM_MISSING')
  expect(result.jobs[0]!.log).toBe('technical log')
  expect(result.keyError).toContain('密钥')
  expect(result.nested.error).toBe('')
  expect(data.jobs[0]!.err).toBe('IQ_DASH_PROGRAM_MISSING')
  expect(userFacing({ authenticated: true, summary: '已登录；播放仍以源站授权为准' }).summary).toBe('已登录，可继续选择内容。')
  expect(userFacing({ summary: 'original English synopsis' }).summary).toBe('original English synopsis')
})
