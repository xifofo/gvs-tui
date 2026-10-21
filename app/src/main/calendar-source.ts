import { MGTV_CALENDAR_URL, parseMgtvConf, type CalendarDay } from '../shared/calendar'

/**
 * 芒果 TV 排播兜底：GET playbill.api.mgtv.com/broadcost/conf，免签名免登录，约 15 天。
 * 主路径是网关（Core.calendar → provider=dengta，多平台官方排播）；这里只在网关
 * 未连接或上游失败时接手，保证「发现新剧」至少还有芒果一家的排期。
 * 结果缓存 30 分钟，失败时退回上次成功的数据。
 */
type Result = { days: CalendarDay[]; error: string; fetchedAt: number }
let cache: Result | null = null
const TTL = 30 * 60_000

export async function fetchCalendar(fetcher: typeof fetch = fetch, now = Date.now()): Promise<Result> {
  if (cache && !cache.error && now - cache.fetchedAt < TTL) return cache
  try {
    const res = await fetcher(MGTV_CALENDAR_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.mgtv.com/' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`芒果 TV 排播接口返回 ${res.status}`)
    const days = parseMgtvConf(await res.json(), now)
    if (!days.length) throw new Error('芒果 TV 排播接口没有返回数据')
    cache = { days, error: '', fetchedAt: now }
    return cache
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { days: cache?.days ?? [], error, fetchedAt: cache?.fetchedAt ?? 0 }
  }
}
