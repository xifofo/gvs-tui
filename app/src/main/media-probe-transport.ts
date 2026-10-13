import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { Readable } from 'node:stream'
import { HttpsProxyAgent } from 'https-proxy-agent'

type ResolveProxy = (url: string) => Promise<string>

function probeURL(input: string): URL {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('咪咕清单地址无效')
  return url
}

/** Honor the first PAC route; a failed proxy must never silently become DIRECT. */
export function mediaProbeProxy(route: string): string {
  const first = route.split(';')[0]?.trim() || 'DIRECT'
  if (first === 'DIRECT') return ''
  const match = /^(PROXY|HTTPS)\s+(\S+)$/i.exec(first)
  if (!match) throw new Error('咪咕清单暂不支持当前系统代理类型，请使用系统的 HTTP 代理')
  const url = probeURL(`${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`)
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('系统代理地址无效')
  return url.href
}

function requestMedia(url: URL, init: RequestInit, proxy: string, segment: boolean): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers)
    for (const name of ['host', 'content-length', 'connection', 'transfer-encoding']) headers.delete(name)
    headers.set('accept-encoding', 'identity')
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(url, {
      method: init.method || 'GET', headers: Object.fromEntries(headers), agent: agent || false,
      signal: init.signal ?? undefined,
    })
    req.once('error', error => { agent?.destroy(); reject(error) })
    req.once('response', async incoming => {
      let streaming = false
      try {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item)
          else if (value !== undefined) responseHeaders.set(name, value)
        }
        const status = incoming.statusCode || 502
        const redirect = [301, 302, 303, 307, 308].includes(status) && responseHeaders.has('location')
        let body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array> | null = null
        if (redirect || init.method === 'HEAD' || [204, 205, 304].includes(status)) {
          incoming.destroy()
        } else {
          const encoding = String(incoming.headers['content-encoding'] || '').toLowerCase()
          const decode = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress()
            : encoding === 'deflate' ? createInflate() : undefined
          if (decode) incoming.once('error', error => decode.destroy(error))
          const stream = decode ? incoming.pipe(decode) : incoming
          if (segment) {
            // Resolve at headers so the downloader can count bytes, apply its
            // idle/low-speed policy and cancel a probe without buffering a file.
            incoming.once('close', () => agent?.destroy())
            if (decode) decode.once('close', () => incoming.destroy())
            body = Readable.toWeb(stream, {
              strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength },
            }) as ReadableStream<Uint8Array>
            streaming = true
          } else {
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of stream) {
              const bytes = Buffer.from(chunk)
              size += bytes.length
              if (size > 1024 * 1024) throw new Error('咪咕清单过大，无法确认媒体版本')
              chunks.push(bytes)
            }
            body = new Uint8Array(Buffer.concat(chunks))
          }
          if (decode) { responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length') }
        }
        const response = new Response(body, { status, headers: responseHeaders })
        Object.defineProperty(response, 'url', { value: url.href })
        resolve(response)
      } catch (error) { incoming.destroy(); reject(error) }
      finally { if (!streaming) agent?.destroy() }
    })
    req.end()
  })
}

/** Node transport preserves CDN Referer/UA that Chromium net.fetch rejects. */
async function fetchNativeMedia(input: string, init: RequestInit, resolveProxy: ResolveProxy, segment: boolean): Promise<Response> {
  if (init.body != null || !['GET', 'HEAD'].includes(init.method || 'GET')) throw new Error('播放清单仅支持读取请求')
  let url = probeURL(input)
  const headers = new Headers(init.headers)
  for (let depth = 0; depth < 6; depth++) {
    init.signal?.throwIfAborted()
    const proxy = mediaProbeProxy(await resolveProxy(url.href))
    let response: Response
    try { response = await requestMedia(url, { ...init, headers }, proxy, segment) }
    catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error
      throw new Error(segment ? '媒体分段读取失败，请检查本机网络或系统代理后重试' : '咪咕播放清单读取失败，请检查本机网络或系统代理后重试', { cause: error })
    }
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location || init.redirect === 'manual') return response
    if (init.redirect === 'error') throw new Error('咪咕清单发生了重定向')
    const next = probeURL(new URL(location, url).href)
    if (next.origin !== url.origin) { headers.delete('authorization'); headers.delete('cookie') }
    url = next
  }
  throw new Error('咪咕清单重定向过多，请刷新画质后重试')
}

/** Bounded manifest transport, including the decompressed 1 MiB size cap. */
export function fetchNativeMediaProbe(input: string, init: RequestInit, resolveProxy: ResolveProxy): Promise<Response> {
  return fetchNativeMedia(input, init, resolveProxy, false)
}

/** Binary media streams have no manifest cap and retain cancellable backpressure. */
export function fetchNativeMediaSegment(input: string, init: RequestInit, resolveProxy: ResolveProxy): Promise<Response> {
  return fetchNativeMedia(input, init, resolveProxy, true)
}
