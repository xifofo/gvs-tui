import { expect, test } from 'bun:test'
import { outputNaming } from './output-naming'
import { completedFilename, filename, type Naming } from './name'

test('manual naming validates and retains zero, while empty title restores automatic naming', () => {
  expect(outputNaming({ title: '  English Name  ', year: 2024, season: 0 })).toEqual({ title: 'English Name', year: 2024, season: 0 })
  expect(outputNaming({ title: '  ' })).toEqual({})
  expect(outputNaming(undefined)).toEqual({})
  for (const input of [{ year: 0 }, { year: 24 }, { year: 2024.5 }, { year: NaN }, { year: 10000 }, { season: -1 }, { season: 1000 }, { season: 1.1 }, { title: '...' }, { title: 'a\nb' }]) {
    expect(() => outputNaming(input)).toThrow()
  }
})

test('new tasks place year immediately after title in preview and fallback, while legacy order remains stable', () => {
  const n: Naming = { kind: 'show', title: '中文名', filenameTitle: 'English Name', nameDots: '', namingOrder: 'title-year',
    year: 2024, season: 0, episode: 2, episodeTitle: '单集标题', height: 1080, codec: 'H264', source: 'TX', group: 'GVS', tmdbId: 123, container: 'mkv' }
  expect(filename(n)).toStartWith('English.Name.2024.S00E02.1080p.')
  expect(completedFilename(n, { status: 'unavailable' })).toStartWith('English.Name.2024.S00E02.TX.')
  expect(completedFilename({ ...n, kind: 'movie' }, { status: 'unavailable' })).toStartWith('English.Name.2024.TX.')
  expect(completedFilename({ ...n, year: 0 }, { status: 'unavailable' })).toStartWith('English.Name.S00E02.')
  expect(completedFilename({ ...n, namingOrder: undefined }, { status: 'unavailable' })).toStartWith('English.Name.S00E02.单集标题.2024.')
  const long = filename({ ...n, filenameTitle: '很长的中文标题'.repeat(20) })
  expect(Buffer.byteLength(long)).toBeLessThanOrEqual(240)
  expect(long).toContain('.2024.S00E02.')
  expect(long).toEndWith('-GVS.mkv')
})

test('current template adds only the episode title, preserving year, numbering, specs and folders', () => {
  const n: Naming = { kind: 'show', title: '中文名', filenameTitle: 'English Name', nameDots: '', namingOrder: 'title-year',
    year: 2026, season: 0, episode: 298, episodeTitle: '特别篇：雨夜/重逢', height: 2160, codec: 'H265',
    audio: 'DDP.5.1', dv: true, source: 'TX', group: 'PFWEB', tmdbId: 123, container: 'mkv' }
  const specs = { status: 'probed' as const, width: 3840, height: 2160, codec: 'hevc', dynamicRange: 'HDR', fps: 60,
    audio: { status: 'confirmed' as const, codec: 'eac3', channels: 6 } }
  for (const makeName of [(x: Naming) => filename(x), (x: Naming) => completedFilename(x, specs, 'MAXPLUS')]) {
    const off = makeName({ ...n, filenameEpisodeTitle: false })
    const on = makeName({ ...n, filenameEpisodeTitle: true })
    expect(on).toBe(off.replace('.S00E298.', '.S00E298.特别篇.雨夜.重逢.'))
    expect(makeName(n)).toBe(off)
    for (const episodeTitle of ['', '中文名', 'English Name', ':/?!']) {
      expect(makeName({ ...n, filenameEpisodeTitle: true, episodeTitle })).toBe(off)
    }
    expect(makeName({ ...n, kind: 'movie', filenameEpisodeTitle: true }))
      .toBe(makeName({ ...n, kind: 'movie', filenameEpisodeTitle: false }))
    const long = makeName({ ...n, filenameEpisodeTitle: true, episodeTitle: '标题非常长'.repeat(100) })
    expect(Buffer.byteLength(long, 'utf8')).toBeLessThanOrEqual(240)
    expect(long).toStartWith('English.Name.2026.S00E298.')
    expect(long.slice(long.indexOf('.2160p.'))).toBe(off.slice(off.indexOf('.2160p.')))
  }
})
