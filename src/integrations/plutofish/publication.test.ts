import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DlTask } from '../../lib/jobs.ts'
import type { PlutoFishView } from './types.ts'
import { completePublication, preparePublication } from './publication.ts'
import { publicationStatus } from './publication-types.ts'
import { savePublication } from './publication-store.ts'

const connection: PlutoFishView = { url: 'https://example.invalid', hasKey: true, status: 'verified', error: '', identity: {
  id: 'publisher-1', name: '测试发布端', kind: 'publisher', sourceAccount: { id: 'source-1', alias: 'main', name: '源账号' },
  categories: [{ value: 'anime', label: '动漫' }],
} }
const task = (patch: Partial<DlTask> = {}): DlTask => ({ provider: 'youku', title: '第一集', series: '测试作品', vid: 'ep1', season: 1, episode: 1,
  height: 2160, quality: '4k', codec: 'hevc', group: 'GVS', tmdbId: 123, nameDots: 'test', year: 2026, plot: '', kind: 'show', ...patch })
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'gvs-publication-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('同版本分批多集共享版本身份，文件身份独立，重启和重试不改变身份', () => {
  const a = task({ audioTracks: [{ id: 'a1', vid: 'audio-ep1', lang: '国语', codec: 'aac', label: 'AAC', isDefault: true }] })
  const b = task({ vid: 'ep2', episode: 2, title: '第二集', audioTracks: [{ id: 'a2', vid: 'audio-ep2', lang: '国语', codec: 'aac', label: 'AAC', isDefault: true }] })
  const first = preparePublication(a, connection, 'anime')
  const second = preparePublication(b, connection, 'anime')
  expect(second.releaseKey).toBe(first.releaseKey)
  expect(second.fileKey).not.toBe(first.fileKey)
  expect(preparePublication(JSON.parse(JSON.stringify(a)), connection, 'anime').fileKey).toBe(first.fileKey)
  expect(preparePublication(task({ season: 2 }), connection, 'anime').releaseKey).not.toBe(first.releaseKey)
  expect(preparePublication(task({ quality: '1080p' }), connection, 'anime').releaseKey).not.toBe(first.releaseKey)
})

test('爱奇艺视频 ID 不分裂同版本，实际编码档位分开', () => {
  const first = preparePublication(task({ provider: 'iqcn', quality: '800|900|60|vid1', iqcnQuality: { sourceTvid: 'ep1', codecCode: 2, dynamicRangeCode: 1 } }), connection)
  const second = preparePublication(task({ provider: 'iqcn', quality: '800|900|60|vid2', iqcnQuality: { sourceTvid: 'ep2', codecCode: 2, dynamicRangeCode: 1 } }), connection)
  expect(second.releaseKey).toBe(first.releaseKey)
  expect(preparePublication(task({ provider: 'iqcn', quality: '800|900|60|vid2', iqcnQuality: { sourceTvid: 'ep2', codecCode: 3, dynamicRangeCode: 1 } }), connection).releaseKey).not.toBe(first.releaseKey)
})

test('电影不携带季集，特别篇允许 0，非法输入和停用分类不落盘', () => {
  const movie = preparePublication(task({ kind: 'movie', season: -1, episode: -1 }), connection, 'anime')
  expect(movie.seasonNumber).toBeUndefined()
  expect(movie.episodeNumber).toBeUndefined()
  expect(preparePublication(task({ season: 0, episode: 0 }), connection).episodeNumber).toBe(0)
  for (const invalid of [NaN, -1, 1.5, 100001]) expect(() => preparePublication(task({ episode: invalid }), connection)).toThrow('集号')
  expect(() => preparePublication(task(), connection, 'disabled')).toThrow('分类')
  expect(() => preparePublication(task(), { ...connection, status: 'error' })).toThrow('验证')
})

test('绑定按服务、发布端和源账号隔离，未配信息不会误报就绪', () => {
  const first = preparePublication(task(), connection, 'anime')
  const next = preparePublication(task(), { ...connection, identity: { ...connection.identity!, id: 'publisher-2' } }, 'anime')
  expect(first.fileKey).not.toBe(next.fileKey)
  expect(publicationStatus(preparePublication(task({ tmdbId: 0 }), connection))).toContain('平台作品 ID、资源分类')
  expect(() => preparePublication(task(), { ...connection, identity: null }, 'anime')).toThrow('请先验证 PlutoFish 发布端')
})

test('媒体规格只来自成品探测，原子清单重读保留身份和实测值', () => {
  const directory = temp()
  const draft = preparePublication(task(), connection, 'anime')
  expect(publicationStatus(draft)).toBe('待下载完成检测')
  expect(publicationStatus(completePublication(draft, '/tmp/movie.mkv'))).toBe('媒体规格待检查')
  const completed = completePublication(draft, '/tmp/movie.mkv', { media: { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' }, file: { size: 123456 } })
  savePublication(completed, directory)
  const path = join(directory, readdirSync(directory)[0]!)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.releaseKey).toBe(draft.releaseKey)
  expect(saved.measured.media.height).toBe(1080)
  expect(publicationStatus(saved)).toBe('发布信息已准备')
  savePublication(draft, directory)
  expect(JSON.parse(readFileSync(path, 'utf8')).measured.media.height).toBe(1080)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(readdirSync(directory)).toHaveLength(1)
  const blocked = join(directory, 'not-directory')
  writeFileSync(blocked, '')
  expect(() => savePublication(draft, blocked)).toThrow()
})
