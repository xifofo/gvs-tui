import { expect, test } from 'bun:test'
import { iqcnEpisodeRendition } from './iqcn-rendition.ts'

const selected = { bid: '800', br: '200', fr: '60', vid: 'previousEpisode' }
const current = { bid: 800, br: 200, fr: 60, vid: 'currentEpisode', codec_code: 1 }

test('batch selection binds the tier to the current episode vid', () => {
  expect(iqcnEpisodeRendition({ tvid: 'episode2', formats: [current] }, 'episode2', selected, 'H265')).toEqual({ ...selected, vid: 'currentEpisode' })
  expect(selected.vid).toBe('previousEpisode')
})

test('exact current rendition is retained even with several same-tier options', () => {
  expect(iqcnEpisodeRendition({ formats: [current, { ...current, vid: selected.vid }] }, 'episode1', selected).vid).toBe(selected.vid)
})

test('missing, ambiguous, different codec or wrong episode never silently substitutes', () => {
  for (const data of [
    { formats: [] }, { formats: [current, { ...current, vid: 'otherHDR' }] },
    { formats: [{ ...current, codec_code: 5 }] }, { tvid: 'wrongEpisode', formats: [current] },
    { formats: [{ ...current, fr: 25 }] },
  ]) expect(() => iqcnEpisodeRendition(data, 'episode2', selected, 'H265')).toThrow()
})
