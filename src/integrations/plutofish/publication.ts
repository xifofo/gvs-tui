/** 生成可跨重启和重试复用的发布身份，只使用任务属性，不使用时间或临时下载 URL。 */
import { publicationSource } from './sources.ts'
import { createHash } from 'node:crypto'
import type { DlTask } from '../../lib/jobs.ts'
import type { CompletedMedia } from '../../lib/actual-version.ts'
import type { PlutoFishView } from './types.ts'
import type { PublicationDraft } from './publication-types.ts'
import { sourceTag } from '../../lib/name.ts'

const key = (prefix: string, values: unknown[]) => `${prefix}:${createHash('sha256').update(JSON.stringify(values)).digest('hex')}`
const number = (value: number, field: string, max = 100000): number => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${field}须为 0–${max} 的整数`)
  return value
}

/** 入队时固定绑定和目录身份；同一作品、季、平台及所选版本的分批下载共享 releaseKey。 */
export function preparePublication(task: DlTask, connection: PlutoFishView, category = '', directoryId = '0', directoryPath = '', release?: { existingReleaseId?: string; nonce?: string; preserveKey?: boolean }, sourceAccountId?: string): PublicationDraft {
  const identity = connection.identity
  if (connection.status !== 'verified' || !identity) throw new Error('请先验证 PlutoFish 发布端')
  const option = identity.categories?.find(c => c.value === category)
  if (category && !option) throw new Error('所选发布分类已不可用，请重新选择')
  const movie = task.kind === 'movie'
  const tmdbId = number(task.tmdbId, 'TMDB ID', 2147483647)
  const season = movie ? undefined : number(task.season, '季号', 10000)
  const episode = movie ? undefined : number(task.episode, '集号')
  const source = publicationSource(connection, sourceAccountId)
  const binding = { url: connection.url, publisherId: identity.id, sourceAccount: { id: source.id, alias: source.alias } }
  if (!/^(0|[1-9][0-9]{0,39})$/.test(directoryId)) throw new Error('上传目录 ID 无效')
  if (typeof directoryPath !== 'string' || directoryPath.length > 4096 || /[\x00-\x1f\x7f]/.test(directoryPath)) throw new Error('上传目录路径无效')
  const workTarget: PublicationDraft['workTarget'] = { mediaType: movie ? 'movie' as const : 'tv' as const, tmdbId: tmdbId ? String(tmdbId) : '', category }
  if (!tmdbId) {
    delete workTarget.tmdbId
    workTarget.sourceProvider = task.provider
    const source = task.sourceWorkId ?? ''
    workTarget.sourceWorkId = source && (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source) ? source : key('source', [source]))
    workTarget.title = task.series || task.title
    workTarget.posterUrl = task.posterUrl || ''
    workTarget.overview = task.plot || ''
  }
  const workIdentity = tmdbId ? workTarget : { mediaType: workTarget.mediaType, sourceProvider: workTarget.sourceProvider, sourceWorkId: workTarget.sourceWorkId, category }
  // 音轨 ID/VID 往往随剧集改变，用语言、编码及默认音轨区分版本；不把名称或临时地址写入身份。
  const audio = (task.audioTracks ?? []).map(a => [a.lang, a.codec ?? '', !!a.isDefault]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const quality = task.provider === 'iqcn' ? task.quality.split('|').slice(0, 3).join('|') : task.quality
  const rendition = task.provider === 'tencent' ? [task.tencentQuality?.formatId, task.tencentQuality?.persona, task.tencentQuality?.group, task.tencentQuality?.hdr, task.tencentQuality?.fps]
    : task.provider === 'iqcn' ? [task.iqcnQuality?.codecCode, task.iqcnQuality?.dynamicRangeCode] : []
  const versionIdentity: unknown[] = [binding, workIdentity, '', season ?? null,
    task.provider, quality, rendition, task.caption ?? '', task.codec, task.group, movie ? task.edition ?? '' : '', audio]
  // 默认根目录沿用旧标识；显式改目录不能复用已绑定其他目标的上传任务。
  if (directoryId !== '0') versionIdentity.push({ directoryId })
  if (release?.existingReleaseId && !/^[a-f0-9]{32}$/.test(release.existingReleaseId)) throw new Error('所选版本标识无效')
  if (release?.existingReleaseId && release.nonce) throw new Error('已有版本与新版本不能同时选择')
  if (release?.existingReleaseId && !release.preserveKey) versionIdentity.push({ existingReleaseId: release.existingReleaseId })
  if (release?.nonce) versionIdentity.push({ newRelease: release.nonce })
  const releaseKey = key('gvs-r1', versionIdentity)
  return {
    schemaVersion: 1, binding, releaseKey, ...(release?.existingReleaseId ? { existingReleaseId: release.existingReleaseId } : {}), fileKey: key('gvs-f1', [releaseKey, task.provider, task.vid, 'video']),
    directoryId, directoryPath, workTarget, categoryLabel: option?.label ?? '', naming: { source: sourceTag(task.provider), group: task.group }, title: task.series || task.title, kind: 'video',
    ...(movie ? {} : { seasonNumber: season, episodeNumber: episode, episodeTitle: task.title }),
    output: '', updatedAt: new Date().toISOString(),
  }
}

/** 只接收成品探测结果，绝不把申请画质当作实际规格。 */
export function completePublication(draft: PublicationDraft, output: string, measured?: CompletedMedia): PublicationDraft {
  return { ...draft, output, measured: measured ? structuredClone(measured) : undefined, updatedAt: new Date().toISOString() }
}
