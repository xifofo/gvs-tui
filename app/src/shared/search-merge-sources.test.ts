import { expect, test } from 'bun:test'
import type { Card } from './api'
import { filterRows, mergeSearch } from './search-merge'
import { cardSourceKey } from './search-sources'

const card = (id: string, sourceTerminal?: 'mobile' | 'tv'): Card => ({
  provider: 'migu', id, title: '繁花', poster: '', desc: '', meta: '2024', vip: false, target: 'detail', sourceTerminal,
} as Card)

test('mergeSearch keeps Migu App and Migu TV as separate sources of one row', () => {
  const rows = mergeSearch([{ provider: 'migu', cards: [card('a1'), card('tv:1', 'tv'), card('a2')] }], cardSourceKey)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.sources.map((c) => c.id)).toEqual(['a1', 'tv:1'])
})

test('default mergeSearch still dedupes per provider', () => {
  const rows = mergeSearch([{ provider: 'migu', cards: [card('a1'), card('tv:1', 'tv')] }])
  expect(rows[0]!.sources.map((c) => c.id)).toEqual(['a1'])
})

test('filterRows by source key separates Migu App from Migu TV', () => {
  const rows = mergeSearch([{ provider: 'migu', cards: [card('a1'), card('tv:1', 'tv')] }], cardSourceKey)
  expect(filterRows(rows, new Set(['migu-tv']), cardSourceKey)[0]!.sources.map((c) => c.id)).toEqual(['tv:1'])
  expect(filterRows(rows, new Set(['migu']), cardSourceKey)).toHaveLength(0)
})
