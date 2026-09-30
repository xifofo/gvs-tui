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
export async function manifestDetail(invoke: Invoke, provider: string, id: string): Promise<Record<string, unknown>> {
  const input = id.startsWith('https://') ? { url: id } : { id }
  let result = normalizeManifestDetail(await invoke(provider, 'detail', input))
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
