import { test, expect } from 'bun:test'
import { cardTarget } from './card-target'
import { discoveryRows } from './discovery'

for (const [provider, vid] of [['youku', 'XNjUzMzM0MDI1Ng=='], ['tencent', 'g4102f0fkum']]) {
  test(`${provider} VID-only discovery card opens video detail despite stale search target`, () => {
    const raw = { title: '片源', meta: { vid, target: { type: 'search', query: '片源' } } }
    expect(cardTarget(provider, raw)).toEqual({ type: 'video', id: vid })
    const [row] = discoveryRows(provider, { items: [raw] })
    expect(row.target).toEqual({ type: 'video', id: vid })
  })
}
test('same-title edition VIDs stay separate and reservation stays unavailable', () => {
  const items = [{ title: '电影', vid: 'Xone' }, { title: '电影', vid: 'Xtwo' }]
  expect(discoveryRows('youku', { items })).toHaveLength(2)
  expect(cardTarget('youku', { ...items[0], target: { type: 'unavailable', reason: '预约' } }).type).toBe('unavailable')
})
test('Tencent cover and page URLs retain their different identities', () => {
  expect(cardTarget('tencent', { url: 'https://v.qq.com/x/cover/mzc00200gag6dkh/g4102f0fkum.html' })).toEqual({ type: 'detail', id: 'mzc00200gag6dkh' })
  expect(cardTarget('tencent', { url: 'https://v.qq.com/x/page/g4102f0fkum.html' })).toEqual({ type: 'video', id: 'g4102f0fkum' })
  expect(cardTarget('tencent', { cid: 'mzc00200gag6dkh', target: { type: 'detail', id: 'imax:mzc00200gag6dkh' } }).id).toBe('imax:mzc00200gag6dkh')
})
test('true keyword lists still search and channel cards stay channels', () => {
  expect(cardTarget('tencent', { id: '7', title: '关键词', target: { type: 'search' } }).type).toBe('search')
  expect(cardTarget('tencent', { cid: 'mzc00200gag6dkh', target: { type: 'channel', sectionId: 'tv:page:movie' } }).type).toBe('channel')
})
