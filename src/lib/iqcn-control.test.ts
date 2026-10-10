import { expect, test } from 'bun:test'
import { createIQCNControlQueue, iqcnRateLimited, retryAfterMillis } from './iqcn-control.ts'

test('rate rejection retries the same descriptor and queues other workers during cooldown', async () => {
  let now = 0, attempts = 0
  const waits: number[] = [], order: string[] = []
  const run = createIQCNControlQueue({ now: () => now, wait: async ms => { waits.push(ms); now += ms } })
  const first = run(async () => {
    order.push('segment-8')
    if (++attempts === 1) throw { httpStatus: 429, errorCode: 'RATE_LIMITED', retryAfterMs: 2000 }
    return 8
  })
  const second = run(async () => { order.push('segment-9'); return 9 })
  expect(await Promise.all([first, second])).toEqual([8, 9])
  expect(order).toEqual(['segment-8', 'segment-8', 'segment-9'])
  expect(waits).toEqual([0, 2000, 300])
})

test('persistent rate rejection has a finite retry budget', async () => {
  let now = 0, calls = 0
  const run = createIQCNControlQueue({ now: () => now, wait: async ms => { now += ms } })
  await expect(run(async () => { calls++; throw { httpStatus: 429, errorCode: 'RATE_LIMITED' } })).rejects.toMatchObject({ httpStatus: 429 })
  expect(calls).toBe(4)
})

test('authentication, quota, IP and business failures are not retried', async () => {
  for (const error of [
    { httpStatus: 403, errorCode: 'RELOGIN_REQUIRED' }, { httpStatus: 429, errorCode: 'IP_LIMITED' },
    { httpStatus: 429, errorCode: 'DAILY_LIMITED' }, { httpStatus: 500, errorCode: 'OPERATION_FAILED' },
  ]) {
    let calls = 0
    const run = createIQCNControlQueue({ now: () => 0, wait: async () => {} })
    await expect(run(async () => { calls++; throw error })).rejects.toMatchObject(error)
    expect(calls).toBe(1)
    expect(iqcnRateLimited(error)).toBe(false)
  }
})

test('cancellation during rate wait never makes another request', async () => {
  const controller = new AbortController()
  let calls = 0
  const run = createIQCNControlQueue({ now: () => 0, wait: async ms => { if (ms) controller.abort(new Error('cancelled')) } })
  await expect(run(async () => { calls++; throw { httpStatus: 429, errorCode: 'RATE_LIMITED' } }, controller.signal)).rejects.toThrow('cancelled')
  expect(calls).toBe(1)
})

test('Retry-After delta/date accepted, malformed value ignored, excessive delay never retried early', async () => {
  expect(retryAfterMillis('2')).toBe(2000)
  expect(retryAfterMillis('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000)
  expect(retryAfterMillis('invalid')).toBeUndefined()
  expect(retryAfterMillis('-1')).toBeUndefined()
  let calls = 0
  const run = createIQCNControlQueue({ now: () => 0, wait: async () => {} })
  await expect(run(async () => { calls++; throw { httpStatus: 429, errorCode: 'RATE_LIMITED', retryAfterMs: 60000 } })).rejects.toMatchObject({ retryAfterMs: 60000 })
  expect(calls).toBe(1)
})
