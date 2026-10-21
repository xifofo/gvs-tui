import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PublicationPreferenceStore, type PublicationContext } from './publication-preferences'
import type { PlutoFishView } from './types'

const connection: PlutoFishView = { url: 'https://example.invalid', hasKey: true, status: 'verified', error: '', identity: {
  id: 'publisher', name: '发布端', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: '源账号' },
  categories: [{ value: 'tv', label: '电视剧' }],
} }
const context: PublicationContext = { provider: 'youku', sourceWorkId: 'show', kind: 'show',
  tmdb: { id: 296203, kind: 'show', name: '此处通往繁星', title: '此处通往繁星', year: 2026, overview: '' }, tmdbSeason: 0 }
const publication = { category: 'tv', directoryId: '9007199254740993', directoryPath: '/电视剧/此处通往繁星' }
const dirs: string[] = []
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'gvs-prefs-')); dirs.push(directory)
  const path = join(directory, 'prefs.json')
  return { path, store: new PublicationPreferenceStore(path) }
}
afterEach(() => { for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true }) })

test('按 TMDB 与平台保存分类、字符串目录和季号，重启后按平台作品恢复，集号不沿用', () => {
  const { store, path } = harness()
  store.save(connection, context, { ...publication, episodeNumbers: { ep1: 99 } } as typeof publication)
  const saved = new PublicationPreferenceStore(path).get(connection, { ...context, tmdb: null })!
  expect(saved).toEqual({ publication, tmdb: context.tmdb!, tmdbSeason: 0 })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(readFileSync(path, 'utf8')).not.toContain('episodeNumbers')
  saved.publication.directoryId = '99'
  expect(store.get(connection, context)!.publication.directoryId).toBe(publication.directoryId)
})

test('同平台同 TMDB 共用目录，其他平台、类型、TMDB 与绑定全部隔离', () => {
  const { store } = harness()
  store.save(connection, context, publication)
  expect(store.get(connection, { ...context, sourceWorkId: 'another-season' })).toEqual({ publication, tmdb: context.tmdb! })
  for (const input of [{ ...context, provider: 'tencent' }, { ...context, tmdb: { ...context.tmdb!, id: 42 } },
    { ...context, kind: 'movie' as const, tmdb: { ...context.tmdb!, kind: 'movie' as const } }, { ...context, tmdb: null, sourceWorkId: 'unknown' }]) {
    expect(store.get(connection, input)).toBeNull()
  }
  for (const other of [{ ...connection, url: 'https://other.invalid' }, { ...connection, identity: { ...connection.identity!, id: 'other' } },
    { ...connection, identity: { ...connection.identity!, sourceAccount: { ...connection.identity!.sourceAccount!, id: 'other' } } },
    { ...connection, identity: { ...connection.identity!, sourceAccount: { ...connection.identity!.sourceAccount!, alias: 'other' } } }]) {
    expect(store.get(other, context)).toBeNull()
  }
})

test('无 TMDB 时也记住目录，首次匹配可以沿用；改成另一 TMDB 不串作品', () => {
  const { store } = harness()
  store.save(connection, { ...context, tmdb: null }, publication)
  expect(store.get(connection, context)!.publication).toEqual(publication)
  store.save(connection, context, publication)
  expect(store.get(connection, { ...context, tmdb: { ...context.tmdb!, id: 42 } })).toBeNull()
  store.save(connection, { ...context, tmdb: { ...context.tmdb!, id: 42 } }, { category: 'tv', directoryId: '42', directoryPath: '/另一个作品' })
  expect(store.get(connection, { ...context, tmdb: null })!.publication.directoryId).toBe('42')
  expect(store.get(connection, context)!.publication.directoryId).toBe(publication.directoryId)
})

test('新设置覆盖旧设置，历史任务迁移不能覆盖用户后来选择的目录', () => {
  const { store, path } = harness()
  store.save(connection, context, publication, true)
  store.save(connection, context, { category: 'tv', directoryId: '42', directoryPath: '/新目录' })
  store.save(connection, context, publication, true)
  store.save(connection, { ...context, sourceWorkId: 'another-id' }, publication, true)
  const restored = new PublicationPreferenceStore(path)
  expect(restored.get(connection, { ...context, tmdb: null })!.publication.directoryId).toBe('42')
  expect(restored.get(connection, { ...context, sourceWorkId: 'another-id', tmdb: null })!.publication.directoryId).toBe('42')
})

test('停用分类清空，未验证或无绑定不返回旧偏好', () => {
  const { store } = harness()
  store.save(connection, context, publication)
  expect(store.get({ ...connection, identity: { ...connection.identity!, categories: [] } }, context)!.publication.category).toBe('')
  expect(store.get({ ...connection, status: 'error' }, context)).toBeNull()
  expect(store.get({ ...connection, identity: null }, context)).toBeNull()
})

test('非法输入和过期绑定拒绝保存，保留上次有效目录', () => {
  const { store, path } = harness()
  store.save(connection, context, publication)
  const original = readFileSync(path, 'utf8')
  for (const directoryId of ['-1', '01', '../1', 123, null]) {
    expect(() => store.save(connection, context, { ...publication, directoryId } as typeof publication)).toThrow('目录')
  }
  expect(() => store.save(connection, context, { ...publication, category: 'disabled' })).toThrow('分类')
  expect(() => store.save(connection, { ...context, tmdbSeason: -1 }, publication)).toThrow('季号')
  expect(() => store.save(connection, { ...context, binding: { url: connection.url, publisherId: 'other', sourceAccount: { id: 'source', alias: 'main' } } }, publication)).toThrow('已改变')
  expect(readFileSync(path, 'utf8')).toBe(original)
})

test('保存失败不更新内存，损坏文件不被静默覆盖', () => {
  const { store, path } = harness()
  store.save(connection, context, publication)
  rmSync(path); mkdirSync(path)
  expect(() => store.save(connection, context, { ...publication, directoryId: '9' })).toThrow('保存失败')
  expect(store.get(connection, context)!.publication).toEqual(publication)
  rmSync(path, { recursive: true }); writeFileSync(path, '{invalid')
  expect(() => new PublicationPreferenceStore(path).save(connection, context, publication)).toThrow('读取失败')
  expect(readFileSync(path, 'utf8')).toBe('{invalid')
})

test('manual title, year and season survive restart; another platform season only shares title and year', () => {
  const { store, path } = harness()
  const naming = { title: 'Custom English Name', year: 2024, season: 0 }
  store.save(connection, { ...context, naming }, publication)
  const restored = new PublicationPreferenceStore(path)
  expect(restored.get(connection, { ...context, tmdb: null })!.naming).toEqual(naming)
  expect(restored.get(connection, { ...context, sourceWorkId: 'another-season' })!.naming).toEqual({ title: naming.title, year: naming.year })
  restored.save(connection, context, { ...publication, directoryId: '42' })
  expect(restored.get(connection, context)!.naming).toEqual(naming)
  restored.save(connection, { ...context, naming: {} }, publication)
  expect(restored.get(connection, context)!.naming).toBeUndefined()
})

test('invalid manual years do not replace saved work preferences', () => {
  const { store, path } = harness()
  store.save(connection, { ...context, naming: { year: 2024 } }, publication)
  const before = readFileSync(path, 'utf8')
  expect(() => store.save(connection, { ...context, naming: { year: 24 } }, publication)).toThrow('年份')
  expect(readFileSync(path, 'utf8')).toBe(before)
})
