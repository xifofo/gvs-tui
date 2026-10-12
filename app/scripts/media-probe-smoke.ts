import { app, net, session } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyMiguManifest } from '../../src/lib/migu-manifest'
import { fetchMediaProbe } from '../src/main/shims/proxy'
import { fetchNativeMediaProbe, mediaProbeProxy } from '../src/main/media-probe-transport'

const output = resolve('.build/media-probe-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', mkdtempSync(join(tmpdir(), 'gvs-media-probe-')))
app.disableHardwareAcceleration()
const clear = '#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n'
const requested: { path: string; referer?: string; ua?: string }[] = []
const headers = { Referer: 'https://www.miguvideo.com/', 'User-Agent': 'GVS-media-probe-smoke' }
const server = createServer((req, res) => {
  requested.push({ path: req.url || '', referer: req.headers.referer, ua: req.headers['user-agent'] })
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/folder/master' }); res.end(); return }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return }
  if (req.url === '/slow') return
  res.setHeader('content-type', 'application/vnd.apple.mpegurl')
  if (req.url === '/folder/master') res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10000\nclear\n')
  else if (req.url === '/encrypted') res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n')
  else if (req.url === '/huge') res.end('x'.repeat(1024 * 1024 + 1))
  else if (req.url === '/gzip') { res.setHeader('content-encoding', 'gzip'); res.end(gzipSync(clear)) }
  else res.end(clear)
})
let connects = 0
const proxy = createServer()
proxy.on('connect', (req, socket, head) => {
  connects++
  const [host, port] = (req.url || '').split(':')
  const target = connect(Number(port), host, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) target.write(head)
    target.pipe(socket); socket.pipe(target)
  })
  target.on('error', () => socket.destroy())
  socket.on('error', () => target.destroy())
  socket.on('close', () => target.destroy())
})

async function main() {
  await app.whenReady()
  let live: Record<string, unknown> | undefined
  if (process.env.GVS_MEDIA_PROBE_LIVE === '1') {
    const input = JSON.parse(readFileSync(join(output, 'live-input.json'), 'utf8'))
    const route = await session.defaultSession.resolveProxy(input.url)
    await verifyMiguManifest(input.url, input.headers, AbortSignal.timeout(30000))
    live = { verified: true, width: input.width, height: input.height, systemProxy: route !== 'DIRECT' }
  }
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await session.defaultSession.setProxy({ mode: 'direct' })
  // This is the user's exact failure: Chromium rejects the explicit Referer.
  await assert.rejects(net.fetch(base + '/old', { headers }), /ERR_BLOCKED_BY_CLIENT/)
  assert(!requested.some(row => row.path === '/old'))
  await verifyMiguManifest(base + '/redirect', headers)
  assert(requested.some(row => row.path === '/folder/clear'))
  assert(requested.every(row => row.referer === headers.Referer && row.ua === headers['User-Agent']))
  assert.equal(await (await fetchMediaProbe(base + '/gzip', { headers })).text(), clear)
  await assert.rejects(verifyMiguManifest(base + '/encrypted', headers), /该媒体受保护/)
  await assert.rejects(fetchMediaProbe(base + '/huge', { headers }), /清单过大/)
  await assert.rejects(fetchMediaProbe(base + '/loop', { headers }), /重定向过多/)
  await assert.rejects(fetchMediaProbe(base + '/slow', { signal: AbortSignal.timeout(100) }), /abort/i)
  const address = `127.0.0.1:${(proxy.address() as { port: number }).port}`
  await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=${address};https=${address}`, proxyBypassRules: '<-loopback>' })
  assert.equal(await (await fetchMediaProbe(base + '/proxy', { headers })).text(), clear)
  assert(connects > 0, 'Media probe must follow the Electron system proxy route')
  assert.equal(mediaProbeProxy('DIRECT; PROXY ignored:80'), '')
  assert.throws(() => mediaProbeProxy('SOCKS5 localhost:7890'), /不支持当前系统代理/)
  await assert.rejects(fetchNativeMediaProbe(base + '/no-fallback', { headers }, async () => 'PROXY 127.0.0.1:1; DIRECT'), /本机网络或系统代理/)
  assert(!requested.some(row => /segment|key|no-fallback/.test(row.path)))
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: true, scope: 'Real Electron, production shim: Referer/UA, direct/system proxy, redirects, gzip, cancellation, bounded body, encryption guard, no proxy fallback', live, connects, requested }, null, 2))
  app.exit(0)
}
main().catch(error => {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2))
  app.exit(1)
})
