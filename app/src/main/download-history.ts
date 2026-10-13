import type { JobView } from '@shared/api'
import { showIdOfGroup, type HistoryDB, type HistoryInput } from './history-db'

/** 任务里历史需要的字段（DlTask 的子集） */
export type TaskLike = { vid?: string; title?: string; season?: number; episode?: number; kind?: string; audioTracks?: Array<{ label?: string }> }

export function historyKey(view: Pick<JobView, 'provider' | 'groupId' | 'label'>, task: TaskLike): string {
  return `${view.provider}:${showIdOfGroup(view.groupId)}:${task.vid || view.label}`
}

export function historyFromJob(view: JobView, task: TaskLike, size: number): HistoryInput {
  const movie = task.kind === 'movie'
  return {
    jobKey: historyKey(view, task),
    provider: view.provider,
    showId: showIdOfGroup(view.groupId),
    showTitle: view.groupTitle,
    vid: task.vid ?? '',
    season: movie ? 0 : Number(task.season ?? 0),
    episode: movie ? 0 : Number(task.episode ?? 0),
    label: view.label,
    title: task.title ?? '',
    quality: view.quality,
    audio: (task.audioTracks ?? []).map((a) => a.label ?? '').filter(Boolean).join(' / '),
    size,
    filePath: view.output,
    completedAt: view.finishedAt || Date.now(),
  }
}

/** 首次启用时把已完成的任务导入历史（只跑一次） */
export function migrateJobs(db: HistoryDB, jobs: Array<{ view: JobView; task: TaskLike }>, sizeOf: (path: string) => number): number {
  if (db.meta('jobs_migrated') === '1') return 0
  let n = 0
  for (const j of jobs) {
    if (j.view.state !== 'done' || !j.view.output) continue
    if (db.byJobKey(historyKey(j.view, j.task))) continue
    db.record(historyFromJob(j.view, j.task, sizeOf(j.view.output)))
    n++
  }
  db.setMeta('jobs_migrated', '1')
  return n
}
