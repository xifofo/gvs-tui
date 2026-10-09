import { expect, test } from 'bun:test'
import { createIQAuthRoute, isIQAuthURL } from '../../app/src/main/iq-auth-proxy.ts'
import { runTunnel, setTunnelFetchRoute } from './tunnel.ts'

test('IQ authentication routing excludes media, other platforms and lookalike domains', () => {
  for (const url of ['https://passport.iq.com/apis/login', 'https://intl-passport.iqiyi.com/apis/login']) {
    expect(isIQAuthURL(new URL(url))).toBe(true)
  }
  for (const url of ['https://www.iq.com/', 'https://video.iq.com/', 'https://passport.iq.com.example.test/',
    'https://youku.com/', 'http://passport.iq.com/', 'https://user:pass@passport.iq.com/']) {
    expect(isIQAuthURL(new URL(url))).toBe(false)
  }
})

test('IQ tunnel transport preserves POST, Cookie, redirect and separate response cookies without logging credentials', async () => {
  const logs: string[] = []
  let requests = 0
  const route = createIQAuthRoute({
    resolveProxy: async () => 'PROXY 127.0.0.1:7897; DIRECT',
    log: line => logs.push(line),
    fetch: async (url, init, proxy) => {
      requests++
      expect(url).toBe('https://intl-passport.iqiyi.com/login?token=PRIVATE_QUERY')
      expect(init.method).toBe('POST')
      expect(init.redirect).toBe('manual')
      expect(new Headers(init.headers).get('cookie')).toBe('I00001=PRIVATE_COOKIE')
      expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('password=PRIVATE_PASSWORD')
      expect(init.credentials).toBe('omit')
      expect(proxy).toBe('http://127.0.0.1:7897')
      const headers = new Headers({ location: '/next' })
      headers.append('set-cookie', 'first=1; Path=/')
      headers.append('set-cookie', 'second=2; Path=/')
      return new Response('fixture', { status: 302, headers })
    },
  })
  setTunnelFetchRoute(route)
  const abort = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let receive!: (frame: Record<string, any>) => void
  const received = new Promise<Record<string, any>>((resolve, reject) => {
    receive = resolve
    timeout = setTimeout(() => reject(new Error('IQ routed tunnel request timed out')), 3000)
  })
  const gateway = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch(req, server) { if (server.upgrade(req)) return; return new Response('upgrade required', { status: 426 }) },
    websocket: {
      open(ws) { ws.send(JSON.stringify({ t: 'req', id: 'fixture', method: 'POST',
        url: 'https://intl-passport.iqiyi.com/login?token=PRIVATE_QUERY', header: { Cookie: 'I00001=PRIVATE_COOKIE' },
        body: Buffer.from('password=PRIVATE_PASSWORD').toString('base64') })) },
      message(_ws, message) { const frame = JSON.parse(String(message)); if (frame.t === 'res') receive(frame) },
    },
  })
  try {
    runTunnel(gateway.url.toString(), 'fixture-key', () => {}, abort.signal)
    const frame = await received
    expect(requests).toBe(1)
    expect(frame.status).toBe(302)
    expect(frame.header['set-cookie']).toHaveLength(2)
    expect(frame.header.location).toEqual(['/next'])
    expect(Buffer.from(frame.body, 'base64').toString()).toBe('fixture')
    expect(logs.join('\n')).not.toContain('PRIVATE_')
    expect(logs.join('\n')).toContain('route=system-proxy http=302')
  } finally {
    clearTimeout(timeout)
    abort.abort()
    await Bun.sleep(10)
    gateway.stop(true)
    setTunnelFetchRoute(undefined)
  }
})

test('IQ proxy failures do not retry direct', async () => {
  const logs: string[] = []
  let calls = 0
  const route = createIQAuthRoute({ resolveProxy: async () => 'PROXY 127.0.0.1:7897; DIRECT', log: line => logs.push(line),
    fetch: async () => { calls++; throw new Error('fixture failure') },
  })
  const fetcher = await route(new URL('https://passport.iq.com/login'))
  await expect(fetcher!('https://passport.iq.com/login', {})).rejects.toThrow('fixture failure')
  expect(calls).toBe(1)
  expect(logs.join('\n')).toContain('route=system-proxy failed')
  expect(await route(new URL('https://youku.com/'))).toBeUndefined()
})

test('DIRECT PAC decisions retain the existing fake-IP-safe tunnel transport', async () => {
  const logs: string[] = []
  const route = createIQAuthRoute({ resolveProxy: async () => 'DIRECT; PROXY 127.0.0.1:7897',
    log: line => logs.push(line), fetch: async () => { throw new Error('must not override direct transport') },
  })
  expect(await route(new URL('https://passport.iq.com/login'))).toBeUndefined()
  expect(logs.join('\n')).toContain('route=direct')
})
