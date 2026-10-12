import { fetchMediaProbe } from './proxy'

function manifestURL(raw: string, base?: string): string {
  const u = new URL(raw, base)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('咪咕清单地址无效')
  return u.href
}

/** Runs on the downloading computer. The gateway never reads or relays HLS. */
export async function verifyMiguManifest(raw: string, headers: Record<string, string>, signal?: AbortSignal): Promise<void> {
  let url = manifestURL(raw)
  const visited = new Set<string>()
  for (let depth = 0; depth < 4; depth++) {
    signal?.throwIfAborted()
    if (visited.has(url)) throw new Error('咪咕清单重复，无法确认媒体版本')
    visited.add(url)
    const timeout = AbortSignal.timeout(20000)
    const response = await fetchMediaProbe(url, {headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout})
    if (!response.ok || !response.body) throw new Error('咪咕清单读取失败，请刷新画质后重试')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1024 * 1024) throw new Error('咪咕清单过大，无法确认媒体版本')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (lines[0] !== '#EXTM3U') throw new Error('咪咕返回的内容不是有效播放清单')
    for (const line of lines) {
      if (!/^#EXT-X-(?:KEY|SESSION-KEY):/.test(line)) continue
      if (!/(?:^|[:,])METHOD=NONE(?:,|$)/.test(line)) throw new Error('该媒体受保护，咪咕清单声明了尚未支持的加密方式')
    }
    if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'))) {
      const index = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'))
      const child = lines.slice(index + 1).find(line => !line.startsWith('#'))
      if (!child) throw new Error('咪咕主清单缺少媒体版本')
      url = manifestURL(child, response.url || url)
      continue
    }
    if (!lines.some(line => line.startsWith('#EXTINF:')) || !lines.some(line => !line.startsWith('#'))) throw new Error('咪咕清单缺少媒体分片')
    if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('咪咕清单尚未完成，暂不能验证完整节目')
    return
  }
  throw new Error('咪咕清单嵌套过深，无法确认媒体版本')
}
