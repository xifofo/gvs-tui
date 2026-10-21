/** 多账号离线回归：权限集合、默认值、稳定任务身份和跨重启作品偏好。 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlutoFishConnection } from './connection.ts'
import { verifyPublisher } from './client.ts'
import { preparePublication } from './publication.ts'
import { PublicationPreferenceStore } from './publication-preferences'
import type { DlTask } from '../../lib/jobs.ts'
import type { PlutoFishView, PublisherIdentity } from './types.ts'

const a = { id: 'source-a', name: '账号 A', alias: 'account-a', provider: '115', enabled: true }
const b = { id: 'source-b', name: '账号 B', alias: 'account-b', provider: '115', enabled: true }
const identity: PublisherIdentity = { id: 'publisher', name: '发布端', kind: 'publisher', sourceAccount: a, sourceAccounts: [a, b], categories: [{ value: 'tv', label: '电视剧' }] }
const view: PlutoFishView = { url: 'https://example.invalid', status: 'verified', hasKey: true, error: '', identity }
const task: DlTask = { provider: 'youku', sourceWorkId: 'show-1', title: '第一集', series: '作品', vid: 'ep1', season: 1, episode: 1, height: 1080, quality: '1080p', codec: 'hevc', group: 'GVS', tmdbId: 123, nameDots: 'test', year: 2026, plot: '', kind: 'show' }
const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

test('非默认账号生成独立任务，默认改变不影响固定目标，未授权账号拒绝', () => {
  const draft = preparePublication(task, view, 'tv', '42', '/剧集', undefined, b.id)
  expect(draft.binding.sourceAccount).toEqual({ id: b.id, alias: b.alias })
  expect(draft.fileKey).not.toBe(preparePublication(task, view, 'tv', '42').fileKey)
  expect(preparePublication(task, { ...view, identity: { ...identity, sourceAccount: b } }, 'tv', '42', '/剧集', undefined, b.id).fileKey).toBe(draft.fileKey)
  expect(() => preparePublication(task, view, 'tv', '42', '', undefined, 'outside')).toThrow('不可用')
})

test('作品记住非默认账号和各账号目录，重启恢复，撤销后不能回落到默认账号', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-multi-source-')); directories.push(dir)
  const path = join(dir, 'prefs.json'), store = new PublicationPreferenceStore(path)
  const context = { provider: 'youku', sourceWorkId: 'show-1', kind: 'show' as const }
  store.save(view, context, { category: 'tv', sourceAccountId: a.id, directoryId: '11', directoryPath: '/A' })
  store.save(view, context, { category: 'tv', sourceAccountId: b.id, directoryId: '22', directoryPath: '/B' })
  const restored = new PublicationPreferenceStore(path)
  expect(restored.get(view, context)?.publication).toEqual({ category: 'tv', sourceAccountId: b.id, directoryId: '22', directoryPath: '/B' })
  expect(restored.get(view, { ...context, sourceAccountId: a.id })?.publication.directoryId).toBe('11')
  expect(() => restored.get({ ...view, identity: { ...identity, sourceAccounts: [a] } }, context)).toThrow('不可用')
  expect(restored.get({ ...view, identity: { ...identity, id: 'another-publisher' } }, context)).toBeNull()
})

test('已有任务按授权集合验证，默认改变可续传，撤销目标立即拒绝', async () => {
  let current = identity
  const connection = new PlutoFishConnection({ load: () => ({ url: view.url, key: 'test-key' }), verify: async () => current })
  try {
    await connection.verify()
    const binding = { url: view.url, publisherId: identity.id, sourceAccount: { id: b.id, alias: b.alias } }
    expect(() => connection.assertBinding(binding)).not.toThrow()
    current = { ...identity, sourceAccount: b }
    await connection.verify(undefined, true)
    expect(() => connection.assertBinding(binding)).not.toThrow()
    current = { ...identity, sourceAccounts: [a] }
    await connection.verify(undefined, true)
    expect(() => connection.assertBinding(binding)).toThrow('绑定不一致')
  } finally { connection.close() }
})

test('身份响应保留平台列表，重复账号和列表外默认账号拒绝', async () => {
  const input = { url: view.url, key: 'test-key' }
  expect((await verifyPublisher(input, undefined, async () => Response.json(identity))).sourceAccounts).toEqual([a, b])
  for (const sourceAccounts of [[b], [a, a], [], [{ ...a, enabled: false }]]) {
    await expect(verifyPublisher(input, undefined, async () => Response.json({ ...identity, sourceAccounts }))).rejects.toThrow()
  }
})

test('单个账号收到撤权响应时不锁死其他账号的连接', async () => {
  const connection = new PlutoFishConnection({ load: () => ({ url: view.url, key: 'test-key' }), verify: async () => identity })
  const previousFetch = globalThis.fetch
  try {
    await connection.verify()
    globalThis.fetch = Object.assign(
      async () => Response.json({ error: { code: 'PUBLISHER_SOURCE_FORBIDDEN' } }, { status: 403 }),
      { preconnect: previousFetch.preconnect },
    )
    await expect(connection.request({ url: view.url, publisherId: identity.id, sourceAccount: b }, 'directories', {})).rejects.toThrow('撤销授权')
    expect(connection.ready).toBe(true)
    expect(() => connection.assertBinding({ url: view.url, publisherId: identity.id, sourceAccount: a })).not.toThrow()
  } finally { globalThis.fetch = previousFetch; connection.close() }
})
