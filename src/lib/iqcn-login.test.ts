import { expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session.ts'

test('domestic QR flow retains only the gateway flow id and respects polling interval', async () => {
  let now = 10000
  const calls: Array<{ provider: string; action: string; input: Record<string, unknown> }> = []
  const sessions = new ProviderSessions(async (provider, action, input) => {
    calls.push({ provider, action, input })
    if (input.op === 'start') return { state: 'pending', flowId: 'flow-a', url: 'https://passport.iqiyi.com/qr', expiresAt: 100, interval: 2 }
    return { state: 'authenticated', authenticated: true }
  }, () => now)
  sessions.setScope('gateway:key-a')
  const start = await sessions.command({ provider: 'iqcn', op: 'start' })
  expect(start.url).toBe('https://passport.iqiyi.com/qr')
  await sessions.command({ provider: 'iqcn', op: 'poll' })
  expect(calls).toHaveLength(1)
  now += 2000
  expect((await sessions.command({ provider: 'iqcn', op: 'poll' })).authenticated).toBe(true)
  expect(calls[1]).toEqual({ provider: 'iqcn', action: 'login', input: { op: 'poll', flowId: 'flow-a' } })
  sessions.setScope('gateway:key-b')
  await expect(sessions.command({ provider: 'iqcn', op: 'poll' })).rejects.toThrow('过期')
})

test('domestic QR refuses foreign destinations and stale challenges', async () => {
  for (const url of ['https://example.invalid/qr', 'https://iqiyi.com.evil.invalid/qr', 'https://user:pass@passport.iqiyi.com/qr']) {
    const sessions = new ProviderSessions(async () => ({ state: 'pending', flowId: 'flow', url, expiresAt: 100 }), () => 1000)
    await expect(sessions.command({ provider: 'iqcn', op: 'start' })).rejects.toThrow('二维码无效')
  }
})
