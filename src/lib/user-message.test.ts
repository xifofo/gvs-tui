import { expect, test } from 'bun:test'
import { userMessage, userFacing } from './user-message'
import { errorCatalog } from './user-message-catalog'
import { IQAudioValidationError } from './iq-mux'
import { IQAudioTransferError } from './iq-transfer'
import { DownloaderCompatibilityError } from './downloader-error'

test('unsupported media is not presented as a timeout or CDN failure, including restored errors', () => {
  const raw = 'N_m3u8DL-RE 下载失败 (1): HTTP 502; connection timed out; Unsupported IQ mdcm encryption pattern https://private.invalid?token=PRIVATE'
  const message = userMessage(new DownloaderCompatibilityError(raw))
  expect(message).toContain('视频分片格式')
  expect(message).toContain('反复重试无法解决')
  expect(message).toContain('分片已保留')
  expect(message).not.toMatch(/PRIVATE|token|https|超时|CDN/)
  expect(userMessage(raw)).toBe(message)
  expect(userMessage(message)).toBe(message)
  expect(userMessage('HTTP 502')).not.toBe(message)
  expect(userMessage('Unsupported socket option')).not.toBe(message)
})

test('native downloader crashes have a local component explanation in restored jobs too', () => {
  const raw = 'N_m3u8DL-RE 下载失败 (SIGABRT): Fatal error. System.AccessViolationException private-secret'
  const message = userMessage(new Error(raw))
  expect(message).toContain('本机下载组件异常退出')
  expect(message).toContain('更新客户端')
  expect(message).not.toMatch(/SIGABRT|AccessViolation|private|联系客服/)
  expect(userMessage(raw)).toBe(message)
  expect(userMessage(message)).toBe(message)
  expect(userMessage('N_m3u8DL-RE 下载失败 (1): ordinary failure')).not.toBe(message)
})

test('subtitle encoder failure is not reported as missing content', () => {
  const raw = '解密后音视频校验失败：[sost#0:2 @ 0000021908d2f800] Automatic encoder selection failed Default encoder for format null (codec none) is probably disabled. Please choose an encoder manually.；Error opening output files: Encoder not found'
  const message = userMessage(raw)
  expect(message).toContain('音视频检查未通过')
  expect(message).not.toContain('未找到所需内容')
  expect(message).not.toMatch(/sost|Encoder|null/)
  expect(userMessage(message)).toBe(message)
  expect(userMessage('Encoder not found')).not.toContain('未找到所需内容')
  expect(userMessage('http 404')).toContain('未找到所需内容')
})

test('IQ exhausted audio retries explain what can be resumed without exposing the network error',()=>{
  const error=new IQAudioTransferError(2,5,new Error('net::ERR_CONNECTION_CLOSED https://private.invalid?token=PRIVATE'))
  const message=userMessage(error)
  expect(message).toContain('音轨分段下载失败')
  expect(message).toContain('视频和音轨分段会保留')
  expect(message).not.toMatch(/PRIVATE|token|https|CONNECTION/)
  expect(userMessage(error.message)).toBe(message)
  expect(userMessage(message)).toBe(message)
  expect(error.message).toContain('第 3/5 段')
  expect(error.cause).toBeInstanceOf(Error)
})

test('IQ audio validation has an actionable display message while retaining diagnostic details',()=>{
  const error=new IQAudioValidationError('ffmpeg: Invalid data /private/path token=PRIVATE')
  const message=userMessage(error)
  expect(message).toContain('音轨检查未通过')
  expect(message).toContain('重新下载音轨')
  expect(message).toContain('视频会保留')
  expect(message).not.toMatch(/PRIVATE|token|ffmpeg|private/)
  expect(error.message).toContain('Invalid data')
  expect(userMessage(error.message)).toBe(message)
  expect(userMessage('IQ 封装或音轨验收失败 (234): Error submitting packet to decoder')).toContain('音视频封装或音轨检查未通过')
})

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
  // 同一个 code 允许对应多条 pattern（例如 MEMBERSHIP_REQUIRED）；按 code 展示第一条。
  const firstByCode = new Map<string, string>()
  for (const rule of errorCatalog) if (!firstByCode.has(rule.code)) firstByCode.set(rule.code, rule.message)
  for (const rule of errorCatalog) {
    const message = userMessage({ errorCode: rule.code, message: 'unrelated diagnostic' })
    expect(message).toBe(firstByCode.get(rule.code))
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
