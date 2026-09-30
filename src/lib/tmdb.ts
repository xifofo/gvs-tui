import { dots } from './name.ts'
import { fetchRemote, normalizeHttpProxy } from './proxy.ts'
import { runLog } from './runlog.ts'

export type TmdbResult = {
  id: number
  name: string
  title: string
  year: number
  overview: string
  englishDots: string
  kind: 'movie' | 'show'
}

type SearchResponse = {
  results?: Array<{
    id: number
    media_type?: string
    name?: string
    title?: string
    original_name?: string
    original_title?: string
    first_air_date?: string
    release_date?: string
    overview?: string
  }>
}

class TmdbHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401 || status === 403
      ? 'TMDB 凭证无效或没有访问权限，请检查设置中的 TMDB Key'
      : status === 429 ? 'TMDB 请求过于频繁，请稍后重试' : `TMDB HTTP ${status}`)
  }
}

export function normalizeTmdbProxy(value: string): string {
  return normalizeHttpProxy(value)
}

type TmdbRequestInit = RequestInit & { proxy?: string }
type TmdbFetch = (url: string, init?: TmdbRequestInit) => Promise<Response>

/** An explicitly configured TMDB proxy must not fall back to a direct request. */
const fetchTmdb: TmdbFetch = (url, init) => init?.proxy ? fetch(url, init) : fetchRemote(url, init)

/** Both are TMDB API hosts. Keep the last reachable one first for this session. */
export function createTmdbSearch(fetcher: TmdbFetch = fetchTmdb, timeoutMs = 10_000) {
  let preferred = 'api.tmdb.org'
  return async (apiKey: string, lang: string, query: string, options: { proxy?: string } = {}): Promise<TmdbResult[]> => {
    const key = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!key) throw new Error('未配置 TMDB API Key')
    if (!query.trim()) throw new Error('缺少用于 TMDB 搜索的片名')
    const proxy = normalizeTmdbProxy(options.proxy || '')
    const route = proxy ? 'proxy' : 'default'
    const hosts = [preferred, ...['api.tmdb.org', 'api.themoviedb.org'].filter(h => h !== preferred)]
    for (const host of hosts) {
      // Missing platform categories must not lock a movie into the TV endpoint.
      const url = new URL(`https://${host}/3/search/multi`)
      url.search = new URLSearchParams({ language: lang || 'zh-CN', query: query.trim(), include_adult: 'false' }).toString()
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (key.includes('.')) headers.Authorization = `Bearer ${key}`
      else url.searchParams.set('api_key', key)
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      const started = Date.now()
      try {
        const res = await fetcher(url.href, { headers, signal: ac.signal, ...(proxy ? { proxy } : {}) })
        if (!res.ok) {
          await res.body?.cancel()
          throw new TmdbHttpError(res.status)
        }
        // The timeout includes reading the body, not just receiving headers.
        const out = await res.json() as SearchResponse
        if (!Array.isArray(out.results)) throw new Error('invalid TMDB response')
        preferred = host
        const rows = out.results.filter(h => h.media_type === 'movie' || h.media_type === 'tv').slice(0, 8)
        runLog(`tmdb search host=${host} via=${route} ${Date.now() - started}ms ok candidates=${rows.length}`)
        return rows.map((h) => {
          const movie = h.media_type === 'movie'
          const date = (movie ? h.release_date : h.first_air_date) || ''
          const name = (movie ? h.title : h.name) || ''
          return {
            id: h.id,
            name,
            title: h.title || '',
            year: Number.parseInt(date.slice(0, 4), 10) || 0,
            overview: h.overview || '',
            englishDots: dots(h.original_name || h.original_title || name),
            kind: movie ? 'movie' : 'show',
          }
        })
      } catch (e) {
        // Never log the request URL or raw fetch error: either can contain the key.
        const reason = e instanceof TmdbHttpError ? `http=${e.status}` : ac.signal.aborted ? 'timeout' : 'network-or-response'
        runLog(`tmdb search host=${host} via=${route} ${Date.now() - started}ms fail ${reason}`)
        if (e instanceof TmdbHttpError && e.status < 500) throw e
      } finally {
        clearTimeout(timer)
      }
    }
    throw new Error(proxy
      ? '无法通过代理连接 TMDB（两个 API 地址均未成功），请检查代理是否运行及其分流规则'
      : '无法连接 TMDB（两个 API 地址均未成功），可在设置 → TMDB 代理中填写本地代理地址')
  }
}

export const tmdbSearch = createTmdbSearch()
