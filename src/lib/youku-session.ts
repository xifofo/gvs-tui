// 优酷登录态（网关侧按 Yk-Sign 维度的多租户凭证）。
//
// 网关 `youku/cred` 提供了完整生命周期：`info` 查状态、`refresh` 用
// stoken/ptoken 续期（不需要重新扫码）、`import` 用 cookie 换发新签名、
// `revoke` 作废。TUI 之前只在请求头里塞 Yk-Sign，从来没刷新过，
// 于是 token 一过期就表现为「重启就失效」。
import type { GwClient } from './client.ts'
import { parseYoukuMembership, youkuMembershipText, type YoukuMembership } from './youku-membership.ts'
import { userMessage, errorCode } from './user-message.ts'
import type { VipProbe, VipSource } from '../types.ts'
import { anyInt, asBool, asString, isObj } from './util.ts'

export type YkLogin = {
  ok: boolean
  /** Authoritative expiry, distinct from a temporary status-query failure. */
  needsRelogin?: boolean
  uid: string
  nick: string
  vip: boolean
  refreshable: boolean
  /** 凭证创建时间（毫秒），用于避免刚扫码完立刻强制刷新。 */
  createdAt: number
  /** 上次成功刷新的时间（毫秒），0 表示未知。 */
  lastRefreshAt: number
  lastError: string
  hint: string
}

export type YkRefresh = { refreshed: boolean; needsRelogin: boolean; hint: string }

/** 会员真实状态（来自 `youku/account`，不是登录时的 yktk 快照）。 */
export type YkAccount = {
  /** 网关侧 App 会话可用（search / play 靠它）。 */
  loggedIn: boolean
  loginUnknown?: boolean
  membership?: YoukuMembership
  /** 只有它为真才需要重新扫码。 */
  needsScan: boolean
  /** 会员状态的可信度：api=当前产品记录；none=未知。登录快照不提升会员状态。 */
  vipSource: VipSource
  isVip: boolean
  vipUntil: string
  nick: string
  uid: string
  ytid: string
  mobile: string
  /** 登录方式：qr / cookie / import … */
  method: string
  riskLevel: string
  hint: string
}

/**
 * 查账号与会员状态。三个踩过的坑：
 * - `cred.info` / `yktk.vip` 只是**登录当时的快照**，不能当会员状态；
 * - 会员那几个 mtop 接口要**网页会话**（`P_sck`/cookie2），扫码拿到的是 App 会话，
 *   它们报 `FAIL_SYS_SESSION_EXPIRED` 只说明「查不到会员」，**不代表登录态过期**；
 * - 真正的登录态看 `session.logged_in` + `risk.level`，掉登录时网关自己会说
 *   （`refresh` 的 `needs_relogin`），不要靠猜 ret code。
 */
export async function ykAccount(cli: GwClient, sign: string): Promise<YkAccount> {
  try {
    const data = await cli.invoke('youku', 'account', { method: 'profile', app: 'session' }, sign ? { 'Yk-Sign': sign } : undefined)
    return parseYkAccount(data)
  } catch (e) {
    const out = emptyAccount()
    const msg = e instanceof Error ? e.message : String(e)
    out.needsScan = errorCode(e) === 'RELOGIN_REQUIRED' || /invalid Yk-Sign|re-login|relogin|未登录|YOUKU_RELOGIN_REQUIRED|需要重新登录/i.test(msg)
    out.loggedIn = false
    out.loginUnknown = !out.needsScan
    out.hint = userMessage(e)
    return out
  }
}

export function parseYkAccount(data: Record<string, unknown>): YkAccount {
  const out = emptyAccount()
  const summary = isObj(data.summary) ? data.summary : {}
  const session = isObj(data.session) ? data.session : {}
  const risk = isObj(data.risk) ? data.risk : {}

  const expired = asBool(data.needs_relogin) || asBool(summary.needs_relogin) || asBool(session.needs_relogin)
  const loginFlag = typeof summary.logged_in === 'boolean' ? summary.logged_in : typeof session.logged_in === 'boolean' ? session.logged_in : undefined
  out.loginUnknown = !expired && loginFlag === undefined
  out.loggedIn = !expired && loginFlag === true
  out.nick = asString(summary.nick) || asString(session.nick)
  out.uid = asString(summary.uid) || asString(session.uid)
  out.ytid = asString(summary.ytid) || asString(session.ytid)
  out.mobile = asString(session.mobile)
  out.method = asString(session.method)
  out.riskLevel = asString(risk.level) || 'none'
  out.hint = asString(risk.hint)

  out.membership = parseYoukuMembership(data)
  out.vipSource = out.membership.status === 'unknown' ? 'none' : 'api'
  out.isVip = out.membership.status === 'active'
  out.vipUntil = out.membership.products.length === 1 ? out.membership.products[0]!.endAt.slice(0,10) : ''
  if (out.membership.status === 'unknown') out.hint = '已登录不代表会员有效；普通优酷、酷喵和帧享权益尚未确认'

  // 有 App 凭证就不算掉登录 —— 会员接口失败与登录态无关。
  out.needsScan = expired || loginFlag === false
  return out
}

function emptyAccount(): YkAccount {
  return {
    loggedIn: false, needsScan: false, vipSource: 'none', isVip: false, vipUntil: '',
    nick: '', uid: '', ytid: '', mobile: '', method: '', riskLevel: 'none', hint: '',
  }
}

export function accountSummary(acc: YkAccount | null, probe?: VipProbe): string {
  if (!acc) return '检查中…'
  if (acc.needsScan) return '登录态不可用 · 需重新扫码'
  if (acc.loginUnknown) return '登录状态检查暂不可用 · 会员权益未确认'
  if (!acc.loggedIn) return '未登录 · 需扫码'
  const who = [acc.nick, acc.uid && `uid ${acc.uid}`].filter(Boolean).join(' · ')
  const membership = acc.membership ?? {status:'unknown' as const,products:[]}
  const playback = probe?.hasTrial ? ' · 当前片源仅能试看' : ''
  return [who, '已登录', youkuMembershipText(membership)].filter(Boolean).join(' · ') + playback
}

function view(data: Record<string, unknown>): YkLogin {
  const yk = isObj(data.yktk_fields) ? data.yktk_fields : {}
  return {
    ok: !asBool(data.needs_relogin) && data.logged_in !== false && (asBool(data.logged_in) || asBool(data.has_stoken) || anyInt(data.yktk_len) > 0
      || asString(data.uid) !== '' || asString(data.yktk) !== '' || asBool(yk.vip)),
    needsRelogin: asBool(data.needs_relogin) || data.logged_in === false,
    uid: asString(data.uid),
    nick: asString(data.nick) || asString(yk.nick) || '',
    vip: asBool(yk.vip) || asBool(data.vip),
    refreshable: asBool(data.refreshable) || asBool(data.has_ptoken),
    createdAt: normalizeMillis(data.created_at),
    lastRefreshAt: Number(data.last_refresh_at ?? 0) || 0,
    lastError: asString(data.last_refresh_error),
    hint: asString(data.hint),
  }
}

/** 当前 Yk-Sign 的登录态摘要（yktk 层面的快照，会员状态请用 ykAccount）。 */
export async function ykLoginInfo(cli: GwClient, sign: string): Promise<YkLogin> {
  try {
    const data = await cli.invoke('youku', 'cred', { method: 'info' }, sign ? { 'Yk-Sign': sign } : undefined)
    return view(data)
  } catch (e) {
    return {
      ok: false, uid: '', nick: '', vip: false, refreshable: false, createdAt: 0, lastRefreshAt: 0,
      lastError: '', needsRelogin: ['RELOGIN_REQUIRED', 'YOUKU_RELOGIN_REQUIRED'].includes(errorCode(e)), hint: e instanceof Error ? e.message : String(e),
    }
  }
}

/** 自动续期：旧凭证从未刷新过，或距离上次刷新超过 20 分钟。 */
export function shouldRefreshYouku(info: YkLogin | null, now = Date.now()): boolean {
  if (!info?.ok || info.needsRelogin || !info.refreshable) return false
  if (info.lastRefreshAt > 0) return now - info.lastRefreshAt > 20 * 60_000
  // QR 完成后的最初一分钟不强刷；否则 ptoken 尚未完全落库时可能误报重登。
  return info.createdAt > 0 && now - info.createdAt > 60_000
}

function normalizeMillis(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 10_000_000_000 ? n * 1000 : n
}

/** 续期。`needsRelogin` 为真才需要重新扫码。 */
export async function ykRefresh(cli: GwClient, sign: string): Promise<YkRefresh> {
  const data = await cli.invoke('youku', 'refresh', { method: 'refresh' }, sign ? { 'Yk-Sign': sign } : undefined)
  return {
    refreshed: asBool(data.refreshed),
    needsRelogin: asBool(data.needs_relogin),
    hint: asString(data.hint),
  }
}

export function loginSummary(info: YkLogin, now = Date.now()): string {
  if (!info.ok) return info.hint ? `需重新扫码（${info.hint}）` : '未登录 / 需扫码'
  const who = [info.nick, info.uid && `uid ${info.uid}`].filter(Boolean).join(' · ')
  const when = info.lastRefreshAt > 0 ? `上次续期 ${ago(info.lastRefreshAt, now)} · ` : ''
  const warn = info.lastError ? ` · 上次刷新失败：${info.lastError}` : ''
  return `${info.refreshable ? '可续期' : '不可续期'} · ${when}${who}${warn}`
}

function ago(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60000))
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  return `${Math.round(mins / 60)} 小时前`
}
