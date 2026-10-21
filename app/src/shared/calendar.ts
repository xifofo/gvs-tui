/**
 * 追剧日历数据：芒果 TV 排播（playbill.api.mgtv.com/broadcost/conf，免签名免登录）
 * + 平台更新文案解析（腾讯 / 咪咕等「更新至08集 每日19:30更新」）。
 * 纯函数；网络请求在主进程（calendar-source.ts）。
 * TODO(gateway)：网关如果以后提供 op=calendar，主进程优先走网关，这里的解析保持不变。
 */
export const MGTV_CALENDAR_URL = 'https://playbill.api.mgtv.com/broadcost/conf'

export type CalendarItem = {
  provider: string
  /** 能直接打开详情的节目 id（芒果是 clipId） */
  id: string
  title: string
  info: string
  /** 「21,22集」「38集」「第6期上」 */
  episodes: string
  time: string
  onlineAt: number
  onlineText: string
  poster: string
  posterHor: string
  url: string
  /** 来源：platform 平台排播；subscription 订阅检测/预计 */
  source: 'platform' | 'subscription'
  status?: 'downloaded' | 'pending' | 'new' | 'failed'
}

export type CalendarDay = { date: string; weekday: string; today: boolean; items: CalendarItem[] }

const pad = (n: number) => String(n).padStart(2, '0')
export const dateKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 网关的芒果 detail 约定：纯数字 id 是单集 vid，节目（合集）必须写成 clip:ID。
 * 排播接口给的是 clipId，直接传会被当成 vid → 上游 code=10000 → 503。
 */
export function mgtvShowId(raw: string): string {
  return /^\d+$/.test(raw) ? `clip:${raw}` : raw
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** tagName 只有「10-05」：按 onlineTime 或参考时间推年份（跨年时取离参考时间最近的那一年） */
function resolveDate(tag: string, ref: number, sampleOnline: number): string {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(tag.trim())
  if (!m) return sampleOnline ? dateKey(sampleOnline) : ''
  const mon = Number(m[1]), day = Number(m[2])
  const y0 = new Date(ref).getFullYear()
  let best = '', bestDiff = Infinity
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const t = new Date(y, mon - 1, day).getTime()
    const diff = Math.abs(t - ref)
    if (diff < bestDiff) { bestDiff = diff; best = `${y}-${pad(mon)}-${pad(day)}` }
  }
  return best
}

export function parseMgtvConf(json: unknown, now = Date.now()): CalendarDay[] {
  const root = json as { code?: unknown; data?: unknown }
  const days = Array.isArray(root?.data) ? root.data : Array.isArray(json) ? (json as unknown[]) : []
  const today = dateKey(now)
  const out: CalendarDay[] = []
  for (const raw of days) {
    const d = raw as Record<string, unknown>
    const list = Array.isArray(d.dataList) ? (d.dataList as Record<string, unknown>[]) : []
    const firstOnline = Number(list[0]?.onlineTime) || 0
    const date = resolveDate(str(d.tagName), now, firstOnline * 1000)
    if (!date) continue
    const items: CalendarItem[] = list
      .filter((x) => str(x.title))
      .map((x) => {
        const clip = str(x.jumpId) || str(x.aid)
        return {
          provider: 'mgtv',
          id: clip ? mgtvShowId(clip) : '',
          title: str(x.title),
          info: str(x.info),
          episodes: str(x.series) || str(x.rightBottom),
          time: str(x.beginTime),
          onlineAt: (Number(x.onlineTime) || 0) * 1000,
          onlineText: str(x.onlineText),
          poster: str(x.imgVer) || str(x.img),
          posterHor: str(x.imgHor),
          url: clip ? `https://www.mgtv.com/h/${clip}.html` : '',
          source: 'platform' as const,
        }
      })
      .sort((a, b) => a.time.localeCompare(b.time))
    out.push({ date, weekday: str(d.desc), today: date === today, items })
  }
  return out
}

export type CalendarOpenTarget =
  | { kind: 'detail'; provider: string; id: string }
  | { kind: 'search'; query: string }

/**
 * 点日历/发现页的条目时该去哪：
 * 1. 有匹配的订阅 → 打开那条订阅的详情（用订阅自己的 provider + showId，一定跳得动）；
 * 2. 条目自带平台剧集 id（芒果兜底排播）→ 直接开详情；
 * 3. 只有剧名（网关排播）→ 带着剧名去搜索页，不假装能开详情。
 */
export function openTarget(
  item: { id: string; provider: string; title: string },
  sub: { provider: string; showId: string } | null,
): CalendarOpenTarget | null {
  if (sub?.showId) return { kind: 'detail', provider: sub.provider, id: sub.showId }
  if (item.id) return { kind: 'detail', provider: item.provider, id: item.id }
  if (item.title.trim()) return { kind: 'search', query: item.title.trim() }
  return null
}

const TITLE_NOISE = /[\s\u00a0·・:：;；\-—_~～.,，。!！?？'‘’"“”《》〈〉「」『』【】()[\]（）]/g

/**
 * 标题归一：去掉空白、标点、书名号与「第 N 季」后缀。
 *
 * 用途：网关排播条目只有剧名（灯塔不给平台剧集 id），要和用户已有订阅对上是
 * 「已订阅 / 未订阅、点进去看哪一页」的唯一依据，所以两边都用这个 key 比。
 */
export function titleKey(title: string): string {
  return (title || '')
    .replace(/第[一二三四五六七八九十0-9]+[季部]/g, '')
    .replace(TITLE_NOISE, '')
    .toLowerCase()
}

/**
 * 网关 `provider=dengta / action=calendar` 载荷 → CalendarDay[]。
 *
 * 载荷形状（`/v1/invoke` 的 data）：
 *   { today, horizon, days: [{ date, weekday, today, items: [
 *       { title, provider, platforms, time, episodes, total, poster, posterHor } ] }] }
 *
 * 抓包与签名全在网关侧，客户端只做这一层形状映射：
 * - `provider` 已经是 TUI 的平台 id（tencent / iqcn / youku / mgtv）；
 * - `platforms` 是上游原始文案（「爱奇艺/腾讯视频」），塞进 `info` 复用卡片副标题与平台筛选；
 * - `id` 留空：灯塔只给自家剧目 id，不是平台剧集 id，不能拿去订阅/开详情；
 *   点卡片时用 `titleKey` 找已订阅的那一部，找不到就带着剧名跳搜索。
 */
export function parseGatewayCalendar(json: unknown, now = Date.now()): CalendarDay[] {
  const root = json as { days?: unknown; data?: { days?: unknown } } | null
  const list = Array.isArray(root?.days) ? root.days : Array.isArray(root?.data?.days) ? root.data!.days! : []
  const today = dateKey(now)
  const out: CalendarDay[] = []
  for (const raw of list as Record<string, unknown>[]) {
    const date = str(raw.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const items: CalendarItem[] = (Array.isArray(raw.items) ? raw.items : [])
      .map((x) => {
        const it = x as Record<string, unknown>
        const time = str(it.time)
        const total = Number(it.total) || 0
        const at = new Date(`${date}T${/^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '20:00'}:00`).getTime()
        return {
          provider: str(it.provider),
          id: '',
          title: str(it.title),
          info: str(it.platforms),
          episodes: str(it.episodes) || (total > 0 ? `全${total}集` : ''),
          time,
          onlineAt: Number.isFinite(at) ? at : 0,
          onlineText: '',
          poster: str(it.poster),
          posterHor: str(it.posterHor),
          url: '',
          source: 'platform' as const,
        }
      })
      .filter((i) => i.title)
      .sort((a, b) => a.time.localeCompare(b.time))
    out.push({ date, weekday: str(raw.weekday), today: date === today, items })
  }
  return out
}

export type UpdateInfo = {
  /** 已更新到第几集 */
  latest: number
  /** 全集数（「全36集」「共36集」） */
  total: number
  finished: boolean
  /** 更新日 0=周日..6；空 = 未知 */
  days: number[]
  time: string
}

const CN: Record<string, number> = { 日: 0, 天: 0, 七: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const toNum = (s: string) => {
  if (/^\d+$/.test(s)) return Number(s)
  const map: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let n = 0, cur = 0
  for (const ch of s) {
    if (ch === '十') { n += (cur || 1) * 10; cur = 0 } else if (ch === '百') { n += (cur || 1) * 100; cur = 0 } else cur = map[ch] ?? 0
  }
  return n + cur
}

/**
 * 「更新至08集 每日19:30更新」「每周二三20:00更新 更新至12集」「周一至周四 20:00」「全36集」「已完结」
 */
export function parseUpdateText(text: string): UpdateInfo {
  const t = (text || '').replace(/\s+/g, ' ')
  const out: UpdateInfo = { latest: 0, total: 0, finished: false, days: [], time: '' }
  const latest = /(?:更新至|更至|更新到)\s*第?\s*([0-9零一二两三四五六七八九十百]+)\s*[集期话]/.exec(t)
  if (latest) out.latest = toNum(latest[1]!)
  const total = /(?:全|共)\s*([0-9零一二两三四五六七八九十百]+)\s*[集期话]/.exec(t)
  if (total) { out.total = toNum(total[1]!); if (!latest) out.latest = out.total }
  out.finished = /完结|全集|已完|全\s*\d+\s*集/.test(t)
  const time = /(\d{1,2})[:：](\d{2})/.exec(t)
  if (time) out.time = `${pad(Number(time[1]))}:${time[2]}`
  if (/每日|每天|日更/.test(t)) out.days = [0, 1, 2, 3, 4, 5, 6]
  else {
    const range = /(?:周|星期)([一二三四五六日天])\s*(?:至|到|-|~|—)\s*(?:周|星期)?([一二三四五六日天])/.exec(t)
    if (range) {
      const a = CN[range[1]!]!, b = CN[range[2]!]!
      const days: number[] = []
      for (let i = 0, d = a; i < 7; i++, d = (d + 1) % 7) { days.push(d); if (d === b) break }
      out.days = days
    } else {
      const set = new Set<number>()
      for (const m of t.matchAll(/(?:周|星期)([一二三四五六日天、,，和]+)/g)) for (const c of m[1]!) if (c in CN) set.add(CN[c]!)
      out.days = [...set].sort((a, b) => a - b)
    }
  }
  return out
}

/** 由更新规律推算接下来 n 天的预计更新时间点（毫秒），给订阅的 episodes 窗口 / 日历用 */
export function expectedTimes(info: UpdateInfo, now: number, days = 14): number[] {
  if (!info.days.length || info.finished) return []
  const [h, m] = (info.time || '20:00').split(':').map(Number)
  const out: number[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setHours(h!, m!, 0, 0)
    d.setDate(d.getDate() + i)
    if (info.days.includes(d.getDay())) out.push(d.getTime())
  }
  return out
}

type SubLike = {
  id: string; provider: string; showId: string; title: string; poster: string; updateText: string; paused: boolean
  window?: { kind: string; days?: number[]; start?: string; times?: number[] } | null
  episodes: Array<{ number: number; firstSeen: number; downloaded?: { at: number; label: string } }>
  lastCheck?: { ok: boolean } | null
}

/**
 * 订阅 → 日历条目：已检测到的集（按发现时间；已下载 / 已更新未下载）+ 预计更新（每周窗口、按集时间、平台更新文案）。
 * 只返回 [from, to) 内的条目。
 */
export function subscriptionItems(subs: SubLike[], from: number, to: number, now = Date.now()): CalendarItem[] {
  const out: CalendarItem[] = []
  const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
  for (const s of subs) {
    const base = { provider: s.provider, id: s.showId, title: s.title, info: '我的订阅', poster: s.poster, posterHor: '', url: '', onlineText: '', source: 'subscription' as const }
    const byDay = new Map<string, { at: number; nums: number[]; done: boolean }>()
    for (const e of s.episodes) {
      if (e.firstSeen < from || e.firstSeen >= to) continue
      const k = dateKey(e.firstSeen)
      const g = byDay.get(k) ?? { at: e.firstSeen, nums: [], done: true }
      if (e.number > 0) g.nums.push(e.number)
      g.done &&= !!e.downloaded
      g.at = Math.min(g.at, e.firstSeen)
      byDay.set(k, g)
    }
    // 首次检查时一次性记下的存量集不算「更新」：同一时刻发现超过 3 集的跳过
    for (const g of byDay.values()) {
      if (g.nums.length > 3 && s.episodes.filter((e) => e.firstSeen === g.at).length > 3) continue
      out.push({ ...base, episodes: g.nums.length ? `第 ${g.nums.sort((a, b) => a - b).join(',')} 集` : '新视频', time: hhmm(g.at), onlineAt: g.at, status: g.done ? 'downloaded' : 'new' })
    }
    if (s.paused) continue
    let expected: number[] = []
    const w = s.window
    if (w?.kind === 'episodes' && w.times) expected = w.times
    else if (w?.kind === 'weekly' && w.days?.length) expected = expectedTimes({ latest: 0, total: 0, finished: false, days: w.days, time: w.start || '20:00' }, from, Math.ceil((to - from) / 86_400_000))
    else if (s.updateText) expected = expectedTimes(parseUpdateText(s.updateText), from, Math.ceil((to - from) / 86_400_000))
    for (const t of expected) {
      if (t < from || t >= to || t < now - 3600_000) continue
      if (out.some((x) => x.id === s.showId && x.source === 'subscription' && dateKey(x.onlineAt) === dateKey(t))) continue
      out.push({ ...base, episodes: '预计更新', time: hhmm(t), onlineAt: t, status: 'pending' })
    }
  }
  return out.sort((a, b) => a.onlineAt - b.onlineAt)
}
