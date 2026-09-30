import { expect, test } from 'bun:test'
import { isLocalGateway } from './gateway-route'
import { runTunnel } from './tunnel'

test('local gateway routing recognizes IPv4, IPv6 and localhost for HTTP and WebSocket', () => {
  for (const scheme of ['http', 'https', 'ws', 'wss']) {
    for (const host of ['127.0.0.1', '[::1]', 'localhost']) {
      expect(isLocalGateway(`${scheme}://${host}:8080/v1/tunnel`)).toBe(true)
    }
    expect(isLocalGateway(`${scheme}://gateway.example/v1/tunnel`)).toBe(false)
  }
})

test('a local gateway tunnel connects directly even when its saved proxy rejects requests', async () => {
  let proxyRequests = 0
  const proxy = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch() { proxyRequests++; return new Response('proxy unavailable', { status: 502 }) },
  })
  const gateway = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return
      return new Response('upgrade required', { status: 426 })
    },
    websocket: { message() {} },
  })
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<{ ok: boolean; err: string }>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('local tunnel did not connect')), 3000)
      runTunnel(`http://127.0.0.1:${gateway.port}`, 'fixture-key', (ok, err) => resolve({ ok, err }),
        abort.signal, () => `http://127.0.0.1:${proxy.port}`)
    })
    expect(result).toEqual({ ok: true, err: '' })
    expect(proxyRequests).toBe(0)
  } finally {
    clearTimeout(timer)
    abort.abort()
    await Bun.sleep(10)
    gateway.stop(true)
    proxy.stop(true)
  }
})
