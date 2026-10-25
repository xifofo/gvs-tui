/**
 * 换 115 源账号后，订阅自动下载沿用这部作品最近一次的发布信息。只在原账号已从发布端移除或停用时启用；
 * 原账号仍可用时不静默改投其他账号，仍要求在订阅里重新选择。
 */
import type { DlTask } from '../../lib/jobs.ts'
import type { OutputNaming } from '../../lib/output-naming'
import type { PublicationTmdb } from './publication-preferences.ts'
import type { PublicationDraft } from './publication-types.ts'
import { publisherSources } from './sources.ts'
import type { PlutoFishView, PublisherDirectoryPage, PublisherSource } from './types.ts'

export type CarryRecord = {
  createdAt: number
  draft?: PublicationDraft
  task: Pick<DlTask, 'provider' | 'sourceWorkId' | 'tmdbId' | 'series' | 'title' | 'year' | 'plot' | 'kind' | 'season' | 'outputNaming'>
}

export type CarryPlan = {
  /** 接手的新账号：发布端当前的默认源账号 */
  source: PublisherSource
  category: string
  tmdb: PublicationTmdb | null
  tmdbSeason?: number
  naming?: OutputNaming
  /** 同一网盘账号只是别名变了时原目录 ID 继续有效；换了账号时按原路径在新账号里逐层确保 */
  directory: { id: string; path: string } | { segments: string[] }
}

/** 按同一服务器、发布端和平台作品最近一次任务的发布草稿，决定能否沿用到发布端当前的源账号。 */
export function carryOverPlan(view: PlutoFishView, work: { provider: string; sourceWorkId: string }, records: CarryRecord[]): CarryPlan | null {
  const identity = view.identity
  if (view.status !== 'verified' || !identity) return null
  const sources = publisherSources(identity)
  const current = sources.find(s => s.id === identity.sourceAccount.id && s.enabled !== false)
  if (!current || (current.provider ?? '115') !== '115') return null
  const last = [...records].sort((a, b) => b.createdAt - a.createdAt).find(r => r.draft?.binding.sourceAccount
    && r.task.provider === work.provider && r.task.sourceWorkId === work.sourceWorkId
    && r.draft.binding.url === view.url && r.draft.binding.publisherId === identity.id)
  const draft = last?.draft, old = draft?.binding.sourceAccount
  if (!last || !draft || !old) return null
  const sameAccount = old.id === current.id
  // 同一账号同一别名：本机只是没有偏好，不属于换账号
  if (sameAccount && old.alias === current.alias) return null
  if (!sameAccount && sources.some(s => s.id === old.id && s.enabled !== false)) return null
  const category = draft.workTarget.category
  if (!category || !identity.categories?.some(c => c.value === category)) return null
  const task = last.task, kind = task.kind === 'movie' ? 'movie' as const : 'show' as const
  const tmdb = task.tmdbId ? { id: task.tmdbId, kind, name: task.series || task.title, title: task.series || task.title, year: task.year, overview: task.plot ?? '' } : null
  return {
    source: current, category, tmdb,
    ...(tmdb && kind === 'show' ? { tmdbSeason: task.season } : {}),
    ...(task.outputNaming ? { naming: { ...task.outputNaming } } : {}),
    directory: sameAccount ? { id: draft.directoryId ?? '0', path: draft.directoryPath || '/' } : { segments: (draft.directoryPath ?? '').split('/').filter(Boolean) },
  }
}

/** 从根目录按原路径逐层确保目录存在：服务端按 mkdir -p 创建或复用同名目录，每次最多 4 层。 */
export async function ensureDirectoryPath(segments: string[], create: (parentId: string, names: string[]) => Promise<PublisherDirectoryPage>): Promise<{ id: string; path: string }> {
  let parent = '0', path = '/'
  for (let i = 0; i < segments.length; i += 4) {
    const page = await create(parent, segments.slice(i, i + 4))
    parent = page.path.at(-1)!.id
    path = '/' + page.path.slice(1).map(d => d.name).join('/')
  }
  return { id: parent, path }
}
