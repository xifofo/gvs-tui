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
        const id = str(x.jumpId) || str(x.aid)
        return {
          provider: 'mgtv',
          id,
          title: str(x.title),
          info: str(x.info),
          episodes: str(x.series) || str(x.rightBottom),
          time: str(x.beginTime),
          onlineAt: (Number(x.onlineTime) || 0) * 1000,
          onlineText: str(x.onlineText),
          poster: str(x.imgVer) || str(x.img),
          posterHor: str(x.imgHor),
          url: id ? `https://www.mgtv.com/h/${id}.html` : '',
          source: 'platform' as const,
        }
      })
      .sort((a, b) => a.time.localeCompare(b.time))
    out.push({ date, weekday: str(d.desc), today: date === today, items })
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
