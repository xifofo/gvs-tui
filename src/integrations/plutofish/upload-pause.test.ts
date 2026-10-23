/** 限流暂停在本地临时目录验证；不创建网络连接。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UploadPauses, UploadRateLimitError, uploadRateLimited } from './upload-pause'
import { retryableError } from './retry'

test('账号限流跨重启保留，冷却结束仍需显式恢复；其他账号不受影响', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upload-pause-'))
  let now = 100000
  const binding = { url: 'http://localhost', publisherId: 'p', sourceAccount: { id: 'source', alias: 'main' } }
  try {
    const first = new UploadPauses(dir, () => now)
    first.block(binding)
    expect(first.paused(binding)).toBe(true)
    expect(first.paused({ ...binding, sourceAccount: { id: 'other', alias: 'other' } })).toBe(false)
    const second = new UploadPauses(dir, () => now)
    expect(() => second.resume(binding)).toThrow('冷却')
    now += 16 * 60_000
    expect(() => second.assert(binding)).toThrow('队列已暂停')
    second.block(binding) // 本地拒绝不延长冷却。
    second.resume(binding)
    expect(new UploadPauses(dir).paused(binding)).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('仅 115 访问受限暂停账号，OSS 暂时繁忙保留有限退避', () => {
  expect(uploadRateLimited(new UploadRateLimitError())).toBe(true)
  expect(retryableError(new UploadRateLimitError())).toBe(false)
  for (const error of [{ code: 'SlowDown' }, { status: 429 }, { status: 503 }]) {
    expect(uploadRateLimited(error)).toBe(false)
    expect(retryableError(error)).toBe(true)
  }
  expect(uploadRateLimited(new Error('SlowDown'))).toBe(false)
})
