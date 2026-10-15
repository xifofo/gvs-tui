import { isObj } from './util.ts'
type Invoke = (p: string, a: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>
export function normalizeManifestDetail(data: Record<string, unknown>): Record<string, unknown> {
  const raw = isObj(data.raw) ? data.raw : {}
  const out = { ...raw, ...data }
  const source = Array.isArray(data.episodes) && data.episodes.length ? data.episodes : Array.isArray(raw.episodes) ? raw.episodes : []
  const kind = String(out.type || out.kind || '').toLowerCase()
  out.episodes = source.filter(isObj).map(e => ({ ...(isObj(e.meta) ? e.meta : {}), ...e }))
  if (!source.length && ['movie','film','episode','video'].includes(kind) && out.id) out.episodes = [{ id: out.id, title: out.title, number: 1, duration: out.duration }]
  if (['movie','film'].includes(kind)) out.category = '电影'
  return out
}
/** Disney+ detail (gateway dsnp actionDetail): episodes play by their own mediaId
 * (an episode id is not a page the service serves); a movie plays by the page's
 * playback resourceId. */
export function dsnpDetail(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }
  const rows = Array.isArray(data.episodes) ? data.episodes.filter(isObj) : []
  if (rows.length) {
    out.episodes = rows.map(e => ({ ...e, vid: String(e.mediaId || e.id || ''), title: String(e.episodeTitle || e.title || ''), number: e.episode, duration: Number(e.durationMs) > 0 ? Math.round(Number(e.durationMs) / 1000) : undefined }))
    out.type = 'series'
  } else {
    const play = isObj(data.playback) ? data.playback : {}
    const vid = String(play.resourceId || '')
    out.type = 'movie'
    const versions = Array.isArray(data.versions) ? data.versions.filter(isObj) : []
    if (vid && versions.length > 1) {
      // Disney+ IMAX Enhanced / 原版: one playbackId, the version travels as `mediaId|version`
      // (the gateway switches the profile preference for that one request and verifies the cut).
      out.episodes = versions.map((v, i) => {
        const kind = String(v.kind || '')
        const label = String(v.label || (kind === 'imax' ? 'IMAX Enhanced' : '原版'))
        return { vid: `${String(v.mediaId || vid)}|${kind}`, id: data.id, title: v.default === true ? `${label}（当前默认）` : label, edition: kind === 'imax' ? 'IMAX' : '', group: 'edition', number: i + 1, duration: Number(v.durationMs) > 0 ? Math.round(Number(v.durationMs) / 1000) : undefined }
      })
      if (!out.year && data.year) out.year = data.year
      return out
    }
    out.episodes = vid ? [{ vid, id: data.id, title: data.title, number: 1, duration: Number(data.runtimeMs) > 0 ? Math.round(Number(data.runtimeMs) / 1000) : undefined }] : []
  }
  if (!out.year && data.year) out.year = data.year
  return out
}
export async function manifestDetail(invoke: Invoke, provider: string, id: string): Promise<Record<string, unknown>> {
  const input = id.startsWith('https://') ? { url: id } : { id }
  const first = await invoke(provider, 'detail', input)
  let result = normalizeManifestDetail(provider === 'dsnp' ? dsnpDetail(isObj(first.raw) ? { ...first.raw, ...first } : first) : first)
  const episodes = [...(result.episodes as Record<string, unknown>[])]
  const cursors = new Set<string>()
  for (let page = 0; provider === 'mewatch' && result.hasMore === true && page < 20; page++) {
    const cursor = String(result.nextCursor || '')
    if (!cursor || cursors.has(cursor)) break
    cursors.add(cursor)
    const next = normalizeManifestDetail(await invoke(provider, 'detail', { ...input, cursor }))
    episodes.push(...next.episodes as Record<string, unknown>[])
    result = { ...result, hasMore: next.hasMore, nextCursor: next.nextCursor }
  }
  const seen = new Set<string>()
  result.episodes = episodes.filter(e => { const id = String(e.vid || e.id || ''); if (!id || seen.has(id)) return false; seen.add(id); return true })
  return result
}
