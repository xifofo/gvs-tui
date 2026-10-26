import type { Subtitle } from '../types.ts'

/** One muxed subtitle track as jobs.ts expects it; ids are gateway/probe indexes. */
export type SubtitleTrack = {
  id: string
  label: string
  lang: string
  forced: boolean
  sdh: boolean
  isDefault: boolean
}

/**
 * Selected subtitle rows → the task field jobs.ts hands to `resolve subtitle=…`
 * and, for Disney+, to the signed-URL downloader. Order is the picker order, so
 * two runs with the same selection send the same indexes.
 */
export function subtitleDownloadTracks(subs: readonly Subtitle[]): SubtitleTrack[] {
  return subs
    .filter(s => s.selected)
    .map(s => ({ id: s.id, label: s.label, lang: s.lang, forced: s.forced, sdh: s.sdh, isDefault: s.isDefault }))
}

/** Toggle one row by id (used by the space key); no-op when the id is absent. */
export function toggleSubtitle(subs: readonly Subtitle[], id: string): void {
  const row = subs.find(s => s.id === id)
  if (row) row.selected = !row.selected
}
