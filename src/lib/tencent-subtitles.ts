import type { Subtitle } from '../types.ts'
import type { SubtitleTrack } from './subtitle-selection.ts'
import { chineseVariant, onlineSubtitles, orderSubtitles, type OnlineSubtitle } from './online-subtitles.ts'
export { tencentHardSubtitles } from './tencent-quality-selection.ts'

/** Probe rows contain selection metadata only; signed URLs are resolved for each episode. */
export function tencentSubtitleOptions(data: Record<string, unknown>): Subtitle[] {
  const rows = orderSubtitles(onlineSubtitles(data)).map(s => ({
    id: s.id, label: s.label, lang: s.lang, forced: false, sdh: false, selected: false, isDefault: false,
  }))
  const chinese = rows.filter(s => chineseVariant(s.lang, s.label, s.id))
  const preferred = chinese[0] ?? rows.find(s => /^en\b/i.test(s.lang))
  for (const s of chinese.length ? chinese : preferred ? [preferred] : []) s.selected = true
  if (preferred) preferred.isDefault = true
  return rows
}

const language = (s: { lang: string; label: string; id: string }) =>
  chineseVariant(s.lang, s.label, s.id) || s.lang.trim().toLowerCase().replace(/_/g, '-')

/** A batch may use different subtitle IDs per episode. Rebind only an unambiguous matching language. */
export function resolveTencentSubtitles(
  data: Record<string, unknown>, selected: readonly SubtitleTrack[] | undefined,
): Array<{ sub: OnlineSubtitle; isDefault: boolean }> {
  if (!selected?.length) return [] // Includes old tasks without an explicit subtitle selection.
  const all = onlineSubtitles(data)
  const used = new Set<string>()
  const mapped = selected.map(track => {
    const lang = language(track)
    const candidates = all.filter(s => !used.has(s.id) && lang && language(s) === lang)
    const exact = candidates.find(s => s.id === track.id)
    const sub = exact ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (!sub) throw new Error(`本集缺少或无法确认所选字幕：${track.label || track.lang || track.id}`)
    used.add(sub.id)
    return { sub, isDefault: track.isDefault }
  })
  const ordered = orderSubtitles(mapped.map(s => s.sub)).map(sub => mapped.find(s => s.sub === sub)!)
  const preferred = ordered.find(s => s.isDefault) ?? ordered[0]!
  return ordered.map(s => ({ sub: s.sub, isDefault: s === preferred }))
}
