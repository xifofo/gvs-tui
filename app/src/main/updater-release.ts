// GitHub 只负责发现发布；安装包仍由 electron-updater 下载并校验。
// Atom 没有可靠的 draft/prerelease 字段，只能提供官方页面线索，不能授权自动安装。
export const RELEASES_URL = 'https://github.com/my-name-is-alan/gvs-tui/releases'
export const RELEASES_API = 'https://api.github.com/repos/my-name-is-alan/gvs-tui/releases?per_page=50'
export const RELEASES_ATOM = `${RELEASES_URL}.atom`
export const TAG_PREFIX = 'desktop-v'
const MINUTE = 60_000
const CACHE_MS = 15 * MINUTE
const MAX_CACHE_AGE = 7 * 24 * 60 * MINUTE
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export type DesktopRelease = { tag: string; version: string; url: string }
type SourceCache = { etag: string; checkedAt: number; release: DesktopRelease | null }
export type ReleaseCache = {
  schema: 1
  api: SourceCache | null
  atom: SourceCache | null
  failures: number
  retryAt: number
  failureMessage: string
  atomAllowed: boolean
}
export type ReleaseLookup = {
  verified: boolean
  release: DesktopRelease | null
  message: string
  url: string
}
type Dependencies = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
  timeoutMs?: number
  cache?: unknown
  save?: (cache: ReleaseCache) => void
}

function stableVersion(raw: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(raw)
    && raw.split('.').every(n => Number.isSafeInteger(Number(n)))
}

export function newer(a: string, b: string): boolean {
  if (!stableVersion(a)) return false
  const match = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(b)
  if (!match) return false
  const pa = a.split('.').map(Number)
  const pb = match[1]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! > pb[i]!
  }
  return !!match[2]
}

export function releaseFromURL(raw: unknown): DesktopRelease | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    const base = `${RELEASES_URL}/tag/`
    if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username || url.password || url.search || url.hash
      || !url.href.startsWith(base)) return null
    const tag = url.href.slice(base.length)
    const version = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : ''
    return stableVersion(version) ? { tag, version, url: base + tag } : null
  } catch { return null }
}

function bestRelease(rows: DesktopRelease[]): DesktopRelease | null {
  return rows.reduce<DesktopRelease | null>((best, row) => !best || newer(row.version, best.version) ? row : best, null)
}

export function parseReleaseList(value: unknown): DesktopRelease | null {
  if (!Array.isArray(value)) throw new Error('GitHub 更新列表格式异常，请稍后重试。')
  const rows: DesktopRelease[] = []
  for (const valueRow of value) {
    if (!valueRow || typeof valueRow !== 'object') continue
    const row = valueRow as Record<string, unknown>
    if (row.draft !== false || row.prerelease !== false) continue
    const release = releaseFromURL(row.html_url)
    if (release && row.tag_name === release.tag) rows.push(release)
  }
  return bestRelease(rows)
}

/** Read only the entry's own alternate link, never release notes or external links. */
export function parseReleaseAtom(xml: string): DesktopRelease | null {
  if (!/<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/.test(xml)
    || !/<\/feed\s*>\s*$/.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('GitHub 发布订阅格式异常，请稍后重试。')
  }
  const rows: DesktopRelease[] = []
  for (const entry of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g)) {
    // Ignore markup in content, CDATA and comments, including any user-written links.
    const metadata = entry[1]!.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(content|summary)\b[^>]*>[\s\S]*?<\/\1\s*>/g, '')
    for (const link of metadata.matchAll(/<link\b([^>]*?)\/?\s*>/g)) {
      const attrs = new Map([...link[1]!.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1], m[3]]))
      if (attrs.get('rel') !== 'alternate') continue
      const release = releaseFromURL(attrs.get('href'))
      if (release) rows.push(release)
    }
  }
  return bestRelease(rows)
}

export function retryTime(headers: Headers, now: number, failures: number): number {
  let waitUntil = now + Math.min(6 * 60 * MINUTE, MINUTE * 2 ** Math.min(12, Math.max(0, failures - 1)))
  const after = headers.get('retry-after')
  if (after) {
    const parsed = /^\d+(?:\.\d+)?$/.test(after) ? now + Number(after) * 1000 : Date.parse(after)
    if (Number.isFinite(parsed)) waitUntil = Math.max(waitUntil, parsed)
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset')) * 1000
    if (Number.isFinite(reset)) waitUntil = Math.max(waitUntil, reset)
  }
  return waitUntil
}

export function readReleaseCache(raw: unknown, now: number): ReleaseCache {
  const empty: ReleaseCache = { schema: 1, api: null, atom: null, failures: 0, retryAt: 0, failureMessage: '', atomAllowed: false }
  if (!raw || typeof raw !== 'object' || (raw as ReleaseCache).schema !== 1) return empty
  const row = raw as ReleaseCache
  const readSource = (source: SourceCache | null): SourceCache | null => {
    if (!source || !Number.isFinite(source.checkedAt) || source.checkedAt > now + MINUTE || now - source.checkedAt > MAX_CACHE_AGE) return null
    const release = source.release === null ? null : releaseFromURL(source.release?.url)
    if (source.release !== null && (!release || source.release.tag !== release.tag || source.release.version !== release.version)) return null
    const etag = typeof source.etag === 'string' && source.etag.length <= 512 && !/[\r\n]/.test(source.etag) ? source.etag : ''
    return { etag, checkedAt: source.checkedAt, release }
  }
  return {
    ...empty, api: readSource(row.api), atom: readSource(row.atom),
    failures: Number.isInteger(row.failures) ? Math.min(12, Math.max(0, row.failures)) : 0,
    retryAt: Number.isFinite(row.retryAt) && row.retryAt <= now + MAX_CACHE_AGE ? Math.max(0, row.retryAt) : 0,
    // Cache only controlled short messages, never server response bodies or raw URLs.
    failureMessage: typeof row.failureMessage === 'string' && row.failureMessage.length <= 200 && !/[<>\r\n]|https?:/i.test(row.failureMessage) ? row.failureMessage : '',
    atomAllowed: row.atomAllowed === true,
  }
}

class LookupError extends Error {
  constructor(message: string, readonly status = 0, readonly headers = new Headers()) { super(message) }
}

export function checkFailureMessage(error: unknown): string {
  if (error instanceof LookupError) return error.message
  if (error instanceof Error && /格式异常|响应过大/.test(error.message)) return error.message
  return '无法连接 GitHub 更新服务，请检查网络或系统代理后重试。'
}

export class DesktopReleaseClient {
  private readonly now: () => number
  private readonly cache: ReleaseCache
  private flight: Promise<ReleaseLookup> | null = null

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now
    this.cache = readReleaseCache(deps.cache, this.now())
  }

  check(manual = false): Promise<ReleaseLookup> {
    if (this.flight) return this.flight
    this.flight = this.lookup(manual).finally(() => { this.flight = null })
    return this.flight
  }

  private save(): void {
    try { this.deps.save?.(structuredClone(this.cache)) } catch { /* Cache failure must not fail a check. */ }
  }

  private confirmed(): ReleaseLookup {
    const release = this.cache.api?.release ?? null
    // The API list is bounded and also includes terminal-client releases. An empty
    // desktop selection cannot prove that the installed desktop is up to date.
    return {
      verified: release !== null, release,
      message: release ? '' : 'GitHub 发布列表中未找到桌面正式版，暂时无法确认是否有更新。可打开官方发布页查看。',
      url: release?.url ?? RELEASES_URL,
    }
  }

  private async request(url: string, cached: SourceCache | null, atom: boolean): Promise<SourceCache> {
    const abort = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; abort.abort() }, this.deps.timeoutMs ?? 12_000)
    try {
      const headers: Record<string, string> = { Accept: atom ? 'application/atom+xml' : 'application/vnd.github+json', 'User-Agent': 'GVS-Desktop' }
      if (cached?.etag) headers['If-None-Match'] = cached.etag
      if (!atom) headers['X-GitHub-Api-Version'] = '2022-11-28'
      // Never send requests to a redirected mirror, login page, or another repository.
      const response = await this.deps.fetch(url, { headers, signal: abort.signal, redirect: 'error', credentials: 'omit' })
      if (response.url && response.url !== url) throw new LookupError('GitHub 更新地址发生变化，请从官方发布页查看。')
      if (response.status === 304) {
        if (!cached) throw new LookupError('GitHub 更新缓存不可用，请稍后重试。')
        return { ...cached, checkedAt: this.now() }
      }
      if (!response.ok) {
        const limited = response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')
        const message = (response.status === 403 || response.status === 429)
          ? limited ? `GitHub 更新检查达到请求限额（${response.status}）。` : 'GitHub 拒绝更新检查（403），可能是访问限制或共享出口限额。'
          : `GitHub 更新服务暂不可用（${response.status}），请稍后重试。`
        await response.body?.cancel()
        throw new LookupError(message, response.status, response.headers)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new LookupError('GitHub 更新列表为空，请稍后重试。')
      const chunks: Uint8Array[] = []
      let bytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel()
          throw new LookupError('GitHub 更新响应过大，请从官方发布页查看。')
        }
        chunks.push(value)
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks))
      let release: DesktopRelease | null
      try { release = atom ? parseReleaseAtom(text) : parseReleaseList(JSON.parse(text)) }
      catch { throw new LookupError(`GitHub ${atom ? '发布订阅' : '更新列表'}格式异常，请稍后重试。`) }
      return { release, etag: response.headers.get('etag') ?? '', checkedAt: this.now() }
    } catch (error) {
      if (timedOut) throw new LookupError('连接 GitHub 更新服务超时，请检查网络或系统代理后重试。')
      throw error
    } finally { clearTimeout(timer) }
  }

  private async lookup(manual: boolean): Promise<ReleaseLookup> {
    const now = this.now()
    if (this.cache.api && now - this.cache.api.checkedAt < (manual ? MINUTE : CACHE_MS) && !this.cache.failures) {
      return this.confirmed()
    }
    if (now >= this.cache.retryAt) {
      try {
        this.cache.api = await this.request(RELEASES_API, this.cache.api, false)
        this.cache.failures = 0
        this.cache.retryAt = 0
        this.cache.failureMessage = ''
        this.cache.atomAllowed = false
        this.save()
        return this.confirmed()
      } catch (error) {
        this.cache.failures++
        this.cache.retryAt = retryTime(error instanceof LookupError ? error.headers : new Headers(), this.now(), this.cache.failures)
        this.cache.failureMessage = checkFailureMessage(error)
        this.cache.atomAllowed = error instanceof LookupError && (error.status === 403 || error.status === 429)
        // Persist before trying the public feed, so a restart still honors API backoff.
        this.save()
        if (this.cache.atomAllowed) {
          try {
            if (!this.cache.atom || this.now() - this.cache.atom.checkedAt >= CACHE_MS) {
              this.cache.atom = await this.request(RELEASES_ATOM, this.cache.atom, true)
              this.save()
            }
          } catch { /* Keep the actionable API failure; a feed failure is not "latest". */ }
        }
      }
    }
    const candidate = this.cache.atomAllowed ? this.cache.atom?.release : null
    const retryMinutes = Math.max(1, Math.ceil((this.cache.retryAt - this.now()) / MINUTE))
    const hint = candidate ? `发布订阅列出 ${candidate.version}，尚未确认正式版；可打开官方发布页查看。` : '可打开官方发布页查看。'
    return {
      verified: false,
      release: null,
      message: `${this.cache.failureMessage || '暂时无法确认最新版本。'}约 ${retryMinutes} 分钟后可重试。${hint}`,
      url: candidate?.url ?? RELEASES_URL,
    }
  }
}
