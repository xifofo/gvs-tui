import { extractYoukuVideoId, parseTencentURL } from './link.ts'

export type CardTarget = { type: string; id?: string; query?: string; sectionId?: string; reason?: string }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
const str = (v: unknown) => typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
const id = (v: unknown) => { const s = str(v); return s && !['null', '<nil>', 'undefined'].includes(s) && !s.includes('://') && !s.startsWith('//') ? s : '' }

/** Media identities win over a legacy title-search fallback. Keep VID and show
 * identities distinct so opening an edition never resolves a different version. */
export function cardTarget(provider: string, item: Record<string, unknown>): CardTarget {
  const meta = obj(item.meta), target = obj(item.target || meta.target)
  const type = str(target.type), targetID = id(target.id)
  if (type === 'unavailable' || type === 'channel') return target as CardTarget
  const mediaProvider = provider === 'youku' || provider === 'tencent'
  if (type === 'video' && targetID) return { type: 'video', id: targetID }
  if (type === 'detail' && targetID) return { type: 'detail', id: targetID }
  const showID = [item.seriesId, item.showId, item.cid, meta.seriesId, meta.showId, meta.cid].map(id).find(Boolean)
  if (showID && (mediaProvider || type !== 'search')) return { type: 'detail', id: showID }
  const vid = [item.vid, item.videoId, meta.vid, meta.videoId].map(id).find(Boolean)
  if (mediaProvider && vid) return { type: 'video', id: vid }
  if (mediaProvider) {
    for (const value of [item.url, item.link, meta.url, meta.link, item.id]) {
      const url = str(value)
      if (!url.includes('://')) continue
      if (provider === 'tencent') {
        const parsed = parseTencentURL(url)
        if (parsed.cid) return { type: 'detail', id: parsed.cid }
        if (parsed.vid) return { type: 'video', id: parsed.vid }
      } else {
        const parsed = extractYoukuVideoId(url)
        if (parsed) return { type: 'video', id: parsed }
        try { const u = new URL(url); if (u.protocol === 'yunostv_yingshi:' && /detail/.test(u.hostname)) { const sid = id(u.searchParams.get('id')); if (sid) return { type: 'detail', id: sid } } } catch {}
      }
    }
  }
  const fallback = id(item.id) || id(meta.id)
  if (type === 'search') return { type, query: str(target.query) || str(item.title || meta.title) }
  if (type === 'video' && fallback) return { type, id: fallback }
  if (fallback || targetID) return { type: 'detail', id: targetID || fallback }
  return { type: 'search', query: str(target.query || item.title || item.name || meta.title) }
}
