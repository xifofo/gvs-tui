import { expect, test } from 'bun:test'
import { diffEpisodes, jitter, nextCheckAt, weeklyWindowAt, windowText, type CheckWindow } from './subscription'

const MIN = 60_000
// 2026-10-12 是周一（本地时区构造，测试与时区无关）
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()
const sub = (window: CheckWindow | null, last = 0, paused = false) => ({ window, paused, state: 'R' as const, lastCheck: last ? { at: last, ok: true, ms: 0, message: '', found: 0 } : null })

test('interval: never checked = now, else last + interval (global default 5 min)', () => {
  const now = at(12, 10)
  expect(nextCheckAt(sub(null), now)).toBe(now)
  expect(nextCheckAt(sub(null, now - 2 * MIN), now)).toBe(now + 3 * MIN)
  expect(nextCheckAt(sub(null, now - 60 * MIN), now)).toBe(now)
  expect(nextCheckAt(sub({ kind: 'interval', minutes: 30 }, now), now)).toBe(now + 30 * MIN)
  expect(nextCheckAt(sub(null, now, true), now)).toBe(Infinity)
})

test('weekly window: inside uses window frequency, outside waits for next start', () => {
  const w: CheckWindow = { kind: 'weekly', days: [2, 3], start: '20:00', end: '22:00', minutes: 10 } // 周二三
  // 周一 10:00 → 周二 20:00
  expect(nextCheckAt(sub(w, at(12, 9)), at(12, 10))).toBe(at(13, 20))
  // 周二 20:30，上次 20:25 → 20:35
  expect(nextCheckAt(sub(w, at(13, 20, 25)), at(13, 20, 30))).toBe(at(13, 20, 35))
  // 周二 21:55，下次 22:05 超出窗口 → 周三 20:00
  expect(nextCheckAt(sub(w, at(13, 21, 55)), at(13, 21, 56))).toBe(at(14, 20))
  // 周三窗口结束 → 下周二
  expect(nextCheckAt(sub(w, at(14, 22)), at(14, 22, 30))).toBe(at(20, 20))
})

test('weekly window crossing midnight', () => {
  const w = { kind: 'weekly' as const, days: [1], start: '23:00', end: '01:00', minutes: 5 }
  expect(weeklyWindowAt(w, at(13, 0, 30))).toEqual([at(12, 23), at(13, 1)])
  expect(weeklyWindowAt(w, at(13, 1, 30))).toBe(null)
})

test('episode times: grace window, next time, then 6h fallback', () => {
  const w: CheckWindow = { kind: 'episodes', times: [at(13, 20), at(15, 20)], graceMinutes: 60, minutes: 5 }
  expect(nextCheckAt(sub(w, at(12, 9)), at(12, 10))).toBe(at(13, 20))
  expect(nextCheckAt(sub(w, at(13, 20, 10)), at(13, 20, 12))).toBe(at(13, 20, 15))
  expect(nextCheckAt(sub(w, at(13, 20, 58)), at(13, 20, 59))).toBe(at(15, 20))
  expect(nextCheckAt(sub(w, at(16, 9)), at(16, 10))).toBe(at(16, 15))
})

test('diffEpisodes ignores known vids and non-main collections', () => {
  const known = [{ vid: 'a', number: 1, title: '', firstSeen: 0 }]
  const latest = [{ vid: 'a', number: 1, title: '' }, { vid: 'b', number: 2, title: '' }, { vid: 'c', number: 0, title: '预告', collection: '预告' }]
  expect(diffEpisodes(known, latest).map((e) => e.vid)).toEqual(['b'])
})

test('jitter stays within ±20% and text helpers', () => {
  expect(jitter(1000, () => 0)).toBe(800)
  expect(jitter(1000, () => 1)).toBe(1200)
  expect(windowText({ kind: 'weekly', days: [0, 2, 3], start: '20:00', end: '22:00', minutes: 10 })).toBe('每周二三日 20:00–22:00 · 每 10 分钟')
  expect(windowText(null)).toBe('每 5 分钟')
})
