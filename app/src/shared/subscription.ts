/**
 * 订阅：数据模型 + 检查调度（纯函数，可测试）。
 * 状态沿用 MoviePilot：N 新建（还没检查过）· R 订阅中 · P 待定（未开播 / 等待播出窗口） · S 已停止（暂停或已完结）
 */
export type SubState = 'N' | 'R' | 'P' | 'S'
export const SUB_STATE_LABEL: Record<SubState, string> = { N: '新建', R: '订阅中', P: '待定', S: '已停止' }

/** 检查窗口：null/undefined = 跟随全局间隔 */
export type CheckWindow =
  | { kind: 'interval'; minutes: number }
  /** days: 0=周日 … 6=周六；start/end 'HH:MM'（end < start 表示跨零点）；窗口内每 minutes 分钟查一次 */
  | { kind: 'weekly'; days: number[]; start: string; end: string; minutes: number }
  /** 每集预计上线时间（毫秒时间戳）；从该时间起 graceMinutes 内每 minutes 查一次 */
  | { kind: 'episodes'; times: number[]; graceMinutes: number; minutes: number }

export type SubEpisode = { vid: string; number: number; title: string; firstSeen: number; downloaded?: { tier: number; label: string; at: number } }

export type SubCheck = { at: number; ok: boolean; ms: number; message: string; found: number }

export type Subscription = {
  id: string
  provider: string
  showId: string
  title: string
  poster: string
  kind: 'movie' | 'show'
  state: SubState
  /** 用户手动暂停（state 会是 S） */
  paused: boolean
  rules: string
  autoDownload: boolean
  upgrade: boolean
  window?: CheckWindow | null
  /** 平台的更新说明，例如「更新至08集 每日19:30更新」 */
  updateText: string
  total: number
  episodes: SubEpisode[]
  /** 未查看的新集数（界面「有更新」角标） */
  newCount: number
  lastCheck: SubCheck | null
  nextCheckAt: number
  createdAt: number
}

export type SubscribeRequest = Pick<Subscription, 'provider' | 'showId' | 'title' | 'poster' | 'kind'> &
  Partial<Pick<Subscription, 'rules' | 'autoDownload' | 'upgrade' | 'window'>>
export type SubscriptionPatch = Partial<Pick<Subscription, 'rules' | 'autoDownload' | 'upgrade' | 'window' | 'paused' | 'title'>>

export type SubsView = {
  subs: Subscription[]
  paused: boolean
  intervalMinutes: number
  running: boolean
  lastRunAt: number
}

export const DEFAULT_INTERVAL_MIN = 5
const MIN = 60_000
const DAY = 86_400_000

export const subKey = (provider: string, showId: string) => `${provider}:${showId}`

export function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim())
  if (!m) return 0
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]))
}

/** now 所在的周窗口 [start, end)（毫秒），不在窗口内返回 null */
export function weeklyWindowAt(w: Extract<CheckWindow, { kind: 'weekly' }>, now: number): [number, number] | null {
  const s = hm(w.start)
  let e = hm(w.end)
  if (e === s) e = s + 24 * 60
  const span = (e > s ? e - s : e + 24 * 60 - s) * MIN
  // 今天或昨天开始的窗口都可能覆盖 now（跨零点）
  for (const back of [0, 1]) {
    const d = new Date(now - back * DAY)
    d.setHours(0, 0, 0, 0)
    if (!w.days.includes(d.getDay())) continue
    const st = d.getTime() + s * MIN
    if (now >= st && now < st + span) return [st, st + span]
  }
  return null
}

/** 下一个周窗口的开始时间（严格晚于 now） */
export function nextWeeklyStart(w: Extract<CheckWindow, { kind: 'weekly' }>, now: number): number {
  if (!w.days.length) return Infinity
  const s = hm(w.start)
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + i)
    if (!w.days.includes(d.getDay())) continue
    const st = d.getTime() + s * MIN
    if (st > now) return st
  }
  return Infinity
}

/**
 * 下次检查时间。
 * - 无窗口 / interval：上次检查 + 间隔（没检查过 = 立刻）
 * - weekly：在窗口内按窗口频率；窗口外等下一个窗口开始
 * - episodes：在任意一集的 [上线, 上线 + grace) 内按频率；否则等下一集上线；全部过去后每 6 小时兜底查一次
 * 返回值不早于 now。
 */
export function nextCheckAt(sub: Pick<Subscription, 'window' | 'lastCheck' | 'paused' | 'state'>, now: number, globalMinutes = DEFAULT_INTERVAL_MIN): number {
  if (sub.paused) return Infinity
  const last = sub.lastCheck?.at ?? 0
  const w = sub.window
  const every = (m: number) => Math.max(1, m || globalMinutes) * MIN
  if (!w || w.kind === 'interval') {
    const base = last ? last + every(w?.minutes ?? globalMinutes) : now
    return Math.max(now, base)
  }
  if (w.kind === 'weekly') {
    const win = weeklyWindowAt(w, now)
    if (win) {
      const due = last ? last + every(w.minutes) : now
      if (due < win[1]) return Math.max(now, due, win[0])
    }
    const ns = nextWeeklyStart(w, now)
    return Number.isFinite(ns) ? ns : Math.max(now, last + every(globalMinutes))
  }
  const grace = Math.max(1, w.graceMinutes || 120) * MIN
  const times = [...w.times].sort((a, b) => a - b)
  const active = times.find((t) => now >= t && now < t + grace)
  if (active !== undefined) {
    const due = last ? last + every(w.minutes) : now
    if (due < active + grace) return Math.max(now, due, active)
  }
  const upcoming = times.find((t) => t > now)
  if (upcoming !== undefined) return upcoming
  return Math.max(now, (last || now) + 6 * 60 * MIN)
}

export const isDue = (sub: Parameters<typeof nextCheckAt>[0], now: number, globalMinutes?: number) => nextCheckAt(sub, now, globalMinutes) <= now

/** 详情返回的集 → 和已知集合比较出新集（按 vid，忽略预告/花絮栏目） */
export function diffEpisodes(known: SubEpisode[], latest: Array<{ vid: string; number: number; title: string; collection?: string }>): Array<{ vid: string; number: number; title: string }> {
  const seen = new Set(known.map((e) => e.vid))
  return latest.filter((e) => e.vid && !seen.has(e.vid) && (!e.collection || e.collection === '正片'))
}

/** ±20% 抖动，避免所有订阅同一秒打网关 */
export function jitter(ms: number, rand = Math.random): number {
  return Math.round(ms * (0.8 + rand() * 0.4))
}

export function windowText(w: CheckWindow | null | undefined, globalMinutes = DEFAULT_INTERVAL_MIN): string {
  if (!w) return `每 ${globalMinutes} 分钟`
  if (w.kind === 'interval') return `每 ${w.minutes} 分钟`
  if (w.kind === 'weekly') {
    const names = '日一二三四五六'
    const days = w.days.length === 7 ? '每天' : '每周' + [...w.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join('')
    return `${days} ${w.start}–${w.end} · 每 ${w.minutes} 分钟`
  }
  return `按集上线时间 · ${w.times.length} 个时间点`
}
