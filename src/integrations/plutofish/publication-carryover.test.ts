import { expect, test } from 'bun:test'
import { carryOverPlan, ensureDirectoryPath, type CarryRecord } from './publication-carryover.ts'
import type { PlutoFishView, PublisherDirectoryPage, PublisherSource } from './types.ts'

const oldSource: PublisherSource = { id: 'old', alias: 'old-115', name: '旧 115' }
const newSource: PublisherSource = { id: 'new', alias: 'new-115', name: '新 115' }
const view = (sourceAccount: PublisherSource, sourceAccounts?: PublisherSource[]): PlutoFishView => ({ url: 'https://pf.example', hasKey: true, status: 'verified', error: '', identity: {
  id: 'publisher', name: '发布端', kind: 'publisher', sourceAccount, ...(sourceAccounts ? { sourceAccounts } : {}), categories: [{ value: 'tv', label: '剧集' }],
} })
const record = (source: PublisherSource, patch: Partial<{ createdAt: number; category: string; path: string; url: string; provider: string }> = {}): CarryRecord => ({
  createdAt: patch.createdAt ?? 1,
  task: { provider: patch.provider ?? 'tencent', sourceWorkId: 'show-1', tmdbId: 286171, series: '尚公主', title: '第3集', year: 2026, plot: '简介', kind: 'show', season: 1, outputNaming: {} },
  draft: { schemaVersion: 1, binding: { url: patch.url ?? 'https://pf.example', publisherId: 'publisher', sourceAccount: { id: source.id, alias: source.alias } },
    releaseKey: 'gvs-r1:x', fileKey: 'gvs-f1:x', directoryId: '123', directoryPath: patch.path ?? '/剧集/尚公主 (2026) {tmdb-286171}/season 01',
    workTarget: { mediaType: 'tv', tmdbId: '286171', category: patch.category ?? 'tv' } } as CarryRecord['draft'],
})
const work = { provider: 'tencent', sourceWorkId: 'show-1' }

test('原 115 账号已从发布端移除：沿用分类、TMDB、季号，按原路径在新账号里建目录', () => {
  const plan = carryOverPlan(view(newSource), work, [record(oldSource, { createdAt: 1, path: '/旧路径' }), record(oldSource, { createdAt: 2 })])
  expect(plan).toEqual({ source: newSource, category: 'tv', tmdb: { id: 286171, kind: 'show', name: '尚公主', title: '尚公主', year: 2026, overview: '简介' }, tmdbSeason: 1, naming: {},
    directory: { segments: ['剧集', '尚公主 (2026) {tmdb-286171}', 'season 01'] } })
  // 停用也算不可用
  expect(carryOverPlan(view(newSource, [newSource, { ...oldSource, enabled: false }]), work, [record(oldSource)])?.source).toEqual(newSource)
})

test('同一账号只是别名变了：原目录 ID 继续用', () => {
  const plan = carryOverPlan(view({ ...oldSource, alias: 'renamed' }), work, [record(oldSource)])
  expect(plan?.directory).toEqual({ id: '123', path: '/剧集/尚公主 (2026) {tmdb-286171}/season 01' })
})

test('原账号仍可用、同账号同别名、其他服务器或作品、分类失效或没有记录时不沿用', () => {
  expect(carryOverPlan(view(newSource, [newSource, oldSource]), work, [record(oldSource)])).toBeNull()
  expect(carryOverPlan(view(oldSource), work, [record(oldSource)])).toBeNull()
  expect(carryOverPlan(view(newSource), work, [record(oldSource, { url: 'https://other.example' })])).toBeNull()
  expect(carryOverPlan(view(newSource), work, [record(oldSource, { provider: 'youku' })])).toBeNull()
  expect(carryOverPlan(view(newSource), work, [record(oldSource, { category: 'gone' })])).toBeNull()
  expect(carryOverPlan(view(newSource), work, [])).toBeNull()
  expect(carryOverPlan({ ...view(newSource), status: 'error' }, work, [record(oldSource)])).toBeNull()
})

test('目录按原路径逐层确保，每次最多 4 层并接着上一段继续；根目录不调用', async () => {
  const calls: Array<[string, string[]]> = []
  let id = 100
  const tree: Array<{ id: string; name: string }> = [{ id: '0', name: '根目录' }]
  const create = async (parent: string, names: string[]): Promise<PublisherDirectoryPage> => {
    calls.push([parent, names])
    for (const name of names) tree.push({ id: String(++id), name })
    return { sourceAccountId: 'new', path: [...tree], items: [], nextCursor: '' }
  }
  expect(await ensureDirectoryPath(['a', 'b', 'c', 'd', 'e', 'f'], create)).toEqual({ id: '106', path: '/a/b/c/d/e/f' })
  expect(calls).toEqual([['0', ['a', 'b', 'c', 'd']], ['104', ['e', 'f']]])
  expect(await ensureDirectoryPath([], create)).toEqual({ id: '0', path: '/' })
  expect(calls.length).toBe(2)
})
