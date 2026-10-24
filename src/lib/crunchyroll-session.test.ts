import { describe, expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session.ts'
import { resolveManifestDownload } from './manifest-provider.ts'

const clearEpisode = {
  media: [{ url: 'https://example.test/manifest.mpd', format: 'dash', height: 1080, drm: { system: 'none', clear: true, contentKeys: [] } }],
  qualities: [],
}

describe('CR 网页会话：resolve 参数', () => {
  test('有 etp_rt 时传 session，不传 refresh_token', async () => {
    const seen: Record<string, unknown>[] = []
    const cli = { invoke: async (_p: string, _a: string, input: Record<string, unknown>) => { seen.push(input); return clearEpisode } }
    await resolveManifestDownload(cli, { crunchyrollSession: 'sess-12345678' }, 'crunchyroll', 'G7PU4MZ1G')
    expect(seen[0]?.session).toBe('sess-12345678')
    expect(seen[0]?.refresh_token).toBeUndefined()
    expect(seen[0]?.download).toBe(true)
  })

  test('没有 session 时回落到 refresh_token', async () => {
    const seen: Record<string, unknown>[] = []
    const cli = { invoke: async (_p: string, _a: string, input: Record<string, unknown>) => { seen.push(input); return clearEpisode } }
    await resolveManifestDownload(cli, { crunchyrollToken: 'rt-value' }, 'crunchyroll', 'G7PU4MZ1G')
    expect(seen[0]?.refresh_token).toBe('rt-value')
    expect(seen[0]?.session).toBeUndefined()
  })

  test('两者都没有时明确报错', async () => {
    const cli = { invoke: async () => clearEpisode }
    await expect(resolveManifestDownload(cli, {}, 'crunchyroll', 'G7PU4MZ1G')).rejects.toThrow('CRUNCHYROLL_TOKEN_REQUIRED')
  })
})

describe('CR 网页会话：网关 login 校验', () => {
  test('import + session 把 session 交给网关', async () => {
    const calls: Array<{ provider: string; action: string; input: Record<string, unknown> }> = []
    const ps = new ProviderSessions(async (provider, action, input) => {
      calls.push({ provider, action, input })
      return { token: 'masked...abcd', expiresAt: '2026-10-24T00:05:00Z' }
    })
    ps.setScope('gw:key')
    await ps.command({ provider: 'crunchyroll', op: 'import', session: 'sess-12345678' })
    expect(calls[0]?.provider).toBe('crunchyroll')
    expect(calls[0]?.action).toBe('login')
    expect(calls[0]?.input.session).toBe('sess-12345678')
  })

  test('import + refresh_token 仍走 refresh_token', async () => {
    const calls: Array<{ input: Record<string, unknown> }> = []
    const ps = new ProviderSessions(async (_p, _a, input) => { calls.push({ input }); return {} })
    ps.setScope('gw:key2')
    await ps.command({ provider: 'crunchyroll', op: 'import', token: 'rt-value' })
    expect(calls[0]?.input.refresh_token).toBe('rt-value')
  })
})
