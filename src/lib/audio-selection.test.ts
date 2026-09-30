import { expect, test } from 'bun:test'
import { defaultAudioIndex, resolveDefaultAudioId, selectAudioTracks } from './audio-selection.ts'

const pool = [
  { id: 'mandarin', label: 'AAC', lang: '普通话', isDefault: true },
  { id: 'min', label: 'AAC', lang: 'min', isDefault: false },
  { id: 'minnan', label: 'AAC', lang: '闽南', isDefault: false },
]

test('a chosen language overrides the provider default without dropping other audio', () => {
  const tracks = selectAudioTracks(pool, pool.map(a => a.id), 'minnan')
  expect(tracks.map(a => a.id)).toEqual(['mandarin', 'min', 'minnan'])
  expect(tracks.map(a => a.isDefault)).toEqual([false, false, true])
  expect(pool[0]!.isDefault).toBe(true)
  expect(tracks[0]).not.toBe(pool[0])
  // The persisted job carries the same choice when it is resumed.
  expect(defaultAudioIndex(JSON.parse(JSON.stringify(tracks)))).toBe(2)
})

test('unselected or vanished defaults fall back to a selected track', () => {
  expect(resolveDefaultAudioId(pool, ['min', 'minnan'], 'mandarin')).toBe('min')
  expect(resolveDefaultAudioId(pool, ['mandarin', 'min'], 'minnan')).toBe('mandarin')
  expect(selectAudioTracks(pool, ['min', 'minnan']).map(a => a.isDefault)).toEqual([true, false])
  expect(selectAudioTracks(pool, []).map(a => a.id)).toEqual(['mandarin'])
  expect(selectAudioTracks(pool.map(a => ({ ...a, isDefault: false })), []).map(a => a.id)).toEqual(['mandarin'])
})

const tiers = [
  { id: 'V|cmfa1hd3', label: 'AAC', codec: 'AAC', isDefault: true },
  { id: 'V|cmfa3hd5', label: 'DTS', codec: 'DTS', isDefault: false },
  { id: 'V|cmfa4hd4_51', label: '杜比 5.1', codec: 'E-AC-3', isDefault: false },
]
const allTiers = tiers.map(a => a.id)

test('automatic default chooses the highest tier even when the provider defaults to AAC', () => {
  expect(resolveDefaultAudioId(tiers, allTiers)).toBe(tiers[2]!.id)
  expect(selectAudioTracks(tiers, allTiers).map(a => a.isDefault)).toEqual([false, false, true])
  expect(selectAudioTracks(tiers, []).map(a => a.id)).toEqual([tiers[2]!.id])
  expect(resolveDefaultAudioId(tiers, allTiers.slice(0, 2))).toBe(tiers[1]!.id)
  expect(resolveDefaultAudioId(tiers, [tiers[0]!.id])).toBe(tiers[0]!.id)
})

test('a manual AAC choice wins over the automatic highest tier until it is deselected', () => {
  expect(resolveDefaultAudioId(tiers, allTiers, tiers[0]!.id)).toBe(tiers[0]!.id)
  expect(selectAudioTracks(tiers, allTiers, tiers[0]!.id).map(a => a.isDefault)).toEqual([true, false, false])
  expect(resolveDefaultAudioId(tiers, allTiers.slice(1), tiers[0]!.id)).toBe(tiers[2]!.id)
  // Adding a higher tier while still in automatic mode recomputes the default.
  expect(resolveDefaultAudioId(tiers, [tiers[0]!.id])).toBe(tiers[0]!.id)
  expect(resolveDefaultAudioId(tiers, allTiers)).toBe(tiers[2]!.id)
})

test('equal tiers keep the probe language order and codec-only tracks are recognized', () => {
  expect(resolveDefaultAudioId(pool, pool.map(a => a.id))).toBe('mandarin')
  const codecOnly = [
    { id: '1', codec: 'AAC', isDefault: true },
    { id: '2', codec: 'DTS' },
    { id: '3', codec: 'E-AC-3' },
  ]
  expect(resolveDefaultAudioId(codecOnly, ['1', '2', '3'])).toBe('3')
  expect(resolveDefaultAudioId([{ id: 'embedded', codec: 'Atmos', embedded: true }, ...codecOnly], ['embedded', '1', '2', '3'])).toBe('3')
})

test('an explicit output default must belong to the selected separate audio', () => {
  expect(() => selectAudioTracks(pool, ['mandarin'], 'minnan')).toThrow('默认音轨必须是已选音轨')
  expect(() => selectAudioTracks(pool, ['mandarin'], 'gone')).toThrow('默认音轨必须是已选音轨')
  const embedded = [{ id: 'embedded', isDefault: true, embedded: true }]
  expect(selectAudioTracks(embedded, ['embedded'])).toEqual([])
  expect(resolveDefaultAudioId(embedded, ['embedded'])).toBe('')
})

test('only one available audio becomes the mux default, including older tasks and missing tracks', () => {
  expect(defaultAudioIndex([{ isDefault: false }, { isDefault: true }, { isDefault: false }])).toBe(1)
  expect(defaultAudioIndex([{ isDefault: false }, { isDefault: false }])).toBe(0)
  expect(defaultAudioIndex([{}, {}])).toBe(0)
  expect(defaultAudioIndex([{ isDefault: true }, { isDefault: true }])).toBe(0)
})
