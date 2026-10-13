import { app, net, session } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyMiguManifest } from '../../src/lib/migu-manifest'
import { fetchMediaProbe, fetchMediaSegment } from '../src/main/shims/proxy'
import { fetchNativeMediaProbe, fetchNativeMediaSegment, mediaProbeProxy } from '../src/main/media-probe-transport'
import { downloadIQParts } from '../../src/lib/iq-transfer'

const output = resolve('.build/media-probe-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', mkdtempSync(join(tmpdir(), 'gvs-media-probe-')))
app.disableHardwareAcceleration()
const clear = '#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n'
const audioPart = Buffer.alloc(2 * 1024 * 1024 + 17, 0x57)
const slowAudioPart = Buffer.alloc(128 * 12, 0x38)
const requested: { path: string; referer?: string; ua?: string; range?: string }[] = []
const headers = { Referer: 'https://www.miguvideo.com/', 'User-Agent': 'GVS-media-probe-smoke' }
const iqHeaders = { Referer: 'https://www.iq.com/', 'User-Agent': 'GVS-iq-audio-smoke' }
let releaseAudioStream: (() => void) | undefined, cancelledAudioStreams = 0
const server = createServer((req, res) => {
  requested.push({ path: req.url || '', referer: req.headers.referer, ua: req.headers['user-agent'], range: req.headers.range })
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/folder/master' }); res.end(); return }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return }
  if (req.url === '/slow') return
  if (req.url?.startsWith('/audio')) {
    res.setHeader('content-type', 'application/octet-stream')
    if (req.url.startsWith('/audio-slow-progress-')) {
      res.setHeader('content-length', slowAudioPart.length)
      let offset = 0
      const timer = setInterval(() => {
        res.write(slowAudioPart.subarray(offset, offset + 128)); offset += 128
        if (offset === slowAudioPart.length) { clearInterval(timer); res.end() }
      }, 15)
      res.once('close', () => clearInterval(timer))
      return
    }
    res.setHeader('content-length', audioPart.length)
    if (req.url === '/audio-truncated.part') {
      res.write(audioPart.subarray(0, 1024))
      setTimeout(() => res.destroy(), 15); return
    }
    if (req.url === '/audio-stream.part' || req.url === '/audio-idle.part') {
      res.write(audioPart.subarray(0, 64 * 1024))
      if (req.url === '/audio-stream.part') releaseAudioStream = () => res.end(audioPart.subarray(64 * 1024))
      else res.once('close', () => cancelledAudioStreams++)
      return
    }
    if (req.url === '/audio-gzip.part') {
      const compressed = gzipSync(audioPart)
      res.setHeader('content-encoding', 'gzip')
      res.setHeader('content-length', compressed.length)
      res.end(compressed); return
    }
    res.end(audioPart); return
  }
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
  // Exercise IQ's default fetcher through the production desktop build shim.
  // Mock fetchers alone cannot catch a manifest limit applied to binary audio.
  const audioPath = join(app.getPath('userData'), 'audio.part')
  await downloadIQParts([{ url: base + '/audio.part', path: audioPath }], {
    identity: 'synthetic-episode:audio', threads: 8, headers: iqHeaders,
    policy: { retryDelayMs: 0 },
  })
  assert.deepEqual(readFileSync(audioPath), audioPart)
  assert.equal(JSON.parse(readFileSync(audioPath + '.complete.json', 'utf8')).bytes, audioPart.length)
  assert.equal(requested.find(row => row.path === '/audio.part')?.referer, iqHeaders.Referer)
  assert.equal(requested.find(row => row.path === '/audio.part')?.ua, iqHeaders['User-Agent'])
  assert.equal(requested.find(row => row.path === '/audio.part')?.range, undefined)
  const streamed = await fetchMediaSegment(base + '/audio-stream.part', { headers: iqHeaders, signal: AbortSignal.timeout(5000) })
  const reader = streamed.body!.getReader(), first = await reader.read()
  assert(first.value?.length, 'Audio bytes must be readable before the server sends its tail')
  releaseAudioStream!()
  const chunks = [Buffer.from(first.value)]
  while (true) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(Buffer.from(chunk.value)) }
  assert.deepEqual(Buffer.concat(chunks), audioPart)
  const compressed = await fetchMediaSegment(base + '/audio-gzip.part', { headers: iqHeaders })
  assert.equal(compressed.headers.get('content-length'), null)
  assert.deepEqual(Buffer.from(await compressed.arrayBuffer()), audioPart)
  const paused = new AbortController()
  const idle = await fetchMediaSegment(base + '/audio-idle.part', { headers: iqHeaders, signal: paused.signal })
  const idleReader = idle.body!.getReader(); await idleReader.read()
  paused.abort(new Error('synthetic pause'))
  await assert.rejects(idleReader.read())
  for (let i = 0; i < 100 && !cancelledAudioStreams; i++) await new Promise(done => setTimeout(done, 10))
  assert.equal(cancelledAudioStreams, 1)
  const truncated = join(app.getPath('userData'), 'truncated.part')
  await assert.rejects(downloadIQParts([{ url: base + '/audio-truncated.part', path: truncated }], {
    identity: 'synthetic-truncated-audio', threads: 1, headers: iqHeaders, policy: { retryDelayMs: 0 },
  }))
  assert(!existsSync(truncated + '.complete.json'))
  await assert.rejects(verifyMiguManifest(base + '/encrypted', headers), /该媒体受保护/)
  await assert.rejects(fetchMediaProbe(base + '/huge', { headers }), /清单过大/)
  await assert.rejects(fetchMediaProbe(base + '/loop', { headers }), /重定向过多/)
  await assert.rejects(fetchMediaProbe(base + '/slow', { signal: AbortSignal.timeout(100) }), /abort/i)
  const address = `127.0.0.1:${(proxy.address() as { port: number }).port}`
  await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=${address};https=${address}`, proxyBypassRules: '<-loopback>' })
  assert.equal(await (await fetchMediaProbe(base + '/proxy', { headers })).text(), clear)
  assert(connects > 0, 'Media probe must follow the Electron system proxy route')
  const beforeResume = requested.filter(row => row.path === '/audio.part').length
  const beforeProxy = connects, proxyAudioPath = join(app.getPath('userData'), 'proxy-audio.part')
  await downloadIQParts([{ url: base + '/audio.part', path: audioPath }, { url: base + '/audio-proxy.part', path: proxyAudioPath }], {
    identity: 'synthetic-episode:audio', threads: 8, headers: iqHeaders,
  })
  assert.equal(requested.filter(row => row.path === '/audio.part').length, beforeResume, 'Resume must reuse the completed audio part')
  assert.deepEqual(readFileSync(proxyAudioPath), audioPart)
  assert(connects > beforeProxy, 'IQ audio must use the system proxy route and keep the streaming proxy alive')
  const slowParts = [0, 1].map(i => ({ url: `${base}/audio-slow-progress-${i}.part`, path: join(app.getPath('userData'), `slow-${i}.part`) }))
  let slowRetries = 0, slowRefreshes = 0
  await downloadIQParts(slowParts, {
    identity: 'synthetic-slow-audio', threads: 2, headers: iqHeaders,
    policy: { responseTimeoutMs: 1000, idleTimeoutMs: 500, slowWindowMs: 40, retryDelayMs: 0 },
    onRetry: () => { slowRetries++ }, refreshParts: async () => { slowRefreshes++; return slowParts },
  })
  assert.equal(slowRetries, 0, 'Slow but progressing native streams must not restart')
  assert.equal(slowRefreshes, 0)
  for (const part of slowParts) {
    assert.deepEqual(readFileSync(part.path), slowAudioPart)
    assert.equal(requested.filter(row => row.path === new URL(part.url).pathname).length, 1)
  }
  assert.equal(mediaProbeProxy('DIRECT; PROXY ignored:80'), '')
  assert.throws(() => mediaProbeProxy('SOCKS5 localhost:7890'), /不支持当前系统代理/)
  await assert.rejects(fetchNativeMediaProbe(base + '/no-fallback', { headers }, async () => 'PROXY 127.0.0.1:1; DIRECT'), /本机网络或系统代理/)
  await assert.rejects(fetchNativeMediaSegment(base + '/no-fallback', { headers: iqHeaders }, async () => 'PROXY 127.0.0.1:1; DIRECT'), /本机网络或系统代理/)
  assert(!requested.some(row => /segment|key|no-fallback/.test(row.path)))
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: true, scope: 'Real Electron, production shim: IQ audio over 1 MiB, early streaming, gzip, abort, truncation, direct/proxy, slow-progress completion and completed-part resume; Migu manifest cap, headers, redirects and protection retained', live, connects, requested }, null, 2))
  app.exit(0)
}
main().catch(error => {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2))
  app.exit(1)
})
