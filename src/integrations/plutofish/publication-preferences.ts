/** 作品偏好按账号隔离，并单独记住所选账号；撤销后不静默改投其他目标。 */
import { publicationSource } from './sources'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configPath } from '../../lib/config'
import { PROVIDER_IDS } from '../../lib/providers'
import type { PublicationDraft, PublicationInput } from './publication-types.ts'
import type { PlutoFishView } from './types.ts'
import { outputNaming, type OutputNaming } from '../../lib/output-naming'

export type PublicationTmdb = { id: number; kind: 'movie' | 'show'; name: string; title: string; year: number; overview: string }
export type PublicationContext = {
  provider: string; sourceWorkId: string; kind: 'movie' | 'show'; tmdb?: PublicationTmdb | null; tmdbSeason?: number
  binding?: PublicationDraft['binding']
  sourceAccountId?: string
  naming?: OutputNaming
}
export type PublicationPreferences = {
  publication: Pick<PublicationInput, 'category' | 'directoryId' | 'directoryPath' | 'directoryCreation' | 'sourceAccountId'>
  tmdb: PublicationTmdb | null
  tmdbSeason?: number
  naming?: OutputNaming
}
type Entry = PublicationPreferences & { sourceWorkId: string }
type File = { version: 1; entries: Record<string, Entry>; aliases: Record<string, string>; targets?: Record<string, { id: string; alias: string }> }
const hash = (values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex')
export const publicationPreferencesPath = () => join(dirname(configPath()), 'plutofish-publication-preferences.json')

/** One preference per bound account + work + provider; platform aliases let unattended subscriptions find its TMDB. */
export class PublicationPreferenceStore {
  private data?: File
  constructor(private readonly path = publicationPreferencesPath()) {}

  private load(): File {
    if (this.data) return this.data
    if (!existsSync(this.path)) return this.data = { version: 1, entries: {}, aliases: {} }
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'))
      if (value?.version !== 1 || !value.entries || !value.aliases || typeof value.entries !== 'object' || typeof value.aliases !== 'object' || Array.isArray(value.entries) || Array.isArray(value.aliases)) throw new Error()
      return this.data = value
    } catch { throw new Error('发布偏好读取失败，请检查本机配置文件') }
  }

  private keys(connection: PlutoFishView, context: PublicationContext): { entry: string; alias: string; target: string; source: { id: string; alias: string } } | null {
    const identity = connection.identity
    if (connection.status !== 'verified' || !identity) return null
    const target = hash([connection.url, identity.id, context.provider, context.kind, context.sourceWorkId])
    const savedTarget = identity.sourceAccounts ? this.load().targets?.[target] : undefined
    const source = publicationSource(connection, context.sourceAccountId ?? context.binding?.sourceAccount?.id ?? savedTarget?.id)
    if (!context.sourceAccountId && !context.binding?.sourceAccount && savedTarget && savedTarget.alias !== source.alias) throw new Error('作品上传账号已改变，请重新选择')
    if (context.binding && (context.binding.url !== connection.url || context.binding.publisherId !== identity.id
      || (context.binding.sourceAccount && (context.binding.sourceAccount.id !== source.id || context.binding.sourceAccount.alias !== source.alias)))) throw new Error('发布端或源账号已改变，请重新选择发布信息')
    if (!PROVIDER_IDS.includes(context.provider as typeof PROVIDER_IDS[number]) || !['movie', 'show'].includes(context.kind)
      || typeof context.sourceWorkId !== 'string' || !context.sourceWorkId || context.sourceWorkId.length > 2048 || /[\x00-\x1f\x7f]/.test(context.sourceWorkId)) throw new Error('作品标识无效')
    if (context.tmdb && (!Number.isInteger(context.tmdb.id) || context.tmdb.id < 1 || context.tmdb.id > 2147483647
      || context.tmdb.kind !== context.kind)) throw new Error('TMDB 作品标识无效')
    const namespace = [connection.url, identity.id, source.id, source.alias, context.provider, context.kind]
    return { target, source, alias: hash([...namespace, 'platform', context.sourceWorkId]),
      entry: hash([...namespace, context.tmdb ? 'tmdb' : 'platform', context.tmdb?.id ?? context.sourceWorkId]) }
  }

  get(connection: PlutoFishView, context: PublicationContext): PublicationPreferences | null {
    const keys = this.keys(connection, context)
    if (!keys) return null
    const data = this.load()
    const platformEntry = data.entries[keys.alias]
    const unlinked = !data.aliases[keys.alias] || data.aliases[keys.alias] === keys.alias
    const entry = context.tmdb ? data.entries[keys.entry] ?? (unlinked && !platformEntry?.tmdb ? platformEntry : undefined)
      : data.entries[data.aliases[keys.alias] || keys.entry]
    if (!entry) return null
    const publication = this.input(entry.publication)
    if (connection.identity?.sourceAccounts) publication.sourceAccountId = keys.source.id
    const naming = outputNaming(entry.naming)
    if (entry.sourceWorkId !== context.sourceWorkId) delete naming.season
    if (publication.category && !connection.identity?.categories?.some(c => c.value === publication.category)) publication.category = ''
    return { publication, tmdb: this.tmdb(entry.tmdb),
      ...(Object.keys(naming).length ? { naming } : {}),
      ...(entry.sourceWorkId === context.sourceWorkId && entry.tmdbSeason != null ? { tmdbSeason: entry.tmdbSeason } : {}) }
  }

  private input(input: PublicationPreferences['publication']): PublicationPreferences['publication'] {
    const { category, directoryId = '0', directoryPath = '/', sourceAccountId, directoryCreation } = input
    if (sourceAccountId !== undefined && (typeof sourceAccountId !== 'string' || !sourceAccountId || sourceAccountId.length > 256)) throw new Error('上传账号无效')
    if (typeof category !== 'string' || category.length > 256 || typeof directoryId !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(directoryId)
      || typeof directoryPath !== 'string' || directoryPath.length > 4096 || /[\x00-\x1f\x7f]/.test(directoryPath)) throw new Error('发布分类或上传目录无效')
    if (directoryCreation !== undefined && (!directoryCreation || typeof directoryCreation !== 'object' || Array.isArray(directoryCreation)
      || typeof directoryCreation.parentId !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(directoryCreation.parentId)
      || typeof directoryCreation.targetId !== 'string' || !/^[1-9][0-9]{0,39}$/.test(directoryCreation.targetId)
      || typeof directoryCreation.parentPath !== 'string' || directoryCreation.parentPath.length > 4096 || /[\x00-\x1f\x7f]/.test(directoryCreation.parentPath)
      || typeof directoryCreation.workKey !== 'string' || !directoryCreation.workKey || directoryCreation.workKey.length > 1024
      || (directoryCreation.workDirectoryId !== undefined && (typeof directoryCreation.workDirectoryId !== 'string' || !/^[1-9][0-9]{0,39}$/.test(directoryCreation.workDirectoryId)))
      || (directoryCreation.workDirectoryPath !== undefined && (typeof directoryCreation.workDirectoryPath !== 'string' || directoryCreation.workDirectoryPath.length > 4096 || /[\x00-\x1f\x7f]/.test(directoryCreation.workDirectoryPath))))) throw new Error('已创建目录记录无效')
    return { category, directoryId, directoryPath, ...(directoryCreation ? { directoryCreation: { ...directoryCreation } } : {}), ...(sourceAccountId === undefined ? {} : { sourceAccountId }) }
  }

  private tmdb(value: PublicationTmdb | null | undefined): PublicationTmdb | null {
    if (!value) return null
    if (!Number.isInteger(value.id) || value.id < 1 || value.id > 2147483647 || !['movie', 'show'].includes(value.kind)
      || ![value.name, value.title, value.overview].every(s => typeof s === 'string') || !Number.isInteger(value.year)) throw new Error('TMDB 作品资料无效')
    return { id: value.id, kind: value.kind, name: value.name, title: value.title, year: value.year, overview: value.overview }
  }

  save(connection: PlutoFishView, context: PublicationContext, input: PublicationPreferences['publication'], seed = false): void {
    const keys = this.keys(connection, { ...context, sourceAccountId: input.sourceAccountId ?? context.sourceAccountId })
    if (!keys) throw new Error('请先验证并绑定 PlutoFish 源账号')
    const publication = this.input(input)
    if (publication.category && !connection.identity?.categories?.some(c => c.value === publication.category)) throw new Error('所选发布分类已不可用，请重新选择')
    if (context.tmdbSeason != null && (!Number.isInteger(context.tmdbSeason) || context.tmdbSeason < 0 || context.tmdbSeason > 10000)) throw new Error('季号无效')
    let tmdbSeason = context.tmdbSeason
    // A successful manual creation knows the effective platform season even without an override.
    // Keep that exact season for subscription editing and later enqueue preference saves.
    const creation = publication.directoryCreation
    if (tmdbSeason === undefined && creation && creation.targetId === publication.directoryId) {
      try {
        const key = JSON.parse(creation.workKey)
        if (Array.isArray(key) && key[0] === 'show' && key[1] === context.tmdb?.id && context.kind === 'show'
          && Number.isInteger(key[2]) && key[2] >= 0 && key[2] <= 10000) tmdbSeason = key[2]
      } catch { /* Older local records without a structured key keep the explicit season only. */ }
    }
    const previous = this.load()
    const naming = outputNaming(context.naming ?? previous.entries[keys.entry]?.naming)
    if (seed && previous.entries[keys.entry] && previous.aliases[keys.alias]) return
    const entry: Entry = { sourceWorkId: context.sourceWorkId, publication, tmdb: this.tmdb(context.tmdb),
      ...(Object.keys(naming).length ? { naming } : {}),
      ...(tmdbSeason != null ? { tmdbSeason } : {}) }
    const next: File = { version: 1, entries: { ...previous.entries }, aliases: { ...previous.aliases }, targets: { ...previous.targets } }
    if (!seed && input.sourceAccountId) next.targets![keys.target] = { id: keys.source.id, alias: keys.source.alias }
    if (!seed || !next.entries[keys.entry]) next.entries[keys.entry] = entry
    if (!seed || !next.aliases[keys.alias]) next.aliases[keys.alias] = keys.entry
    const tmp = `${this.path}.${randomUUID()}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
      renameSync(tmp, this.path)
      this.data = next
    } catch { throw new Error('发布偏好保存失败，请检查本机目录权限') }
    finally { rmSync(tmp, { force: true }) }
  }
}
