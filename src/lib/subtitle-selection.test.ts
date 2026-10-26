import { describe, expect, test } from 'bun:test'
import { subtitleDownloadTracks, toggleSubtitle } from './subtitle-selection.ts'
import type { Subtitle } from '../types.ts'

const row = (over: Partial<Subtitle> = {}): Subtitle => ({
  id: '1',
  label: '繁體中文',
  lang: 'zh-Hant',
  forced: false,
  sdh: false,
  selected: false,
  isDefault: false,
  ...over,
})

describe('subtitle selection', () => {
  test('only selected rows become download tracks', () => {
    const subs = [row({ id: '1', selected: true }), row({ id: '2', lang: 'en', label: 'English', isDefault: true })]
    expect(subtitleDownloadTracks(subs)).toEqual([
      { id: '1', label: '繁體中文', lang: 'zh-Hant', forced: false, sdh: false, isDefault: false },
    ])
  })

  test('selection keeps picker order and every flag the muxer needs', () => {
    const subs = [
      row({ id: '3', label: '强制', lang: 'zh-Hant', forced: true, sdh: false, selected: true }),
      row({ id: '4', label: 'SDH', lang: 'en', forced: false, sdh: true, selected: true }),
    ]
    expect(subtitleDownloadTracks(subs).map(s => [s.id, s.forced, s.sdh])).toEqual([['3', true, false], ['4', false, true]])
  })

  test('toggle flips exactly one row and ignores unknown ids', () => {
    const subs = [row({ id: '1' }), row({ id: '2' })]
    toggleSubtitle(subs, '2')
    expect(subs.map(s => s.selected)).toEqual([false, true])
    toggleSubtitle(subs, 'missing')
    expect(subs.map(s => s.selected)).toEqual([false, true])
  })

  test('no selection means no subtitle tracks', () => {
    expect(subtitleDownloadTracks([row(), row({ id: '2' })])).toEqual([])
  })
})
