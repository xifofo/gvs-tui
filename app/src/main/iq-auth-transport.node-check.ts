import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { fetchIQAuthProxy } from './iq-auth-transport.ts'

async function fixture(handle: (req: Request) => Response | Promise<Response>, deny = false) {
  let connects = 0
  const sockets = new Set<Duplex>()
  const track = (socket: Duplex) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  }
  const origin = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item)
        else if (value !== undefined) headers.set(name, value)
      }
      const body = Buffer.concat(chunks)
      const response = await handle(new Request(`http://127.0.0.1${req.url}`, {
        method: req.method, headers, body: body.length ? body : undefined,
      }))
      const outgoing: Record<string, string | string[]> = Object.fromEntries(response.headers)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) outgoing['set-cookie'] = cookies
      res.writeHead(response.status, outgoing)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch { res.writeHead(500); res.end('fixture error') }
  })
  origin.on('connection', track)
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
  const proxy = createServer()
  proxy.on('connect', (req, socket, head) => {
    connects++
    track(socket)
    if (deny) { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return }
    const [host, port] = req.url!.split(':')
    const upstream = connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    track(upstream)
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(origin.address() as { port: number }).port}/`,
    proxy: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
    connects: () => connects,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await Promise.all([new Promise<void>(resolve => origin.close(() => resolve())),
        new Promise<void>(resolve => proxy.close(() => resolve()))])
    },
  }
}

test('IQ explicit CONNECT preserves credentials and a manual redirect without contacting its target', { timeout: 3000 }, async () => {
  let requests = 0
  const server = await fixture(async req => {
    requests++
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.get('cookie'), 'fixture=COOKIE')
    assert.equal(req.headers.get('user-agent'), 'fixture-agent')
    assert.equal(await req.text(), 'fixture=BODY')
    const headers = new Headers({ location: '/next' })
    headers.append('set-cookie', 'first=1; Path=/')
    headers.append('set-cookie', 'second=2; Path=/')
    return new Response('redirect-body', { status: 302, headers })
  })
  try {
    const response = await fetchIQAuthProxy(server.url, { method: 'POST', redirect: 'manual',
      headers: { Cookie: 'fixture=COOKIE', 'User-Agent': 'fixture-agent' }, body: new Uint8Array(Buffer.from('fixture=BODY')),
    }, server.proxy)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/next')
    assert.deepEqual(response.headers.getSetCookie(), ['first=1; Path=/', 'second=2; Path=/'])
    assert.equal(await response.text(), 'redirect-body')
    assert.equal(server.connects(), 1)
    assert.equal(requests, 1)
  } finally { await server.close() }
})

test('IQ explicit CONNECT decodes an unexpectedly compressed authentication response', { timeout: 3000 }, async () => {
  const server = await fixture(() => new Response(gzipSync('{"fixture":true}'), { headers: { 'content-encoding': 'gzip' } }))
  try {
    const response = await fetchIQAuthProxy(server.url, {}, server.proxy)
    assert.deepEqual(await response.json(), { fixture: true })
    assert.equal(server.connects(), 1)
  } finally { await server.close() }
})

test('IQ explicit CONNECT rejection cannot fall back to the origin directly', { timeout: 3000 }, async () => {
  let originRequests = 0
  const server = await fixture(() => { originRequests++; return new Response('must not arrive') }, true)
  try {
    const response = await fetchIQAuthProxy(server.url, {}, server.proxy)
    assert.equal(response.status, 403)
    assert.equal(originRequests, 0)
    assert.equal(server.connects(), 1)
  } finally { await server.close() }
})

test('IQ explicit CONNECT cancellation stops a stalled authentication response', { timeout: 3000 }, async () => {
  const server = await fixture(async () => { await delay(200); return new Response('late') })
  try {
    await assert.rejects(fetchIQAuthProxy(server.url, { signal: AbortSignal.timeout(40) }, server.proxy))
    assert.equal(server.connects(), 1)
  } finally { await server.close() }
})
