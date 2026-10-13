import { expect, test } from 'bun:test'
import { Discovery, discoveryRows } from './discovery'
import { PROVIDER_IDS, PROVIDER_LABELS, supportsBrowse, supportsSearch, isManifestProvider } from './providers'
import { providerMeta } from '../../app/src/shared/provider-registry'

test('Apple TV has public browsing, Cookie login and manifest capability without keyword search', () => {
  expect(PROVIDER_IDS).toContain('appletvplus')
  expect(PROVIDER_LABELS.appletvplus).toBe('Apple TV')
  expect(supportsBrowse('appletvplus')).toBe(true)
  expect(supportsSearch('appletvplus')).toBe(false)
  expect(isManifestProvider('appletvplus')).toBe(true)
  expect(providerMeta('appletvplus').methods).toEqual(['cookie'])
  expect(providerMeta('appletvplus').loginOptional).toBe(true)
})

test('Apple TV discovery opens dynamic columns, continues the cursor and keeps browsing-only targets', async () => {
  const calls: Array<{ action: string; input: Record<string, unknown> }> = []
  const target = { type: 'unavailable', reason: '当前仅支持目录浏览' }
  const discovery = new Discovery(async (p, action, input) => {
    expect(p).toBe('appletvplus')
    calls.push({action, input})
    if (action === 'browse_catalog') return { sections: [{ id: 'apple-chart', title: '官方榜单', mode: 'rank', contentType: 'rank', available: true }] }
    return { contentType: 'rank', items: [{ id: input.cursor ? 'umc.cmc.b' : 'umc.cmc.a', title: '作品', rank: input.cursor ? 2 : 1, target }], hasMore: !input.cursor, nextCursor: input.cursor ? '' : 'apple-next' }
  }, () => {})
  await discovery.open('appletvplus', 'rank')
  expect(discovery.view.rows[0]?.rank).toBe(1)
  expect(discovery.view.rows[0]?.target).toEqual(target)
  await discovery.load(true, false)
  expect(calls.at(-1)?.input).toMatchObject({sectionId: 'apple-chart', cursor: 'apple-next'})
  expect(discovery.view.rows.map(r => r.rank)).toEqual([1, 2])
  expect(discovery.view.more).toBe(false)
  expect(discoveryRows('appletvplus', {contentType: 'recommendation', items: [{id:'a',title:'推荐',rank:1,target}]})[0]?.rank).toBeUndefined()
})

test('Apple TV on an old gateway stays unavailable without invented compatibility columns', async () => {
  const calls: string[] = []
  const discovery = new Discovery(async (_p, action) => {
    calls.push(action)
    throw new Error('PROVIDER_NOT_FOUND')
  }, () => {})
  await discovery.open('appletvplus')
  expect(calls).toEqual(['browse_catalog'])
  expect(discovery.visibleSections).toHaveLength(1)
  expect(discovery.visibleSections[0]?.available).toBe(false)
  expect(discovery.view.notice).toContain('升级网关')
  expect(discovery.view.rows).toEqual([])
})
