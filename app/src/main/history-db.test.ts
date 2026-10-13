import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { JobView } from '@shared/api'
import { HistoryDB, showIdOfGroup, type SqlDb } from './history-db'
import { historyFromJob, migrateJobs } from './download-history'

const mk = () => new HistoryDB(new Database(':memory:') as unknown as SqlDb)
const view = (over: Partial<JobView> = {}): JobView => ({
  id: 1, groupId: 'mgtv:clip:912960:1791641622405', groupTitle: '繁花', provider: 'mgtv', poster: '', label: 'S01E02', quality: '1080P',
  status: '完成', pct: 1, log: '', err: '', note: '', state: 'done', output: 'D:\\dl\\繁花\\S01E02.mkv', createdAt: 1, finishedAt: 100, ...over,
})
const task = { vid: 'v2', title: '第2集', season: 1, episode: 2, kind: 'show', audioTracks: [{ label: '普通话' }] }

test('showIdOfGroup keeps colons inside the show id', () => {
  expect(showIdOfGroup('mgtv:clip:912960:1791641622405')).toBe('clip:912960')
  expect(showIdOfGroup('tencent:abc:1')).toBe('abc')
})

test('record / forShow / hasVid / showCounts; file deletion does not matter', () => {
  const db = mk()
  const e = db.record(historyFromJob(view(), task, 1234))
  expect([e.showId, e.season, e.episode, e.audio, e.size]).toEqual(['clip:912960', 1, 2, '普通话', 1234])
  expect(db.forShow('mgtv', 'clip:912960').map((x) => x.vid)).toEqual(['v2'])
  expect(db.hasVid('mgtv', 'v2')).toBe(true)
  expect(db.hasVid('mgtv', 'v3')).toBe(false)
  expect(db.showCounts()).toEqual({ 'mgtv:clip:912960': 1 })
})

test('re-download of the same episode updates the row and keeps ed2k', () => {
  const db = mk()
  const e = db.record(historyFromJob(view(), task, 1))
  db.setEd2k(e.id, 'ab', 'ed2k://|file|x|1|AB|/')
  const again = db.record(historyFromJob(view({ quality: '4K', finishedAt: 200 }), task, 2))
  expect([again.id, again.quality, again.size, again.ed2k]).toEqual([e.id, '4K', 2, 'ab'])
  expect(db.list().total).toBe(1)
})

test('list filters by text/provider with paging, newest first', () => {
  const db = mk()
  for (let i = 1; i <= 5; i++) db.record(historyFromJob(view({ label: `S01E0${i}`, finishedAt: i }), { ...task, vid: `v${i}`, episode: i }, i))
  db.record(historyFromJob(view({ groupId: 'tencent:t1:1', groupTitle: '狂飙', provider: 'tencent' }), { ...task, vid: 'x' }, 1))
  expect(db.list({ provider: 'mgtv', limit: 2 }).items.map((x) => x.episode)).toEqual([5, 4])
  expect(db.list({ text: '狂飙' }).total).toBe(1)
})

test('migrateJobs imports completed jobs once', () => {
  const db = mk()
  const jobs = [{ view: view(), task }, { view: view({ id: 2, state: 'failed', label: 'S01E03' }), task: { ...task, vid: 'v3' } }]
  expect(migrateJobs(db, jobs, () => 99)).toBe(1)
  expect(migrateJobs(db, jobs, () => 99)).toBe(0)
  expect(db.list().items[0]!.size).toBe(99)
})
