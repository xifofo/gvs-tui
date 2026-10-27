import { expect, test } from 'bun:test'
import { matchRelease, preferRelease, releaseChoices, resolveReleaseSelection, type ReleaseOption } from './release-selection.ts'
import { preparePublication } from './publication.ts'
import type { PlutoFishView } from './types.ts'
import type { DlTask } from '../../lib/jobs.ts'
import { matchingReleases } from './release-specs'

const firstId = 'a'.repeat(32), secondId = 'b'.repeat(32)
const option = (patch: Partial<ReleaseOption> = {}): ReleaseOption => ({ id: firstId, name: 'S01.360p.YK.WEB-DL.H265', resolution: '360p', dynamicRange: 'SDR', status: 'published', ...patch })
const preview = 'S01.360p.YOUKU.WEB-DL.SDR.HEVC.AAC.2.0'
const connection: PlutoFishView = { url: 'https://example.invalid', hasKey: true, status: 'verified', error: '', identity: {
  id: 'publisher', name: '发布端', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: '源账号' }, categories: [{ value: 'anime', label: '动漫' }],
} }
const task = (episode: number): DlTask => ({ provider: 'youku', sourceWorkId: 'show', title: `第${episode}集`, series: '测试', vid: `ep${episode}`, season: 1, episode,
  height: 360, quality: '360p', codec: 'hevc', group: 'GVS', tmdbId: 123, nameDots: '', year: 2026, plot: '', kind: 'show' })
const draft = (episode: number) => preparePublication(task(episode), connection, 'anime')
const client = (items: ReleaseOption[], boundReleaseId?: string) => ({ request: async <T>() => ({ items, total: items.length, page: 1, pageSize: 100, boundReleaseId }) as T })

test('统一旧别名、缺失音轨信息，唯一匹配才默认选择；绑定优先于重复规格', () => {
  expect(matchRelease([option()], preview)).toEqual({ matchedId: firstId, match: 'specs' })
  const duplicates = [option(), option({ id: secondId, name: preview })]
  expect(matchRelease(duplicates, preview)).toEqual({})
  expect(matchRelease(duplicates, preview, firstId)).toEqual({ matchedId: firstId, match: 'binding' })
  for (const name of ['S01.1080p.YOUKU.WEB-DL.HEVC', 'S01.360p.TX.WEB-DL.HEVC', 'S01.360p.YOUKU.WEB-DL.AVC', 'S01.360p.YOUKU.WEB-DL.HEVC.DDP.5.1', 'S01.360p.YOUKU.WEB-DL.HEVC.AAC.5.1', 'S01.360p.YOUKU.WEB-DL.60fps.HEVC']) {
    expect(matchRelease([option({ name })], preview)).toEqual({})
  }
  expect(matchRelease([option({ dynamicRange: 'HDR10' })], preview)).toEqual({})
  expect(matchRelease([option({ status: 'unpublished' })], preview)).toEqual({})
})

test('尚公主截图：预览缺少编码和声道时，按其余已知规格唯一匹配 WF', async () => {
  const name = 'S01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.DDP-WF'
  const wf = option({ name: 'S01.2160p.TX.WEB-DL.MAXPLUS.HDR.60fps.DDP.5.1.H.265-WF', resolution: '2160p', dynamicRange: 'HDR10' })
  const items = [wf,
    { ...wf, id: secondId, name: 'S01.2160p.TX.WEB-DL.1.DDP5.HFR.VIVID.HDR.60fps.HEVC.DDP.5.1-PFWEB' },
    { ...wf, id: 'c'.repeat(32), name: 'S01.2160p.TX.WEB-DL.1.DDP5.HFR.SDR.60fps.HEVC.DDP.5.1-SalmonWeb', dynamicRange: 'SDR' },
  ]
  const choices = await releaseChoices(client(items), [draft(11)], name)
  expect([choices.matchedId, choices.match, choices.needsChoice]).toEqual([firstId, 'specs', false])
  expect(resolveReleaseSelection(choices)).toEqual({ existingReleaseId: firstId })
  // 成品／Watch 的默认规则仍要求明确视频编码，预览也不补造编码或声道。
  expect(matchingReleases(items, name)).toEqual([])
  expect(choices.name).toBe(name)

  const otherCodec = { ...wf, id: secondId, name: wf.name.replace('H.265', 'H.264') }
  expect(matchRelease([wf, otherCodec], name)).toEqual({})
  expect(matchRelease([wf, otherCodec], name.replace('DDP-WF', 'DDP.HEVC-WF'))).toEqual({ matchedId: firstId, match: 'specs' })
  for (const patch of [
    { name: wf.name.replace('MAXPLUS.', '') }, { name: wf.name.replace('-WF', '-PFWEB') },
    { name: wf.name.replace('.TX.', '.YOUKU.') }, { name: wf.name.replace('WEB-DL', 'WEBRip') },
    { name: wf.name.replace('60fps', '50fps') }, { name: wf.name.replace('DDP.5.1', 'AAC.2.0') },
    { name: wf.name.replace('H.265', '') }, { name: wf.name.replace('2160p', '1080p') },
    { dynamicRange: 'SDR' }, { resolution: '1080p' }, { status: 'unpublished' as const },
  ]) expect(matchRelease([option({ ...wf, ...patch })], name)).toEqual({})
  expect(matchRelease([wf], name.replace('DDP-WF', 'DDP.2.0-WF'))).toEqual({})
})

test('首集允许自动新建；续集和特别篇未匹配时必须明确选择，错误不降级为空列表', async () => {
  expect(resolveReleaseSelection(await releaseChoices(client([]), [draft(1), draft(2)], preview))).toEqual({})
  for (const episode of [0, 2, 100]) {
    const choices = await releaseChoices(client([]), [draft(episode)], preview)
    expect(choices.needsChoice).toBe(true)
    expect(() => resolveReleaseSelection(choices)).toThrow('后续集数')
    expect(resolveReleaseSelection(choices, { context: choices.context, mode: 'new' })).toEqual({ forceNew: true })
  }
  await expect(releaseChoices({ request: async () => { throw new Error('offline') } }, [draft(2)], preview)).rejects.toThrow('offline')
  await expect(releaseChoices(client([]), [draft(1), { ...draft(2), releaseKey: 'another-season' }], preview)).rejects.toThrow('分批')
})

test('条件变化或版本删除后拒绝旧选择；支持主动选择其他版本', async () => {
  const choices = await releaseChoices(client([option(), option({ id: secondId })]), [draft(2)], preview)
  expect(resolveReleaseSelection(choices, { context: choices.context, mode: 'existing', releaseId: secondId })).toEqual({ existingReleaseId: secondId })
  expect(() => resolveReleaseSelection(choices, { context: 'stale', mode: 'new' })).toThrow('已改变')
  expect(() => resolveReleaseSelection({ ...choices, items: [] }, { context: choices.context, mode: 'existing', releaseId: secondId })).toThrow('不可用')
})

test('强制新建按批次隔离；同批多集与重试稳定；显式绑定能保留原发布标识', () => {
  const release = { nonce: 'batch-one' }
  const first = preparePublication(task(1), connection, 'anime', '0', '/', release)
  const next = preparePublication(task(2), connection, 'anime', '0', '/', release)
  expect(next.releaseKey).toBe(first.releaseKey)
  expect(next.fileKey).not.toBe(first.fileKey)
  expect(preparePublication(task(1), connection, 'anime', '0', '/', release).fileKey).toBe(first.fileKey)
  expect(preparePublication(task(1), connection, 'anime', '0', '/', { nonce: 'batch-two' }).releaseKey).not.toBe(first.releaseKey)
  const selected = preparePublication(task(2), connection, 'anime', '0', '/', { existingReleaseId: firstId })
  expect(selected.existingReleaseId).toBe(firstId)
  expect(preparePublication(task(2), connection, 'anime', '0', '/', { existingReleaseId: firstId, preserveKey: true }).releaseKey).toBe(draft(2).releaseKey)
})

test('匹配遍历完整分页，重复或截断的分页不产生默认选择', async () => {
  let calls = 0
  const reader = { request: async <T>(_binding: unknown, _path: unknown, body: unknown) => {
    calls++
    const page = (body as { page: number }).page
    const items = page === 1 ? Array.from({ length: 100 }, (_, i) => option({ id: i.toString(16).padStart(32, '0'), name: 'other' })) : [option()]
    return { items, total: 101, page, pageSize: 100 } as T
  } }
  expect((await releaseChoices(reader, [draft(3)], preview)).matchedId).toBe(firstId)
  expect(calls).toBe(2)
})

test('换源账号后发布标识变了：沿用订阅记住的版本，已下架或不在候选里时不沿用', async () => {
  const items = [option({ name: 'S01.2160p.TX.WEB-DL.HEVC', episodes: [1, 2, 3, 5] }), option({ id: secondId, name: 'S01.2160p.TX.WEB-DL.HEVC' })]
  const choices = await releaseChoices(client(items), [draft(6)], preview)
  expect([choices.matchedId, choices.needsChoice]).toEqual([undefined, true])
  const kept = preferRelease(choices, firstId)
  expect([kept.matchedId, kept.match, kept.needsChoice, kept.items[0]!.episodes]).toEqual([firstId, 'remembered', false, [1, 2, 3, 5]])
  expect(resolveReleaseSelection(kept)).toEqual({ existingReleaseId: firstId })
  expect(preferRelease(choices, 'c'.repeat(32)).needsChoice).toBe(true)
  expect(preferRelease({ ...choices, items: [option({ status: 'unpublished' })] }, firstId).matchedId).toBeUndefined()
  // 绑定或唯一规格匹配优先于记住的版本
  const bound = await releaseChoices(client(items, secondId), [draft(6)], preview)
  expect(preferRelease(bound, firstId).matchedId).toBe(secondId)
  await expect(releaseChoices(client([option({ episodes: [1, -1] })]), [draft(6)], preview)).rejects.toThrow('响应无效')
})

test('手动选版列出本作品 S00；普通季不默认匹配特别篇，切季后才允许绑定', async () => {
  const queried: Array<number | undefined> = []
  const reader = { request: async <T>(_binding: unknown, _path: unknown, body: unknown) => {
    const { seasonNumber } = body as { seasonNumber?: number }
    queried.push(seasonNumber)
    const items = seasonNumber === 0 ? [option({ id: secondId, name: preview.replace('S01', 'S00') })] : []
    return { items, total: items.length, page: 1, pageSize: 100, boundReleaseId: secondId } as T
  } }
  const choices = await releaseChoices(reader, [draft(3)], preview, true)
  expect(queried).toEqual([1, 0])
  expect(choices.items.map(item => [item.id, item.seasonNumber])).toEqual([[secondId, 0]])
  expect(choices.matchedId).toBeUndefined()
  expect(preferRelease(choices, secondId).matchedId).toBeUndefined()
  expect(() => resolveReleaseSelection(choices, { context: choices.context, mode: 'existing', releaseId: secondId })).toThrow('不可用')
  queried.length = 0
  const specialDraft = preparePublication({ ...task(3), season: 0 }, connection, 'anime')
  const special = await releaseChoices(reader, [specialDraft], preview.replace('S01', 'S00'), true)
  expect(queried).toEqual([0])
  expect(special.matchedId).toBe(secondId)
  expect(resolveReleaseSelection(special, { context: special.context, mode: 'existing', releaseId: secondId })).toEqual({ existingReleaseId: secondId })
  expect(special.context).not.toBe(choices.context)
  queried.length = 0
  expect((await releaseChoices(reader, [draft(3)], preview)).items).toEqual([])
  expect(queried).toEqual([1])
})
