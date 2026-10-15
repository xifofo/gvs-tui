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
  expect(filename(n)).toStartWith('English.Name.2024.S00E02.单集标题.')
  expect(completedFilename(n, { status: 'unavailable' })).toStartWith('English.Name.2024.S00E02.单集标题.')
  expect(completedFilename({ ...n, kind: 'movie' }, { status: 'unavailable' })).toStartWith('English.Name.2024.TX.')
  expect(completedFilename({ ...n, year: 0 }, { status: 'unavailable' })).toStartWith('English.Name.S00E02.')
  expect(completedFilename({ ...n, namingOrder: undefined }, { status: 'unavailable' })).toStartWith('English.Name.S00E02.单集标题.2024.')
  const long = filename({ ...n, filenameTitle: '很长的中文标题'.repeat(20) })
  expect(Buffer.byteLength(long)).toBeLessThanOrEqual(240)
  expect(long).toContain('.2024.S00E02.')
  expect(long).toEndWith('-GVS.mkv')
})
