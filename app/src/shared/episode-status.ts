/**
 * 剧集页每集的下载状态：按平台视频 ID 合并任务与历史。
 * 季集号是输出编号，可能被 TMDB 改写，也可能在不同栏目里重复。
 */
export type EpisodeState = 'done' | 'running' | 'queued' | 'paused' | 'failed'
export type JobLike = { groupId: string; vid?: string; label: string; state: EpisodeState }
export type HistoryLike = { provider: string; showId: string; vid?: string; label: string }
export type EpisodeKey = { vid?: string; number: number; season?: number; title?: string }
export type EpisodeStates = { byVid: Map<string, EpisodeState>; legacyLabels: Map<string, EpisodeState> }

/** 多个任务指向同一集时，取最有意义的那个状态 */
const RANK: Record<EpisodeState, number> = { done: 5, running: 4, queued: 3, paused: 2, failed: 1 }

export const episodeKey = (number: number, season = 1) => `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`

export function episodeStates(jobs: readonly JobLike[], provider: string, showId: string, history: readonly HistoryLike[] = []): EpisodeStates {
  const group = `${provider}:${showId}`
  const out: EpisodeStates = { byVid: new Map(), legacyLabels: new Map() }
  const add = (vid: string | undefined, label: string, state: EpisodeState) => {
    const index = vid ? out.byVid : out.legacyLabels
    const key = vid || label
    const prev = index.get(key)
    if (!prev || RANK[state] > RANK[prev]) index.set(key, state)
  }
  for (const j of jobs) {
    if (j.groupId.slice(0, j.groupId.lastIndexOf(':')) !== group) continue
    add(j.vid, j.label, j.state)
  }
  for (const row of history) {
    if (row.provider !== provider || row.showId !== showId) continue
    add(row.vid, row.label, 'done')
  }
  return out
}

export function stateOf(states: EpisodeStates, ep: EpisodeKey, movie = false): EpisodeState | undefined {
  // 有视频 ID 就只匹配 ID，不再用其它栏目/季的输出编号兜底。
  if (ep.vid) return states.byVid.get(ep.vid)
  // 仅兼容两边都没有 ID 的旧数据，并且必须是相同季集号 / 电影版本名。
  return states.legacyLabels.get(movie ? ep.title || '正片' : episodeKey(ep.number, ep.season ?? 1))
}

export const STATE_LABEL: Record<EpisodeState, string> = { done: '已下载', running: '下载中', queued: '排队中', paused: '已暂停', failed: '失败' }
