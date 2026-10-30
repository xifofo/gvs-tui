import { expect, test } from 'bun:test'
import { formatRules, parseRules, pickBest, shouldUpgrade, type RuleCandidate } from './rule-groups'

const dolby = { id: 'a-ddp', label: '杜比全景声', codec: 'ec-3' }
const aac = { id: 'a-aac', label: '普通话', codec: 'mp4a.40.2' }
const c = (index: number, height: number, codec: string, audios = [aac], hdr = ''): RuleCandidate => ({ index, height, codec, hdr, audios, label: `${codec === "DV" ? height + "p DV PQ" : height + "P"}` })

test('parse groups, aliases, negation and unknown tokens', () => {
  const g = parseRules(' 4K & 杜比 > 1080p&AAC > !HDR > any > foo ')
  expect(g.tiers.map((t) => t.map((x) => (x.neg ? '!' : '') + x.key))).toEqual([['4k', 'dolby'], ['1080p', 'aac'], ['!hdr'], ['any']])
  expect(g.errors).toEqual(['未知条件「foo」'])
  expect(formatRules(parseRules('4k&dolby>any'))).toBe('4K & DOLBY > any')
})

test('pickBest prefers earlier tier, then resolution, and picks matching audio', () => {
  const cands = [c(0, 1080, 'avc', [aac]), c(1, 2160, 'hevc', [aac, dolby]), c(2, 720, 'avc')]
  const m = pickBest('4K & Dolby > 1080P & AAC > any', cands)
  expect([m?.tier, m?.index, m?.audioIds]).toEqual([0, 1, ['a-ddp']])
  const m2 = pickBest('4K & Dolby > 1080P & AAC > any', [cands[0]!, cands[2]!])
  expect([m2?.tier, m2?.index, m2?.audioIds]).toEqual([1, 0, ['a-aac']])
  // 4K 但没有杜比：不满足第一档，落到 any，同档按分辨率取 4K
  const m3 = pickBest('4K & Dolby > any', [c(0, 2160, 'hevc'), c(1, 1080, 'avc')])
  expect([m3?.tier, m3?.index]).toEqual([1, 0])
})

test('no tier matches returns null; empty spec means any', () => {
  expect(pickBest('4K & Dolby', [c(0, 1080, 'avc')])).toBe(null)
  expect(pickBest('', [c(0, 720, 'avc'), c(1, 1080, 'avc')])?.index).toBe(1)
  expect(pickBest('HEVC > H264', [c(0, 1080, 'avc1.640028'), c(1, 1080, 'hvc1.1.6')])?.index).toBe(1)
})

test('hdr / dolby vision and negation', () => {
  const cands = [c(0, 2160, 'hevc', [aac], 'HDR10'), c(1, 2160, 'hevc', [aac], 'Dolby Vision'), c(2, 2160, 'hevc', [aac], 'SDR')]
  expect(pickBest('DV > HDR > any', cands)?.index).toBe(1)
  expect(pickBest('!HDR', cands)?.index).toBe(2)
})

test('Apple TV PQ is HDR and a DV codec wins over HDR', () => {
  const cands = [c(0, 1920, 'H265', [aac], 'PQ'), c(1, 1920, 'DV', [aac], 'PQ'), c(2, 1920, 'H265', [aac], 'SDR')]
  expect(pickBest('DV > HDR > any', cands)?.index).toBe(1)
  expect(pickBest('HDR > any', cands)?.index).toBe(0)
  expect(pickBest('!HDR', cands)?.index).toBe(2)
})

test('upgrade only when strictly better tier', () => {
  expect(shouldUpgrade(2, { tier: 0, index: 0, audioIds: [], label: '' })).toBe(true)
  expect(shouldUpgrade(1, { tier: 1, index: 0, audioIds: [], label: '' })).toBe(false)
  expect(shouldUpgrade(0, { tier: 0, index: 0, audioIds: [], label: '' })).toBe(false)
  expect(shouldUpgrade(1, null)).toBe(false)
})
