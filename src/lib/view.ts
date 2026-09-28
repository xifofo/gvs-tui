// List windows and scene-neutral derivations that the scenes and the shell
// both need.
//
// A scene renders a window, but the status line reports the same
// `first-last / total` range, so both sides call the same function here — they
// can never disagree about what is on screen.

import type { DiscoveryView, Section } from './discovery.ts'
import type { Detail, Episode, Row, Snapshot, TMDBHit } from '../types.ts'

export type ListView<T> = {
  /** Items in the list, before windowing. */
  total: number
  /** 1-based index of the first visible row (0 when the list is empty). */
  first: number
  /** 1-based index of the last visible row (inclusive). */
  last: number
  /** Visible slice, with each item's index in the full list. */
  rows: Array<{ item: T; index: number }>
}

/** Window a long list around the cursor, reporting the visible range. */
export function sliceList<T>(items: T[] | undefined, cursor: number, room: number): ListView<T> {
  const all = items ?? []
  const total = all.length
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.floor(cursor))
    : 0
  const size = Math.max(1, Math.min(Math.max(1, room), total || 1))
  let start = Math.max(0, safeCursor - Math.floor(size / 2))
  if (start + size > total) start = Math.max(0, total - size)
  const view = all.slice(start, start + size)
  return {
    total,
    first: total ? start + 1 : 0,
    last: Math.min(total, start + size),
    rows: view.map((item, offset) => ({ item, index: start + offset })),
  }
}

/** Visible results rows. The heading line above them takes three cells. */
export function resultWindow(rows: Row[] | undefined, cursor: number, bodyH: number): ListView<Row> {
  return sliceList(rows, cursor, bodyH - 3)
}

/** Visible TMDB candidates: two rows per hit, so half the body each. */
export function tmdbWindow(hits: TMDBHit[] | undefined, cursor: number, bodyH: number): ListView<TMDBHit> {
  return sliceList(hits, cursor, Math.max(1, Math.floor(bodyH / 2)))
}

/** Visible quality or audio rows — both tables have the same chrome above. */
export function optionWindow<T>(items: T[] | undefined, index: number, bodyH: number): ListView<T> {
  return sliceList(items, index, bodyH - 6)
}

/**
 * Job log below the fixed title/status block, which owns the first two lines.
 * `offset` is the runtime's scroll position within the whole log.
 */
export function logWindow(lines: string[] | undefined, offset: number, bodyH: number) {
  const logs = (lines ?? []).slice(2)
  const room = Math.max(1, bodyH - 3)
  const start = Math.min(offset, Math.max(0, logs.length - room))
  return {
    total: logs.length,
    first: logs.length ? start + 1 : 0,
    last: Math.min(logs.length, start + room),
    lines: logs.slice(start, start + room),
  }
}

/** Sections of the workspace that belong to the current 推荐/榜单 mode. */
export function workspaceSections(ws: DiscoveryView | undefined): Section[] {
  return ws?.sections.filter((s) => s.mode === ws?.mode) ?? []
}

/** A movie detail is either typed as one or filed under 电影 by the platform. */
export function isMovieDetail(detail: Detail | undefined): boolean {
  return detail?.kind === 'movie' || /电影/.test(detail?.category ?? '')
}

export function selectedEpisodeCount(episodes: Episode[] | undefined): number {
  return (episodes ?? []).filter((ep) => ep.selected).length
}

/** The quality screen is driving the audio column instead of the quality list. */
export function audioTab(state: Snapshot): boolean {
  return state.optionTab === 'audio' && (state.audios?.length ?? 0) > 0
}
