/**
 * 剧集页每集的下载状态：从下载任务列表推出来（任务 groupId = `provider:showId:ts`，
 * label = `SxxEyy` 或电影版本名）。纯函数，界面和测试共用。
 */
export type EpisodeState = 'done' | 'running' | 'queued' | 'paused' | 'failed'
export type JobLike = { groupId: string; label: string; state: EpisodeState }
export type EpisodeKey = { number: number; season?: number; title?: string }

/** 多个任务指向同一集时，取最有意义的那个状态 */
const RANK: Record<EpisodeState, number> = { done: 5, running: 4, queued: 3, paused: 2, failed: 1 }

export const episodeKey = (number: number, season = 1) => `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`

export function episodeStates(jobs: readonly JobLike[], provider: string, showId: string): Map<string, EpisodeState> {
  const prefix = `${provider}:${showId}:`
  const out = new Map<string, EpisodeState>()
  for (const j of jobs) {
    if (!j.groupId.startsWith(prefix)) continue
    const prev = out.get(j.label)
    if (!prev || RANK[j.state] > RANK[prev]) out.set(j.label, j.state)
  }
  return out
}

export function stateOf(states: Map<string, EpisodeState>, ep: EpisodeKey, movie = false): EpisodeState | undefined {
  if (movie) return states.get(ep.title || '正片')
  const exact = states.get(episodeKey(ep.number, ep.season ?? 1))
  if (exact) return exact
  // 季号可能被标题推断 / TMDB 改写（S02E05），这时只按集号对齐
  let best: EpisodeState | undefined
  for (const [label, st] of states) {
    const m = /^S\d+E0*(\d+)$/.exec(label)
    if (m && Number(m[1]) === ep.number && (!best || RANK[st] > RANK[best])) best = st
  }
  return best
}

export const STATE_LABEL: Record<EpisodeState, string> = { done: '已下载', running: '下载中', queued: '排队中', paused: '已暂停', failed: '失败' }
