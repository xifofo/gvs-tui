/** 本地流与模拟时钟验证速率、续传基线和取消；不请求任何网盘。 */
import { expect, test } from 'bun:test'
import { Readable } from 'node:stream'
import { mkdtempSync, writeFileSync, statSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UploadBudget, UploadMeter, uploadStream } from './upload-traffic.ts'
import { fingerprint } from './upload-file.ts'

test('续传基线不计入速度，滑动窗口停滞后归零', () => {
  let now = 0
  const meter = new UploadMeter(10000, 5000, () => now)
  expect(meter.sample(1000).bytesPerSecond).toBe(0)
  now = 1000; meter.sent(6000)
  expect(meter.sample(1000)).toEqual({ sentBytes: 6000, bytesPerSecond: 1000, etaSeconds: 4, rateLimit: 1000 })
  now = 6000; meter.sample(1000)
  now = 7000
  expect(meter.sample(1000).bytesPerSecond).toBe(0)
  expect(meter.sample(1000).etaSeconds).toBeUndefined()
})

test('两个流共用账号预算，发送中有进度；一个结束后另一流可独享预算', async () => {
  const budget = new UploadBudget(); budget.setRate(128 * 1024)
  const signal = new AbortController().signal
  const received: number[][] = [[], []]
  const started = performance.now()
  await Promise.all([0, 1].map(async index => {
    let total = 0
    for await (const chunk of uploadStream(Readable.from([Buffer.alloc(128 * 1024)]), budget, signal, n => received[index]!.push(n))) total += chunk.length
    expect(total).toBe(128 * 1024)
  }))
  expect(performance.now() - started).toBeGreaterThanOrEqual(1900)
  for (const events of received) { expect(events.length).toBeGreaterThan(2); expect(events.at(-1)).toBe(128 * 1024) }
  const single = performance.now()
  for await (const _ of uploadStream(Readable.from([Buffer.alloc(64 * 1024)]), budget, signal)) { /* 按发送节奏消费 */ }
  expect(performance.now() - single).toBeLessThan(900)
})

test('限速等待可取消，更新为不限速后不继续人为等待', async () => {
  const budget = new UploadBudget(); budget.setRate(102400)
  const abort = new AbortController()
  const stream = uploadStream(Readable.from([Buffer.alloc(1024 * 1024)]), budget, abort.signal)
  const reading = (async () => { for await (const _ of stream) { /* 消费直到取消 */ } })()
  setTimeout(() => abort.abort(), 30)
  await expect(reading).rejects.toThrow()
  budget.setRate(0)
  let total = 0
  for await (const chunk of uploadStream(Readable.from([Buffer.alloc(10000)]), budget, new AbortController().signal)) total += chunk.length
  expect(total).toBe(10000)
})

test('进程内摘要复用不受调用者修改污染，同大小改写并恢复 mtime 仍重新校验', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'upload-cache-')), path = join(directory, 'file')
  try {
    writeFileSync(path, Buffer.alloc(1024 * 1024, 1))
    const signal = new AbortController().signal, before = statSync(path)
    const first = await fingerprint(path, signal), expected = first.sha1
    first.sha1 = 'invalid'
    expect((await fingerprint(path, signal)).sha1).toBe(expected)
    await new Promise(resolve => setTimeout(resolve, 5))
    writeFileSync(path, Buffer.alloc(1024 * 1024, 2)); utimesSync(path, before.atime, before.mtime)
    expect((await fingerprint(path, signal)).sha1).not.toBe(expected)
    const abort = new AbortController(); abort.abort()
    await expect(fingerprint(path, abort.signal)).rejects.toThrow()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
