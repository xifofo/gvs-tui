import { expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session.ts'
import { providerLink } from './manifest-provider.ts'
import { PROVIDER_IDS, isManifestProvider, PROVIDER_LABELS } from './providers.ts'
import { TUNNEL_PROVIDERS } from './tunnel-policy.ts'
import { providerMeta } from '../../app/src/shared/provider-registry.ts'

test('Friday and LINE TV are registered tunnel manifest providers', () => {
  for (const p of ['friday', 'linetv'] as const) {
    expect(PROVIDER_IDS).toContain(p); expect(TUNNEL_PROVIDERS).toContain(p)
    expect(isManifestProvider(p)).toBe(true); expect(PROVIDER_LABELS[p]).toBeTruthy()
    expect(providerMeta(p).methods).toContain('cookie')
  }
  expect(providerMeta('linetv').loginOptional).toBe(true)
})

test('product links route to Friday and LINE TV', () => {
  expect(providerLink('看 https://video.friday.tw/drama/detail/1/147523 吧')).toEqual({ provider: 'friday', url: 'https://video.friday.tw/drama/detail/1/147523' })
  expect(providerLink('https://www.linetv.tw/drama/681/eps/1')?.provider).toBe('linetv')
  expect(providerLink('https://evil.example/linetv.tw')).toBeUndefined()
})

test('Friday binding accepts only the official https page and keeps the code for polling', async () => {
  const sent: Record<string, unknown>[] = []
  let reply: Record<string, unknown> = { state: 'pending', authenticated: false, url: 'https://video.friday.tw/m/loginTVBind?validateCode=123456&tvToken=x', code: '123456', interval: 5 }
  const s = new ProviderSessions(async (p, a, input) => { expect(p).toBe('friday'); expect(a).toBe('login'); sent.push(input); return reply })
  const v = await s.command({ provider: 'friday', op: 'web' })
  expect(v.url?.startsWith('https://video.friday.tw/')).toBe(true); expect(v.userCode).toBe('123456'); expect(v.state).toBe('pending')
  reply = { state: 'pending_or_expired', authenticated: false }
  const p = await s.command({ provider: 'friday', op: 'poll' })
  expect(p.state).toBe('pending'); expect(p.userCode).toBe('123456')
  reply = { authenticated: true, terminal: 'tv' }
  expect((await s.command({ provider: 'friday', op: 'poll' })).authenticated).toBe(true)
  reply = { state: 'pending', url: 'https://phish.example/m/loginTVBind' }
  await expect(s.command({ provider: 'friday', op: 'qr' })).rejects.toThrow('Friday')
  expect(sent.map(i => i.op)).toEqual(['web', 'poll', 'poll', 'qr'])
})

test('LINE TV cookie import is transient and status maps signedIn', async () => {
  let sent: Record<string, unknown> = {}
  const s = new ProviderSessions(async (_p, _a, input) => { sent = input; return { signedIn: true, memberId: 'm***1' } })
  const v = await s.command({ provider: 'linetv', op: 'import', cookie: 'accessToken=PRIVATE' })
  expect(sent.cookie).toBe('accessToken=PRIVATE'); expect(v.authenticated).toBe(true)
  expect(JSON.stringify(v)).not.toContain('PRIVATE')
  await expect(s.command({ provider: 'linetv', op: 'qr' })).rejects.toThrow()
})
