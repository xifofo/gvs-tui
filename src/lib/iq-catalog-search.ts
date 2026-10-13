import { createIQCatalogMode, createIQCatalogRegion, isIQPublicCatalogRequest } from './iq-catalog-mode.ts'

type Fetcher = (url: string, init: RequestInit) => Promise<Response>
type ObjectData = Record<string, unknown>
type SearchBody = ObjectData & { data: ObjectData & { epg: ObjectData[] } }
type SearchResult = { response: Response; body?: SearchBody }
const MAX_BYTES = 6 << 20
const obj = (v: unknown): v is ObjectData => !!v && typeof v === 'object' && !Array.isArray(v)

/** Album zero is a sentinel on standalone films, not a shared media identity. */
function mediaID(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return /^[1-9]\d{0,19}$/.test(id) ? id : ''
}

function identity(row: ObjectData): string {
  return mediaID(row.albumId) || mediaID(row.qipuId)
}

function validCode(code: unknown): boolean { return code === undefined || code === 0 || code === '0' }

async function readSearch(response: Response): Promise<SearchResult> {
  if (!response.ok) return { response }
  try {
    const text = await response.clone().text()
    if (Buffer.byteLength(text) > MAX_BYTES) return { response }
    const body = JSON.parse(text)
    if (!obj(body) || !validCode(body.code) || !obj(body.data) || !validCode(body.data.code)
      || !Array.isArray(body.data.epg) || !body.data.epg.every(obj)) return { response }
    return { response, body: body as SearchBody }
  } catch { return { response } }
}

/** Keep the preferred catalog's rows/metadata; add distinct international entries. */
export function mergeIQSearchBodies(primary: SearchBody, supplement?: SearchBody): SearchBody {
  const seen = new Set<string>()
  const epg: ObjectData[] = []
  for (const row of [...primary.data.epg, ...(supplement?.data.epg || [])]) {
    const id = identity(row)
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    // The legacy gateway uses albumId for every search card, including films.
    // Preserve the real qipu ID so unrelated films do not all collapse to id=0.
    epg.push(!mediaID(row.albumId) && mediaID(row.qipuId) ? { ...row, albumId: row.qipuId } : row)
  }
  const data: SearchBody['data'] = { ...primary.data, epg }
  // These are source pagination bounds, not the exact size of a global union.
  for (const field of ['total', 'docs'] as const) {
    const values = [primary.data[field], supplement?.data[field]]
    if (values.some(value => typeof value === 'number' && value >= 0)) {
      data[field] = Math.max(epg.length, ...values.filter((value): value is number => typeof value === 'number' && value >= 0))
    }
  }
  return { ...primary, data }
}

function mergedResponse(result: SearchResult, supplement?: SearchResult): Response {
  if (!result.body) return result.response
  const text = JSON.stringify(mergeIQSearchBodies(result.body, supplement?.body))
  if (Buffer.byteLength(text) > MAX_BYTES) return result.response
  const headers = new Headers(result.response.headers)
  // The tunnel forwards a decoded, rebuilt JSON body, not the original compressed bytes.
  for (const name of ['content-length', 'content-encoding', 'etag', 'content-md5', 'digest', 'transfer-encoding']) headers.delete(name)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(text, { status: result.response.status, statusText: result.response.statusText, headers })
}

/** Search the actual exit's public catalog plus intl, without mixing episode lists. */
export function createIQCatalogFetch(options: { log: (line: string) => void; now?: () => number; searchTimeoutMs?: number }) {
  const region = createIQCatalogRegion(options)
  const mode = createIQCatalogMode(options, region)
  return async (input: string, init: RequestInit, scope: string, fetcher: Fetcher): Promise<Response> => {
    const url = new URL(input), requested = url.searchParams.get('modeCode') || ''
    if (!isIQPublicCatalogRequest(url, init) || url.pathname !== '/api/search2' || !/^[a-z]{2,8}$/.test(requested)) {
      return fetcher(await mode(input, init, scope, fetcher), init)
    }
    const preferred = requested === 'intl' ? await region(init, scope, fetcher) || requested : requested
    const modes = preferred === 'intl' ? ['intl'] : [preferred, 'intl']
    const results = await Promise.allSettled(modes.map(async value => {
      const target = new URL(input)
      target.searchParams.set('modeCode', value)
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(new DOMException('IQ catalog search timed out', 'TimeoutError')), options.searchTimeoutMs ?? 8_000)
      const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal
      try { return await readSearch(await fetcher(target.href, { ...init, signal })) }
      finally { clearTimeout(timer) }
    }))
    init.signal?.throwIfAborted()
    const first = results[0]!, second = results[1]
    const primary = first.status === 'fulfilled' ? first.value : undefined
    const supplemental = second?.status === 'fulfilled' ? second.value : undefined
    const chosen = primary?.body ? primary : supplemental?.body ? supplemental : primary || supplemental
    options.log(`iq_catalog_search host=pcw-api.iq.com catalogs=${modes.join(',')} primary=${primary?.body ? 'ok' : 'unavailable'} supplement=${supplemental?.body ? 'ok' : second ? 'unavailable' : 'none'}`)
    if (!chosen) throw first.status === 'rejected' ? first.reason : new Error('IQ 搜索请求失败')
    return mergedResponse(chosen, chosen === primary ? supplemental : undefined)
  }
}
