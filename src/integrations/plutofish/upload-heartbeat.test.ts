import { expect, test } from 'bun:test'
import { UploadHeartbeat } from './upload-heartbeat'
import { PublisherError } from './retry'
import { UploadRateLimitError } from './upload-pause'

test('心跳短暂断网可继续续期，只有超过最后确认的安全窗口才中止', async () => {
  let now = 0, offline = true, calls = 0
  const abort = new AbortController(), failures: unknown[] = []
  const network = Object.assign(new Error('offline'), { code: 'ECONNRESET' })
  const heartbeat = new UploadHeartbeat(abort.signal, async () => { calls++; if (offline) throw network }, error => { failures.push(error); abort.abort(error) }, () => now)
  try {
    heartbeat.confirmed(now)
    now = 20_000; await heartbeat.tick()
    now = 40_000; await heartbeat.tick()
    expect(failures).toEqual([]); expect(abort.signal.aborted).toBe(false)
    offline = false; now = 60_000; await heartbeat.tick()
    offline = true; now = 160_000; await heartbeat.tick()
    expect(failures).toEqual([])
    now = 180_000; await heartbeat.tick()
    expect(failures).toEqual([network]); expect(abort.signal.aborted).toBe(true)
    expect(calls).toBe(4)
  } finally { await heartbeat.close() }
})

test.each([new PublisherError('撤权', false), new UploadRateLimitError(),
  new PublisherError('租约已被占用', true, undefined, { stage: '续期上传租约', httpStatus: 409 }),
])('心跳业务拒绝、限流和失去租约立即中止：%s', async failure => {
  const abort = new AbortController(), failures: unknown[] = []
  const heartbeat = new UploadHeartbeat(abort.signal, async () => { throw failure }, error => { failures.push(error); abort.abort(error) })
  try {
    heartbeat.confirmed(Date.now()); await heartbeat.tick()
    expect(failures).toEqual([failure]); expect(abort.signal.aborted).toBe(true)
  } finally { await heartbeat.close() }
})

test('慢心跳按发起时间续期且不并发，关闭取消在途请求而不产生上传失败', async () => {
  let now = 0, calls = 0, release!: () => void
  const failures: unknown[] = [], abort = new AbortController()
  const heartbeat = new UploadHeartbeat(abort.signal, signal => {
    calls++
    return new Promise<void>((resolve, reject) => {
      const stopped = () => reject(signal.reason)
      signal.addEventListener('abort', stopped, { once: true })
      release = () => { signal.removeEventListener('abort', stopped); resolve() }
    })
  }, error => { failures.push(error); abort.abort(error) }, () => now)
  try {
    heartbeat.confirmed(now); now = 20_000
    const pending = heartbeat.tick()
    await heartbeat.tick(); expect(calls).toBe(1)
    now = 80_000; release(); await pending
    now = 100_000; const cancelled = heartbeat.tick()
    await heartbeat.close(); await cancelled
    expect(failures).toEqual([]); expect(calls).toBe(2)
  } finally { await heartbeat.close() }
})

test('慢响应不延后租约截止，仍在途的心跳也会被安全截止中止', async () => {
  let now = 0, release!: () => void
  const abort = new AbortController(), failures: unknown[] = []
  const heartbeat = new UploadHeartbeat(abort.signal, async signal => new Promise<void>((resolve, reject) => {
    const stopped = () => reject(signal.reason)
    signal.addEventListener('abort', stopped, { once: true })
    release = () => { signal.removeEventListener('abort', stopped); resolve() }
  }), error => { failures.push(error); abort.abort(error) }, () => now)
  try {
    heartbeat.confirmed(now); now = 20_000; const pending = heartbeat.tick()
    now = 80_000; release(); await pending
    now = 100_000; const stalled = heartbeat.tick()
    now = 140_000; await heartbeat.tick()
    await stalled
    expect(failures).toHaveLength(1); expect(abort.signal.aborted).toBe(true)
  } finally { await heartbeat.close() }
})
