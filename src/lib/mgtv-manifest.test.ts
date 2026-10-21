import { expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mgtvDurationCovers, mgtvExpectedDuration, verifyMgtvManifest } from './mgtv-manifest'

const complete = '#EXTM3U\n#EXTINF:20,\na.ts\n#EXTINF:21,\nb.ts\n#EXT-X-ENDLIST\n'
async function fixture(body: (req: IncomingMessage, res: ServerResponse) => void, check: (base: string) => Promise<void>) {
  const server = createServer(body)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await check(`http://127.0.0.1:${(server.address() as {port: number}).port}`) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

test('mgtv duration fallback covers legacy zero-duration jobs without accepting invalid metadata', () => {
  expect(mgtvExpectedDuration(0, '2722', 2720)).toBe(2722)
  expect(mgtvExpectedDuration(2800, 2722)).toBe(2800)
  expect(mgtvExpectedDuration(undefined, 0, true, false, 'unknown', -2, Infinity, NaN)).toBeUndefined()
  expect(mgtvDurationCovers(2722.76, 2722)).toBe(true)
  expect(mgtvDurationCovers(300, 2722)).toBe(false)
  expect(mgtvDurationCovers(2.01, 2)).toBe(true)
  expect(mgtvDurationCovers(.5, 2)).toBe(false)
})

test('mgtv checks a redirected master with relative child and returns the verified media URL', async () => {
  const requests: string[] = []
  await fixture((req, res) => {
    requests.push(req.url || '')
    expect(req.headers.referer).toBe('https://www.mgtv.com/')
    if (req.url === '/master') { res.writeHead(302, {Location: '/folder/master'}); res.end(); return }
    res.writeHead(200, {'Content-Type': 'application/vnd.apple.mpegurl'})
    if (req.url === '/folder/master') res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nmedia.m3u8\n')
    else res.end(complete)
  }, async base => {
    expect(await verifyMgtvManifest(base + '/master', {Referer: 'https://www.mgtv.com/'}, 40))
      .toEqual({url: base + '/folder/media.m3u8', durationSeconds: 41, segmentCount: 2})
    expect(requests).toEqual(['/master', '/folder/master', '/folder/media.m3u8'])
  })
})

test('mgtv rejects a ended 300-second preview for a 45-minute program before requesting segments', async () => {
  const requests: string[] = []
  await fixture((req, res) => {
    requests.push(req.url || '')
    res.end('#EXTM3U\n#EXTINF:300,\npreview.ts\n#EXT-X-ENDLIST\n')
  }, async base => {
    await expect(verifyMgtvManifest(base + '/short', {}, 2722)).rejects.toThrow('明显短于')
    expect(requests).toEqual(['/short'])
  })
})

test('mgtv does not infer full duration when all metadata is missing', async () => {
  const requests: string[] = []
  await fixture((req, res) => { requests.push(req.url || ''); res.end(complete) }, async base => {
    for (const duration of [undefined, 0, -1, Infinity, NaN]) {
      await expect(verifyMgtvManifest(base, {}, duration)).rejects.toThrow('未提供有效整集时长')
    }
    expect(requests).toHaveLength(0)
  })
})

test('mgtv refuses live, empty, malformed or dangling playlists', async () => {
  const bodies: Record<string, string> = {
    '/live': complete.replace('#EXT-X-ENDLIST\n', ''),
    '/empty': '#EXTM3U\n#EXT-X-ENDLIST\n',
    '/invalid': '<html>denied</html>',
    '/bad-duration': complete.replace('20,', 'NaN,'),
    '/missing-uri': '#EXTM3U\n#EXTINF:20,\n#EXTINF:21,\nb.ts\n#EXT-X-ENDLIST\n',
    '/dangling': '#EXTM3U\n#EXTINF:41,\n#EXT-X-ENDLIST\n',
    '/missing-duration': '#EXTM3U\na.ts\n#EXT-X-ENDLIST\n',
  }
  await fixture((req, res) => res.end(bodies[req.url || '']), async base => {
    for (const path of Object.keys(bodies)) await expect(verifyMgtvManifest(base + path, {}, 40)).rejects.toThrow()
  })
})

test('mgtv refuses ambiguous variants, loops and invalid child URLs', async () => {
  const bodies: Record<string, string> = {
    '/multiple': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\na\n#EXT-X-STREAM-INF:BANDWIDTH=200\nb\n',
    '/loop': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nloop\n',
    '/invalid': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nfile:///tmp/video\n',
    '/missing': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n',
  }
  await fixture((req, res) => res.end(bodies[req.url || '']), async base => {
    await expect(verifyMgtvManifest(base + '/multiple', {}, 40)).rejects.toThrow('多个版本')
    await expect(verifyMgtvManifest(base + '/loop', {}, 40)).rejects.toThrow('重复')
    await expect(verifyMgtvManifest(base + '/invalid', {}, 40)).rejects.toThrow('地址无效')
    await expect(verifyMgtvManifest(base + '/missing', {}, 40)).rejects.toThrow('缺少媒体版本')
  })
})

test('mgtv bounds playlist reads and reports CDN 403/405 without leaking the URL', async () => {
  await fixture((req, res) => {
    if (req.url === '/large') res.end('x'.repeat(1024 * 1024 + 1))
    else { res.writeHead(req.url?.startsWith('/tv-cdn') ? 405 : 403); res.end('denied') }
  }, async base => {
    await expect(verifyMgtvManifest(base + '/large', {}, 40)).rejects.toThrow('清单过大')
    await expect(verifyMgtvManifest(base + '/private?token=secret', {}, 40)).rejects.toThrow('清单读取失败')
    try { await verifyMgtvManifest(base + '/private?token=secret', {}, 40) }
    catch (error) {
      expect((error as Error).message).toContain('HTTP 403')
      expect((error as Error).message).not.toContain('secret')
    }
    await expect(verifyMgtvManifest(base + '/tv-cdn?token=secret', {}, 40)).rejects.toThrow('HTTP 405')
  })
})

test('mgtv preserves cancellation rather than treating a pause as a preview failure', async () => {
  const controller = new AbortController()
  controller.abort('pause')
  await expect(verifyMgtvManifest('http://127.0.0.1:1/unused', {}, 40, controller.signal)).rejects.toBe('pause')
})
