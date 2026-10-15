import type { JobView } from './api'
import { publicationMissing, publicationStage } from '../../../src/integrations/plutofish/publication-types'

export type TransferState = 'active' | 'pending' | 'paused' | 'failed' | 'done'

/** 下载完成后仍需上传；只有整个流程结束才计入已完成或自动折叠。 */
export function transferState(job: JobView): TransferState {
  if (job.state !== 'done') return job.state === 'running' || job.state === 'queued' ? 'active' : job.state
  const draft = job.publication
  if (!draft) return 'done'
  if (publicationMissing(draft).length) return 'pending'
  const stage = draft.progress?.stage
  if (stage === 'completed') return 'done'
  if (stage === 'failed') return 'failed'
  if (stage === 'paused' || stage === 'cancelled') return 'paused'
  return 'active'
}

export function transferLabel(job: JobView): string {
  if (job.state === 'done') return job.publication ? publicationStage(job.publication) : '完成'
  return job.state === 'queued' ? '排队中' : job.state === 'paused' ? '已暂停' : job.state === 'failed' ? '下载失败' : job.status
}

export function transferPercent(job: JobView): number {
  if (transferState(job) === 'done') return 100
  return job.state === 'done' ? Math.min(100, Math.max(0, job.publication?.progress?.uploadPercent ?? 0)) : job.pct * 100
}
