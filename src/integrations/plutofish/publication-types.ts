/** 本地发布草稿；尚未上传或上报，不包含任何密钥和播放地址。 */
import type { CompletedMedia } from '../../lib/actual-version.ts'

export type PublicationInput = {
  category: string
  directoryId?: string
  directoryPath?: string
  /** 用户明确修正的集号，按平台视频 ID 关联，允许特别篇 0。 */
  episodeNumbers?: Record<string, number>
}

export type PublicationDraft = {
  schemaVersion: 1
  binding: { url: string; publisherId: string; sourceAccount: { id: string; alias: string } | null }
  releaseKey: string
  fileKey: string
  workTarget: { mediaType: 'movie' | 'tv'; tmdbId?: string; category: string; sourceProvider?: string; sourceWorkId?: string; title?: string; posterUrl?: string; overview?: string }
  directoryId?: string
  /** 选择时的展示路径；上传始终使用固定目录 ID。 */
  directoryPath?: string
  progress?: { stage: string; phase?: 'hashing' | 'uploading' | 'verifying' | 'reporting'; downloadPercent: number; uploadPercent: number; uploadedBytes: number; sizeBytes?: number; error: string; synced: boolean }
  categoryLabel: string
  title: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
  kind: 'video'
  output: string
  measured?: CompletedMedia
  updatedAt: string
}

export function publicationMissing(draft: PublicationDraft): string[] {
  return [!draft.binding.sourceAccount && '绑定源账号', !draft.workTarget.tmdbId && !draft.workTarget.sourceWorkId && '平台作品 ID', !draft.workTarget.category && '资源分类'].filter(Boolean) as string[]
}

export function publicationStage(draft: PublicationDraft): string {
  const missing = publicationMissing(draft)
  if (missing.length) return `待补全${missing.join('、')}`
  const p = draft.progress
  if (!p) return draft.output ? '等待上传' : '等待下载'
  if (p.stage === 'processing' && draft.output) return p.phase === 'hashing' ? '计算文件校验' : '等待上传'
  if (p.stage === 'uploading') return ({ hashing: '计算文件校验', uploading: '上传中', verifying: '核验网盘文件', reporting: '登记资源' })[p.phase ?? 'uploading']
  return ({ queued: '等待下载', downloading: '下载中', processing: '成品处理中', paused: '上传已暂停', failed: '上传失败', cancelled: '上传已取消', completed: '上传完成' } as Record<string, string>)[p.stage] ?? p.stage
}

/** 准备状态与下载状态独立；prepared 只表示本地信息齐全。 */
export function publicationStatus(draft?: PublicationDraft): string {
  if (!draft) return '未登记发布信息'
  const missing = publicationMissing(draft)
  if (missing.length) return `待补全：${missing.join('、')}`
  if (draft.progress) {
    const p = draft.progress
    const labels: Record<string, string> = { queued: '等待下载', downloading: '下载中', processing: '成品处理中', hashing: '计算文件校验', uploading: '上传中', paused: '发布已暂停', failed: '发布失败', cancelled: '发布已取消', completed: '已上报草稿目录' }
    return `${labels[p.stage] ?? p.stage}${p.stage === 'uploading' ? ` ${p.uploadPercent.toFixed(1)}%` : ''}${p.error ? ` · ${p.error}` : p.synced ? '' : ' · 等待同步'}`
  }
  if (!draft.output) return '待下载完成检测'
  const media = draft.measured?.media
  if (media?.status !== 'probed' || !media.width || !media.height || !media.codec || !draft.measured?.file.size) return '媒体规格待检查'
  return '发布信息已准备'
}
