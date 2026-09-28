import { describe, expect, test } from 'bun:test'
import { parseEpisodes, episodeCollections } from './episodes.ts'
import { folder, type Naming } from './name.ts'

describe('official episode collections', () => {
  test('preserves interviews and trailers, defaults to main and deduplicates VID', () => {
    const eps = parseEpisodes({ episode_groups: [{ id: '正片' }, { id: '专访' }], episodes: [
      { vid: 'i', title: '采访彩蛋', group: '专访', number: 1, duration: 90 },
      { vid: 'm', title: '第1期上', group: '正片', number: 1 },
      { vid: 'm', title: '重复', group: '正片', number: 1 },
      { vid: 'm2', title: '第1期下', group: '正片', number: 2 },
    ] })
    expect(eps.map(e => e.vid)).toEqual(['i', 'm', 'm2'])
    expect(episodeCollections(eps)).toEqual(['正片', '专访'])
    expect(eps.filter(e => e.collection === '正片').map(e => e.number)).toEqual([1, 2])
    expect(eps.every(e => !e.selected)).toBe(true)
  })
  test('legacy Youku short extras stay hidden but a long feature survives', () => {
    expect(parseEpisodes({ episodes: [
      { vid: 'a', title: '预告', duration: 30 }, { vid: 'b', title: '电影', kind: '周边', duration: 7000 },
    ] }).map(e => e.vid)).toEqual(['b'])
  })
  test('same-number interview cannot overwrite a main episode', () => {
    const n: Naming = { kind: 'show', title: '节目', nameDots: '', year: 2025, season: 5,
      episode: 1, height: 2160, codec: 'HEVC', source: 'TX', group: '', tmdbId: 0, container: 'mkv' }
    expect(folder({ ...n, collection: '专访' }, 'downloads')).not.toBe(folder({ ...n, collection: '正片' }, 'downloads'))
    expect(folder({ ...n, collection: '专访' }, 'downloads')).toEndWith('专访')
  })
})
