import { afterEach, expect, test } from 'bun:test'
import { GwClient, gatewayAccountId, GW_ACCOUNT_HEADER } from './client'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

test('gatewayAccountId produces valid gateway ids', () => {
  for (const id of ['iq-kx12ab', 'iq-kx12ab-3', 'Bilibili-ÄÖ', 'default', '-x', 'a'.repeat(80)]) {
    expect(gatewayAccountId(id)).toMatch(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    expect(gatewayAccountId(id)).not.toBe('default')
  }
  expect(gatewayAccountId('iq-kx12ab')).toBe('iq-kx12ab')
})

function capture() {
  const seen: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } })
    const body = String(url).endsWith('/v1/accounts')
      ? { code: 0, msg: 'SUCCESS', data: { multiAccount: true, providers: ['iq', 'bilibili'], header: GW_ACCOUNT_HEADER } }
      : { code: 0, msg: 'SUCCESS', data: {} }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return seen
}

test('account header is sent only for the scoped provider and replaces Iq-Cookie', async () => {
  const seen = capture()
  const cli = new GwClient('http://gw.test', 'k', '')
  cli.accountFor = (p) => (p === 'iq' ? 'work' : undefined)
  await cli.invoke('iq', 'detail', { id: '1' }, { 'Iq-Cookie': 'GLOBAL' })
  await cli.invoke('youku', 'detail', { id: '1' })
  await cli.fixedAccount('iq', 'default').invoke('iq', 'detail', { id: '1' }, { 'Iq-Cookie': 'GLOBAL' })
  const job = cli.fixedAccount('iq', 'other')
  cli.accountFor = () => undefined
  await job.invoke('iq', 'play', { id: '1' })
  expect(seen[0]!.headers[GW_ACCOUNT_HEADER]).toBe('work')
  expect(seen[0]!.headers['Iq-Cookie']).toBeUndefined()
  expect(seen[1]!.headers[GW_ACCOUNT_HEADER]).toBeUndefined()
  expect(seen[2]!.headers[GW_ACCOUNT_HEADER]).toBeUndefined()
  expect(seen[2]!.headers['Iq-Cookie']).toBe('GLOBAL')
  expect(seen[3]!.headers[GW_ACCOUNT_HEADER]).toBe('other')
})

test('accountsInfo feature-detects; old gateways return null', async () => {
  capture()
  const cli = new GwClient('http://gw.test', 'k', '')
  expect((await cli.accountsInfo())?.providers).toEqual(['iq', 'bilibili'])
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 400, msg: 'INVALID_PARAM: provider or url required', data: null }), { status: 400 })) as unknown as typeof fetch
  expect(await cli.accountsInfo()).toBeNull()
})
