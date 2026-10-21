import { expect, test } from 'bun:test'
import { expectedTimes, mgtvShowId, parseMgtvConf, parseUpdateText } from './calendar'

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
    ['早间节目', 'clip:1', '第6期上', '08:00', 'x.jpg'],
    ['云雀叫天录', 'clip:875804', '21,22集', '20:00', 'vv.jpg'],
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

test('mgtv calendar ids open as shows (clip:ID), never as bare vids', () => {
  expect(mgtvShowId('912960')).toBe('clip:912960')
  expect(mgtvShowId('clip:912960')).toBe('clip:912960')
  expect(mgtvShowId('vid:1')).toBe('vid:1')
})

test('titleKey aligns platform schedule rows with subscriptions', async () => {
  const { titleKey } = await import('./calendar')
  // 平台排播给的名字 vs 订阅里存的名字，标点/空格/季数不同也要对上
  expect(titleKey('了不起啊朋友 第一季')).toBe(titleKey('了不起啊朋友'))
  expect(titleKey('《嫁金钗》')).toBe(titleKey('嫁金钗'))
  expect(titleKey('美人余（2026）')).toBe(titleKey(' 美人余 2026 '))
  expect(titleKey('凤栖·第2季')).toBe(titleKey('凤栖'))
  // 不同剧不能撞
  expect(titleKey('美人余') === titleKey('美人鱼')).toBe(false)
  expect(titleKey('')).toBe('')
})

test('openTarget: subscribed → its detail, platform id → detail, title only → search', async () => {
  const { openTarget } = await import('./calendar')
  // 已订阅：即使条目没有平台 id，也用订阅自己的 provider/showId 打开
  expect(openTarget({ id: '', provider: 'mgtv', title: '凤栖' }, { provider: 'mgtv', showId: 'clip:875855' }))
    .toEqual({ kind: 'detail', provider: 'mgtv', id: 'clip:875855' })
  // 订阅在别的平台也要打开订阅那一份
  expect(openTarget({ id: '', provider: 'tencent', title: '伟大的长征' }, { provider: 'iqcn', showId: 'iq-show-1' }))
    .toEqual({ kind: 'detail', provider: 'iqcn', id: 'iq-show-1' })
  // 未订阅但有平台剧集 id（芒果兜底排播）
  expect(openTarget({ id: 'clip:1', provider: 'mgtv', title: '早间节目' }, null))
    .toEqual({ kind: 'detail', provider: 'mgtv', id: 'clip:1' })
  // 未订阅且只有剧名（网关排播）→ 搜索
  expect(openTarget({ id: '', provider: 'youku', title: ' 嫁金钗 ' }, null))
    .toEqual({ kind: 'search', query: '嫁金钗' })
  expect(openTarget({ id: '', provider: 'youku', title: '   ' }, null)).toBe(null)
})

// 网关 provider=dengta / action=calendar 的真实形状（2026-10-18 实测响应截取）
const gwSample = {
  today: '2026-10-18',
  horizon: 14,
  days: [
    { date: '2026-10-19', weekday: '周一', today: false, items: [
      { title: '美人余', provider: 'tencent', platforms: '腾讯视频', time: '12:00', episodes: '第23-24集', total: 28, poster: 'https://gw.alicdn.com/p.jpg', posterHor: 'https://gw.alicdn.com/h.jpg' },
      { title: '凤栖', provider: 'mgtv', platforms: '芒果TV', time: '10:00', episodes: '第13-15集', total: 24, poster: '', posterHor: '' },
      { title: '伟大的长征', provider: 'tencent', platforms: '爱奇艺/腾讯视频', time: '20:00', episodes: '', total: 60, poster: '', posterHor: '' },
    ] },
    { date: 'not-a-date', weekday: '周二', today: false, items: [] },
  ],
}

test('parseGatewayCalendar maps the gateway payload to CalendarDay[]', async () => {
  const { parseGatewayCalendar } = await import('./calendar')
  const now = new Date(2026, 9, 19, 9).getTime()
  const days = parseGatewayCalendar(gwSample, now)
  expect(days.map((d) => [d.date, d.weekday, d.today])).toEqual([['2026-10-19', '周一', true]])
  // 按更新时间排序，平台文案进 info，全 N 集兜底 episodes
  expect(days[0]!.items.map((i) => [i.title, i.provider, i.info, i.time, i.episodes, i.id, i.source])).toEqual([
    ['凤栖', 'mgtv', '芒果TV', '10:00', '第13-15集', '', 'platform'],
    ['美人余', 'tencent', '腾讯视频', '12:00', '第23-24集', '', 'platform'],
    ['伟大的长征', 'tencent', '爱奇艺/腾讯视频', '20:00', '全60集', '', 'platform'],
  ])
  expect(days[0]!.items[1]!.onlineAt).toBe(new Date(2026, 9, 19, 12, 0).getTime())
  // 封面直链原样带过来（「发现新剧」的卡片用得上）
  expect([days[0]!.items[1]!.poster, days[0]!.items[1]!.posterHor]).toEqual(['https://gw.alicdn.com/p.jpg', 'https://gw.alicdn.com/h.jpg'])
  // 没有平台剧集 id → 不能订阅；解析必须容忍包装层与空载荷
  expect(parseGatewayCalendar({ data: gwSample }, now)).toHaveLength(1)
  expect(parseGatewayCalendar({ days: [] }, now)).toEqual([])
  expect(parseGatewayCalendar(null, now)).toEqual([])
})
