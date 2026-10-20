import { episodeSeconds } from './episodes'
import { fetchMediaProbe } from './proxy'
import { runLog } from './runlog'
import { isObj } from './util'

type Obj = Record<string, unknown>
export type MgtvMetadataFetch = typeof fetchMediaProbe
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
const rows = (value: unknown): Obj[] => Array.isArray(value) ? value.filter(isObj) : []
const placeholder = (value: unknown): boolean => !text(value) || /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8}|\d+|第\s*\d+\s*[集期话])$/.test(text(value))

/** Mobile catalogs can put the broadcast date in title and omit every duration.
 * Supplement only existing VIDs from the public PC catalog; it is not a source
 * of episode order, numbering, access rights or download identities. */
export async function mgtvEpisodeMetadata(data: Obj, fetchCatalog: MgtvMetadataFetch = fetchMediaProbe): Promise<Obj[]> {
  const original = rows(data.episodes).map(row => ({ ...(isObj(row.meta) ? row.meta : {}), ...row }))
  const episodes: Obj[] = original.map(row => ({ ...row,
    title: placeholder(row.title) && !placeholder(row.subtitle) ? text(row.subtitle) : row.title,
  }))
  const wanted = new Set(original.filter(row => placeholder(row.title) || !episodeSeconds(row.duration))
    .map(row => text(row.vid || row.id)).filter(id => /^\d+$/.test(id)))
  const clipId = text(data.clipId) || text(data.id).replace(/^clip:/, '')
  const vid = text(data.vid) || text(original[0]?.vid || original[0]?.id)
  if (!wanted.size || !/^\d+$/.test(clipId) || !/^\d+$/.test(vid)) return episodes

  const metadata = new Map<string, Obj>(), ambiguous = new Set<string>()
  const signal = AbortSignal.timeout(8000)
  try {
    for (let page = 1; page <= 20; page++) {
      const url = new URL('https://pcweb.api.mgtv.com/episode/list')
      url.search = new URLSearchParams({ video_id: vid, page: String(page), size: '100' }).toString()
      const response = await fetchCatalog(url.href, {
        signal, headers: { Referer: 'https://www.mgtv.com/', 'User-Agent': 'Mozilla/5.0' },
      })
      if (!response.ok) throw new Error('catalog HTTP error')
      // Match the desktop manifest transport's 1 MiB bound in the TUI as well.
      if (!response.body) throw new Error('empty catalog')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.length
          if (size > 1024 * 1024) throw new Error('catalog too large')
          chunks.push(part.value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const envelope: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isObj(envelope) || envelope.code !== 200 || !isObj(envelope.data)) throw new Error('invalid catalog')
      const catalog = envelope.data
      if (Number(catalog.current_page) !== page) break
      for (const row of rows(catalog.list)) {
        const id = text(row.video_id)
        if (!wanted.has(id) || text(row.clip_id) !== clipId || (row.src_clip_id && text(row.src_clip_id) !== clipId)) continue
        if (metadata.has(id)) { ambiguous.add(id); continue }
        metadata.set(id, row)
      }
      if ([...wanted].every(id => metadata.has(id)) || page >= Number(catalog.total_page) || !rows(catalog.list).length) break
    }
  } catch {
    // Optional public metadata must not make an otherwise usable detail fail.
    runLog('mgtv_episode_metadata status=unavailable')
  }
  return episodes.map((row, index) => {
    const id = text(row.vid || row.id), extra = !ambiguous.has(id) ? metadata.get(id) : undefined
    if (!extra) return row
    const title = [extra.t3, extra.t2].map(text).find(value => !placeholder(value))
    const seconds = episodeSeconds(extra.time)
    return { ...row,
      ...(placeholder(original[index]?.title) && title ? { title } : {}),
      ...(!episodeSeconds(row.duration) && seconds > 0 ? { duration: seconds } : {}),
    }
  })
}
