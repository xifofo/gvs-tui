import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetchMediaProbe } from './proxy.ts'
import { asString, isObj } from './util.ts'

type Preference = { version: 1; host: string; checkedAt: number }
type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>
const SAMPLE_BYTES = 128 * 1024
const PREFERENCE_TTL = 6 * 60 * 60 * 1000

function mediaURL(value: string): URL | undefined {
  try {
    const u = new URL(value), host = u.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return
    if (host === 'iq.com' || host.endsWith('.iq.com') || host === 'iqiyi.com' || host.endsWith('.iqiyi.com')) return u
  } catch { /* invalid candidate */ }
}

/** CDN authorization belongs to this physical file. Only its byte window varies. */
export function iqCDNWindow(candidate: string, original: string): string | undefined {
  const next = mediaURL(candidate), current = mediaURL(original)
  if (!next || !current || next.pathname !== current.pathname) return
  for (const key of ['start', 'end', 'contentlength', 'sd']) {
    const value = current.searchParams.get(key)
    if (value !== null) next.searchParams.set(key, value)
  }
  return next.href
}

function preference(path: string, now: number): Preference | undefined {
  try {
    const p = JSON.parse(readFileSync(path, 'utf8'))
    if (p.version === 1 && typeof p.host === 'string' && Number.isFinite(p.checkedAt) && p.checkedAt <= now && now-p.checkedAt < PREFERENCE_TTL) return p
  } catch { /* no prior measurement */ }
}

export function rememberIQCDN(path: string, host: string, now = Date.now()): void {
  if (!mediaURL(`https://${host}/`)) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, host, checkedAt: now } satisfies Preference))
  } catch { /* a read-only profile must not prevent downloading */ }
}

async function probe(url: string, headers: Record<string, string>, fetcher: ProbeFetch, signal?: AbortSignal): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  const started = performance.now()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetcher(url, { headers: { ...headers, Range: `bytes=0-${SAMPLE_BYTES-1}` }, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal })
    if (![200, 206].includes(response.status) || !response.body || /text\/html|application\/json/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel().catch(() => {})
      return 0
    }
    const expected = Number(new URL(url).searchParams.get('contentlength')) || Number(response.headers.get('content-length')) || SAMPLE_BYTES
    const target = Math.min(SAMPLE_BYTES, expected)
    reader = response.body.getReader()
    let bytes = 0
    while (bytes < target) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
    }
    if (bytes < target || bytes <= 0) return 0
    return Math.min(bytes, target) * 1000 / Math.max(1, performance.now()-started)
  } catch { return 0 }
  finally {
    clearTimeout(timer)
    controller.abort()
    await reader?.cancel().catch(() => {})
  }
}

export async function selectIQCDN(playlist: string, raw: unknown, options: {
  preferencePath: string; headers: Record<string, string>; signal?: AbortSignal
  excluded?: Set<string>; fetcher?: ProbeFetch; now?: number
  note?: (message: string) => void
}): Promise<{ playlist: string; hosts: string[]; alternatives: boolean }> {
  const now = options.now ?? Date.now(), saved = preference(options.preferencePath, now)
  let preferred = saved?.host ?? '', alternatives = false
  const choices = new Map<string, string[]>(), selected = new Map<string, string>(), hosts = new Set<string>()
  for (const row of Array.isArray(raw) ? raw.filter(isObj) : []) {
    if (!Array.isArray(row.urls)) continue
    const urls = row.urls.map(asString).filter(u => mediaURL(u)?.pathname === row.path).slice(0, 4)
    if (urls.length) choices.set(asString(row.path), urls)
  }
  const lines = playlist.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    options.signal?.throwIfAborted()
    if (!line || line.startsWith('#')) continue
    const original = mediaURL(line)
    if (!original) continue
    const key = original.pathname
    if (!selected.has(key)) {
      const candidates = [...new Map((choices.get(key) ?? [line]).map(u => [mediaURL(u)!.hostname, u])).values()]
      alternatives ||= candidates.length > 1
      const eligible = candidates.filter(u => !options.excluded?.has(mediaURL(u)!.hostname))
      let winner = eligible.find(u => mediaURL(u)!.hostname === preferred)
      if (!winner && eligible.length > 1) {
        options.note?.('比较官方 CDN 的响应和传输速度')
        const scores = await Promise.all(eligible.map(async u => ({ url: u, score: await probe(iqCDNWindow(u, line)!, options.headers, options.fetcher ?? fetchMediaProbe, options.signal) })))
        options.signal?.throwIfAborted()
        scores.sort((a,b) => b.score-a.score)
        if (scores[0]!.score > 0) {
          winner = scores[0]!.url
          preferred = mediaURL(winner)!.hostname
          rememberIQCDN(options.preferencePath, preferred, now)
          options.note?.(`已优选并记住 ${preferred}`)
        }
      }
      winner ??= eligible[0] ?? candidates[0] ?? line
      selected.set(key, winner)
      hosts.add(mediaURL(winner)!.hostname)
    }
    lines[index] = iqCDNWindow(selected.get(key)!, line) ?? line
  }
  return { playlist: lines.join('\n'), hosts: [...hosts], alternatives }
}

export class IQCDNSlowError extends Error {
  constructor() { super('IQ CDN 持续低速，重新测速并续传'); this.name = 'IQCDNSlowError' }
}

/** Ignore startup/cache work and isolated dips; switch only after a sustained slow transfer. */
export function iqCDNSlowGuard(clock = Date.now, threshold = 256*1024): (phase?: string, speed?: number) => boolean {
  const started = clock()
  let slowAt: number | undefined
  return (phase, speed) => {
    const now = clock()
    if (phase !== 'download' || speed === undefined || now-started < 20000 || speed >= threshold) { slowAt = undefined; return false }
    slowAt ??= now
    return now-slowAt >= 20000
  }
}
