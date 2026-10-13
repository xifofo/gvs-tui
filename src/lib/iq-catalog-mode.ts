type Fetcher = (url: string, init: RequestInit) => Promise<Response>
type ModeEntry = { expires: number; value: Promise<string> }
export type IQCatalogRegion = (init: RequestInit, scope: string, fetcher: Fetcher) => Promise<string>

const MODE_TTL_MS = 60_000
const HOME_URL = 'https://www.iq.com/'

/** Read the public site's catalog selection for this exit, without account cookies. */
export function iqCatalogRegion(html: string): string {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html)
  if (!script) throw new Error('IQ 页面未返回目录地区')
  const data = JSON.parse(script[1]!)
  const mode = data?.props?.initialState?.language?.modeLangObj?.mod
  if (typeof mode !== 'string' || !/^[a-z]{2,8}$/.test(mode)) throw new Error('IQ 页面未返回目录地区')
  return mode
}

export function iqTaiwanCatalog(html: string): boolean {
  return iqCatalogRegion(html) === 'ntw'
}

/** Never rewrite signed, playback or authentication requests. */
export function isIQPublicCatalogRequest(url: URL, init: RequestInit): boolean {
  if (url.protocol !== 'https:' || url.hostname !== 'pcw-api.iq.com' || url.username || url.password
    || (init.method || 'GET').toUpperCase() !== 'GET' || init.body != null) return false
  if (url.pathname !== '/api/search2' && !/^\/api\/v2\/episodeListSource\/\d+$/.test(url.pathname)) return false
  return ![...url.searchParams.keys()].some(key => /sign|auth|token|^vf$/i.test(key))
}

/** Only unsigned public search/episode-list requests need the Taiwan catalog override. */
export function isIQCatalogRequest(url: URL, init: RequestInit): boolean {
  return isIQPublicCatalogRequest(url, init) && url.searchParams.get('modeCode') === 'intl'
}

/** Share exit detection between search supplementation and the existing Taiwan episode fix. */
export function createIQCatalogRegion(options: { log: (line: string) => void; now?: () => number }): IQCatalogRegion {
  const entries = new Map<string, ModeEntry>()
  const now = options.now || Date.now
  return async (init, scope, fetcher) => {
    init.signal?.throwIfAborted()
    let entry = entries.get(scope)
    if (!entry || entry.expires <= now()) {
      if (entries.size >= 4) entries.delete(entries.keys().next().value!)
      const value = (async () => {
        try {
          const timeout = AbortSignal.timeout(8_000)
          const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
          const response = await fetcher(HOME_URL, {
            method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', signal,
            headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' },
          })
          if (!response.ok) throw new Error('IQ 目录地区请求失败')
          const html = await response.text()
          if (html.length > 6 << 20) throw new Error('IQ 目录地区页面过大')
          const mode = iqCatalogRegion(html)
          options.log(`iq_catalog_mode host=pcw-api.iq.com mode=${mode} taiwan=${mode === 'ntw'}`)
          return mode
        } catch {
          options.log('iq_catalog_mode host=pcw-api.iq.com unavailable')
          return ''
        }
      })()
      entry = { expires: now() + MODE_TTL_MS, value }
      entries.set(scope, entry)
    }
    const mode = await entry.value
    init.signal?.throwIfAborted()
    return mode
  }
}

/** Older gateways pin these public catalogs to intl, even when the source exit is Taiwan. */
export function createIQCatalogMode(options: { log: (line: string) => void; now?: () => number }, region = createIQCatalogRegion(options)) {
  return async (input: string, init: RequestInit, scope: string, fetcher: Fetcher): Promise<string> => {
    const url = new URL(input)
    if (!isIQCatalogRequest(url, init) || await region(init, scope, fetcher) !== 'ntw') return input
    url.searchParams.set('modeCode', 'ntw')
    return url.href
  }
}
