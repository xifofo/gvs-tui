import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { verifyMiguManifest } from './migu-manifest'

test('Migu validates a clear master playlist locally and blocks real encryption', async () => {
  const requested: string[] = []
  const server = createServer((req, res) => {
    requested.push(req.url || '')
    res.writeHead(200, {'Content-Type':'application/vnd.apple.mpegurl'})
    if (req.url === '/master') res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nclear\n')
    else if (req.url === '/encrypted') res.end('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="license"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n')
    else if (req.url === '/aes') res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n')
    else if (req.url === '/live') res.end('#EXTM3U\n#EXTINF:10,\nsegment.ts\n')
    else if (req.url === '/invalid') res.end('<html>denied</html>')
    else res.end('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as {port:number}
  const base = `http://127.0.0.1:${address.port}`
  try {
    await verifyMiguManifest(base+'/master', {})
    await expect(verifyMiguManifest(base+'/encrypted', {})).rejects.toThrow('该媒体受保护')
    await expect(verifyMiguManifest(base+'/aes', {})).rejects.toThrow('该媒体受保护')
    await expect(verifyMiguManifest(base+'/live', {})).rejects.toThrow('尚未完成')
    await expect(verifyMiguManifest(base+'/invalid', {})).rejects.toThrow('有效播放清单')
    expect(requested).not.toContain('/segment.ts')
    expect(requested).not.toContain('/key')
    expect(requested).not.toContain('/license')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
