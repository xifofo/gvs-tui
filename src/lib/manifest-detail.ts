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
/** Crunchyroll 的层级是 series → seasons → episodes；detail 本身不带分集，
 * 所以这里把三跳拼成客户端统一的 episodes 列表（movie 直接一条）。 */
export async function crunchyrollDetail(invoke: Invoke, id: string): Promise<Record<string, unknown>> {
  const input = { id }
  const head = await invoke('crunchyroll', 'detail', input)
  const type = String(head.type || '')
  if (type !== 'series') {
    return { ...head, id, type: 'movie', episodes: [{ id, vid: id, title: String(head.title || ''), number: 1 }] }
  }
  const seasons = await invoke('crunchyroll', 'seasons', input)
  const rows = Array.isArray(seasons.items) ? seasons.items.filter(isObj) : []
  const episodes: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const season of rows) {
    const seasonId = String(season.id || '')
    if (!seasonId) continue
    const seasonNumber = Number(season.season_number) || rows.indexOf(season) + 1
    const list = await invoke('crunchyroll', 'episodes', { id: seasonId })
    for (const ep of Array.isArray(list.items) ? list.items.filter(isObj) : []) {
      const vid = String(ep.id || '')
      if (!vid || seen.has(vid)) continue
      seen.add(vid)
      episodes.push({
        id: vid,
        vid,
        title: String(ep.title || ''),
        number: Number(ep.episode_number) || episodes.length + 1,
        season: Number(ep.season_number) || seasonNumber,
        duration: Number(ep.duration) > 0 ? Math.round(Number(ep.duration)) : undefined,
      })
    }
  }
  return { ...head, id, type: 'series', episodes }
}

export async function manifestDetail(invoke: Invoke, provider: string, id: string): Promise<Record<string, unknown>> {
  const input = id.startsWith('https://') ? { url: id } : { id }
  if (provider === 'crunchyroll') return crunchyrollDetail(invoke, id)
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
