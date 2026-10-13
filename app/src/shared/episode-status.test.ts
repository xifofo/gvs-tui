import { expect, test } from 'bun:test'
import { episodeStates, stateOf, type JobLike, type HistoryLike } from './episode-status'

const groupId = 'tencent:maoxuewang:100'
const job = (vid: string, label: string, state: JobLike['state'] = 'done'): JobLike => ({ groupId, vid, label, state })
const history = (vid: string, label: string): HistoryLike => ({ provider: 'tencent', showId: 'maoxuewang', vid, label })

test('new collection is not downloaded just because older collections use the same episode numbers', () => {
  const jobs = Array.from({ length: 42 }, (_, i) => job(`old-${i + 1}`, `S2023E${String(i + 1).padStart(2, '0')}`))
  const rows = Array.from({ length: 42 }, (_, i) => history(`spring-${i + 1}`, `S01E${String(i + 1).padStart(2, '0')}`))
  const states = episodeStates(jobs, 'tencent', 'maoxuewang', rows)
  const autumn = Array.from({ length: 48 }, (_, i) => ({ vid: `autumn-${i + 1}`, season: 1, number: i + 1 }))
  expect(autumn.filter(ep => stateOf(states, ep) === 'done')).toHaveLength(0)
  expect(stateOf(states, { vid: 'old-1', season: 2023, number: 1 })).toBe('done')
  expect(stateOf(states, { vid: 'spring-1', season: 1, number: 1 })).toBe('done')
})

test('same season and number in different collections, or full episode and trailer, require the same vid', () => {
  const states = episodeStates([job('full-2', 'S01E02')], 'tencent', 'maoxuewang')
  expect(stateOf(states, { vid: 'full-2', season: 1, number: 2 })).toBe('done')
  expect(stateOf(states, { vid: 'trailer-2', season: 1, number: 2 })).toBeUndefined()
  expect(stateOf(states, { vid: 'another-collection-2', season: 1, number: 2 })).toBeUndefined()
})

test('changing output season or episode numbering keeps the same video identity, including S00', () => {
  const states = episodeStates([job('final-10', 'S04E10', 'running'), job('special', 'S00E298', 'paused')], 'tencent', 'maoxuewang')
  expect(stateOf(states, { vid: 'final-10', season: 1, number: 10 })).toBe('running')
  expect(stateOf(states, { vid: 'special', season: 0, number: 7 })).toBe('paused')
  expect(stateOf(states, { vid: 'other-10', season: 4, number: 10 })).toBeUndefined()
})

test('history alone identifies downloaded videos after their jobs or files have been removed', () => {
  const states = episodeStates([], 'tencent', 'maoxuewang', [history('saved', 'S03E05')])
  expect(stateOf(states, { vid: 'saved', season: 1, number: 5 })).toBe('done')
  expect(stateOf(states, { vid: 'new', season: 3, number: 5 })).toBeUndefined()
})

test('repeated tasks and history merge by vid using the best state', () => {
  const states = episodeStates([job('v1', 'S01E01', 'failed'), job('v1', 'S04E01', 'queued'), job('v1', 'S04E01', 'running'),
    job('v2', 'S01E01', 'paused')], 'tencent', 'maoxuewang', [history('v1', 'S03E01')])
  expect(stateOf(states, { vid: 'v1', number: 1 })).toBe('done')
  expect(stateOf(states, { vid: 'v2', number: 1 })).toBe('paused')
  const live = episodeStates([job('v1', 'S01E01', 'failed'), job('v1', 'S01E01', 'queued'), job('v1', 'S04E01', 'running')], 'tencent', 'maoxuewang')
  expect(stateOf(live, { vid: 'v1', number: 1 })).toBe('running')
})

test('provider and complete show ID scope jobs and history, including IDs containing colons', () => {
  const jobs: JobLike[] = [job('v1', 'S01E01'), { ...job('wrong-provider', 'S01E01'), groupId: 'youku:maoxuewang:100' },
    { ...job('subshow', 'S01E01'), groupId: 'tencent:maoxuewang:extra:100' }]
  const rows = [history('v2', 'S01E02'), { ...history('wrong-show', 'S01E01'), showId: 'other' },
    { ...history('wrong-provider', 'S01E01'), provider: 'youku' }]
  const states = episodeStates(jobs, 'tencent', 'maoxuewang', rows)
  expect([...states.byVid.keys()].sort()).toEqual(['v1', 'v2'])
  const sub = episodeStates(jobs, 'tencent', 'maoxuewang:extra')
  expect(stateOf(sub, { vid: 'subshow', number: 1 })).toBe('done')
})

test('movie editions with identical titles remain separate videos', () => {
  const states = episodeStates([job('mandarin', '正片')], 'tencent', 'maoxuewang')
  expect(stateOf(states, { vid: 'mandarin', number: 1, title: '正片' }, true)).toBe('done')
  expect(stateOf(states, { vid: 'english', number: 1, title: '正片' }, true)).toBeUndefined()
})

test('legacy labels only match when both sides lack an ID and the exact season or movie edition agrees', () => {
  const states = episodeStates([{ groupId, label: 'S02E05', state: 'done' }, { groupId, label: '正片', state: 'queued' }], 'tencent', 'maoxuewang')
  expect(stateOf(states, { number: 5, season: 2 })).toBe('done')
  expect(stateOf(states, { number: 5, season: 1 })).toBeUndefined()
  expect(stateOf(states, { vid: 'new', number: 5, season: 2 })).toBeUndefined()
  expect(stateOf(states, { number: 1 }, true)).toBe('queued')
  expect(stateOf(states, { vid: 'new-movie', number: 1 }, true)).toBeUndefined()
})
