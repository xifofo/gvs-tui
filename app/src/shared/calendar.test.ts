import { expect, test } from 'bun:test'
import { expectedTimes, parseMgtvConf, parseUpdateText } from './calendar'

const sample = {
  code: 200, msg: 'ok', data: [
    { tagName: '10-12', desc: '周一', selected: 1, dataList: [
      { aid: '875804', jumpId: '875804', title: '云雀叫天录', info: '电视剧/剧情', series: '21,22集', rightBottom: '22集', beginTime: '20:00', onlineTime: 1791806400, onlineText: '10月12日 更新', img: 'v.jpg', imgHor: 'h.jpg', imgVer: 'vv.jpg' },
      { aid: '1', jumpId: '', title: '早间节目', info: '综艺', series: '', rightBottom: '第6期上', beginTime: '08:00', onlineTime: 0, onlineText: '', img: 'x.jpg' },
      { aid: '2', title: '' },
    ] },
    { tagName: '01-02', desc: '周五', selected: 0, dataList: [] },
  ],
}

test('parseMgtvConf maps days and items, sorted by time', () => {
  const now = new Date(2026, 9, 12, 12).getTime()
  const days = parseMgtvConf(sample, now)
  expect(days.map((d) => [d.date, d.weekday, d.today])).toEqual([['2026-10-12', '周一', true], ['2027-01-02', '周五', false]])
  expect(days[0]!.items.map((i) => [i.title, i.id, i.episodes, i.time, i.poster])).toEqual([
    ['早间节目', '1', '第6期上', '08:00', 'x.jpg'],
    ['云雀叫天录', '875804', '21,22集', '20:00', 'vv.jpg'],
  ])
  expect(days[0]!.items[1]!.onlineAt).toBe(1791806400000)
  expect(days[0]!.items[1]!.url).toBe('https://www.mgtv.com/h/875804.html')
  expect(parseMgtvConf({ code: 500 })).toEqual([])
})

test('parseUpdateText handles common platform phrases', () => {
  expect(parseUpdateText('更新至08集 每日19:30更新')).toEqual({ latest: 8, total: 0, finished: false, days: [0, 1, 2, 3, 4, 5, 6], time: '19:30' })
  expect(parseUpdateText('每周二三20:00更新 更新至第十二集')).toEqual({ latest: 12, total: 0, finished: false, days: [2, 3], time: '20:00' })
  const r = parseUpdateText('周一至周四 20:00 更新')
  expect(r.days).toEqual([1, 2, 3, 4])
  expect(parseUpdateText('全36集').finished).toBe(true)
  expect(parseUpdateText('全36集').total).toBe(36)
  expect(parseUpdateText('周日、周六 10:00').days).toEqual([0, 6])
})

test('expectedTimes projects the schedule', () => {
  const now = new Date(2026, 9, 12, 21).getTime() // 周一 21:00
  const t = expectedTimes({ latest: 8, total: 0, finished: false, days: [2], time: '19:30' }, now, 14)
  expect(t).toEqual([new Date(2026, 9, 13, 19, 30).getTime(), new Date(2026, 9, 20, 19, 30).getTime()])
  expect(expectedTimes({ latest: 0, total: 0, finished: true, days: [1], time: '' }, now)).toEqual([])
})

test('subscriptionItems: detected (downloaded/new), skips baseline bulk, projects weekly window', async () => {
  const { subscriptionItems } = await import('./calendar')
  const d = (day: number, h: number) => new Date(2026, 9, day, h).getTime()
  const base = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, firstSeen: d(10, 9) }))
  const subs = [{
    id: 's', provider: 'tencent', showId: 'c1', title: '剧', poster: '', updateText: '', paused: false,
    window: { kind: 'weekly', days: [3], start: '20:00' },
    episodes: [...base, { number: 11, firstSeen: d(12, 20), downloaded: { at: d(12, 21), label: '1080P' } }, { number: 12, firstSeen: d(13, 20) }],
  }]
  const items = subscriptionItems(subs, d(12, 0), d(19, 0), d(12, 12))
  expect(items.map((i) => [i.episodes, i.status, i.time])).toEqual([
    ['第 11 集', 'downloaded', '20:00'],
    ['第 12 集', 'new', '20:00'],
    ['预计更新', 'pending', '20:00'],
  ])
  expect(subscriptionItems(subs, d(10, 0), d(11, 0), d(12, 12))).toEqual([])
})
