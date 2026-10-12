import { expect, test } from 'bun:test'
import { extractYear, filterRows, mergeSearch, normalizeTitle, type MergeCard } from './search-merge'

const card = (provider: string, title: string, extra: Partial<MergeCard> = {}): MergeCard => ({
  provider, id: `${provider}-${title}`, title, poster: '', desc: '', meta: '', vip: false, target: 'detail', ...extra,
})

// normalizeTitle
test('ignores width, case, spaces and title brackets', () => {
    expect(normalizeTitle('《你的爹系男友》')).toBe(normalizeTitle('你的爹系男友'))
    expect(normalizeTitle('ＡＢＣ  第二季')).toBe(normalizeTitle('abc第二季'))
    expect(normalizeTitle('庆余年 · 第二季')).toBe('庆余年第二季')
  })

// extractYear
test('finds a plausible year and ignores longer numbers', () => {
    expect(extractYear('2024 · 剧集 · 36 集')).toBe(2024)
    expect(extractYear('播放量 120245', '更新至 2019')).toBe(2019)
    expect(extractYear('无年份')).toBe(0)
  })

// mergeSearch
test('one row per show across providers, first hit per provider kept', () => {
    const rows = mergeSearch([
      { provider: 'iq', cards: [card('iq', '你的爹系男友', { meta: '2026', vip: true }), card('iq', '你的爹系男友 花絮')] },
      { provider: 'tencent', cards: [card('tencent', '《你的爹系男友》', { meta: '2026 · 剧集' }), card('tencent', '你的爹系男友', { id: 'dup' })] },
      { provider: 'youku', cards: [card('youku', '庆余年')] },
    ])
    expect(rows.map((r) => r.title)).toEqual(['你的爹系男友', '庆余年', '你的爹系男友 花絮'])
    expect(rows[0]!.sources.map((s) => s.provider)).toEqual(['iq', 'tencent'])
    expect(rows[0]!.sources[1]!.id).toBe('tencent-《你的爹系男友》')
    expect(rows[0]!.year).toBe(2026)
  })

test('different years stay separate; unknown year merges with either', () => {
    const rows = mergeSearch([
      { provider: 'iq', cards: [card('iq', '繁花', { meta: '2023' })] },
      { provider: 'youku', cards: [card('youku', '繁花', { meta: '1998' })] },
      { provider: 'mgtv', cards: [card('mgtv', '繁花')] },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.sources.map((s) => s.provider)).toEqual(['iq', 'mgtv'])
  })

test('movie and show with same title do not merge', () => {
    const rows = mergeSearch([
      { provider: 'iq', cards: [card('iq', '误杀', { mediaKind: 'movie' })] },
      { provider: 'tencent', cards: [card('tencent', '误杀', { mediaKind: 'show' })] },
    ])
    expect(rows).toHaveLength(2)
  })

test('fills missing poster/desc from later providers', () => {
    const rows = mergeSearch([
      { provider: 'iq', cards: [card('iq', 'A')] },
      { provider: 'tencent', cards: [card('tencent', 'A', { poster: 'p.jpg', desc: 'd' })] },
    ])
    expect(rows[0]!.poster).toBe('p.jpg')
    expect(rows[0]!.desc).toBe('d')
  })

test('filterRows trims sources and drops rows without a selected provider', () => {
    const rows = mergeSearch([
      { provider: 'iq', cards: [card('iq', 'A'), card('iq', 'B')] },
      { provider: 'tencent', cards: [card('tencent', 'A')] },
    ])
    const only = filterRows(rows, new Set(['tencent']))
    expect(only).toHaveLength(1)
    expect(only[0]!.sources.map((s) => s.provider)).toEqual(['tencent'])
    expect(filterRows(rows, new Set())).toBe(rows)
  })
