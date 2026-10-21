/**
 * Data-driven provider registry for the desktop account center / onboarding.
 * Declares how each platform signs in, so the UI does not hard-code per-platform button rows.
 */
export type LoginMethod = 'qr' | 'cookie' | 'token' | 'password' | 'tv-code' | 'sms' | 'none'

export type ProviderMeta = {
  id: string
  /** Login methods the gateway/desktop actually supports today, in preferred order. */
  methods: LoginMethod[]
  /** Works without any login (anonymous or public API). */
  loginOptional: boolean
  /**
   * Optional login: the client works without it. 爱奇艺国内版（iqcn）扫码已覆盖 iQ 内容的
   * 国内车道，所以 IQ 海外版只在 iq.com 独播内容时才需要。
   */
  optional?: boolean
  /** Network / region hint shown on the account card. */
  region?: string
  /** One line about what logging in unlocks. */
  benefit: string
  /** Gateway supports several accounts per platform for one API key. None do yet. */
  multiAccount: boolean
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  youku: { id: 'youku', methods: ['qr'], loginOptional: false, region: '请求从本机出网', benefit: '扫码后可下载会员片源', multiAccount: false },
  tencent: { id: 'tencent', methods: ['qr', 'cookie'], loginOptional: false, region: '请求从本机出网', benefit: '登录后可下载会员画质', multiAccount: false },
  iq: { id: 'iq', methods: ['password', 'cookie'], loginOptional: true, optional: true, region: '需要台湾 / 海外网络节点', benefit: '可选：仅 iq.com 独播内容需要；国内内容用爱奇艺国内版扫码即可', multiAccount: false },
  iqcn: { id: 'iqcn', methods: ['qr'], loginOptional: false, benefit: '爱奇艺 App 扫码，网关按 Key 保存；同一 Key 下同时供 iQ 内容的国内车道', multiAccount: false },
  mgtv: { id: 'mgtv', methods: ['qr'], loginOptional: false, benefit: '芒果 TV App 扫码', multiAccount: false },
  bilibili: { id: 'bilibili', methods: ['qr', 'cookie'], loginOptional: true, benefit: '匿名可用；登录后解锁高画质', multiAccount: false },
  migu: { id: 'migu', methods: ['qr'], loginOptional: false, benefit: '合并 TV 4K 与 App HDR Vivid 画质', multiAccount: false },
  mewatch: { id: 'mewatch', methods: ['tv-code'], loginOptional: false, region: '新加坡区域内容', benefit: '官方设备激活', multiAccount: false },
  hamivideo: { id: 'hamivideo', methods: ['cookie', 'sms'], loginOptional: false, region: '台湾区域内容', benefit: 'Web / TV 会话独立', multiAccount: false },
  friday: { id: 'friday', methods: ['qr', 'cookie'], loginOptional: false, region: '台湾区域内容（需台湾出口）', benefit: '榜单免登录；TV 会话解锁 4K', multiAccount: false },
  linetv: { id: 'linetv', methods: ['cookie'], loginOptional: true, region: '台湾区域内容（需台湾出口）', benefit: '匿名可看 SD；导入 Cookie 解锁会员 / FHD', multiAccount: false },
  douyin: { id: 'douyin', methods: ['cookie'], loginOptional: true, benefit: '网页 Cookie（需含 sessionid）', multiAccount: false },
  hongguo: { id: 'hongguo', methods: ['none'], loginOptional: true, benefit: '公开接口，无需账号', multiAccount: false },
  huangguo: { id: 'huangguo', methods: ['none'], loginOptional: true, benefit: '公开接口，无需账号', multiAccount: false },
  dsnp: { id: 'dsnp', methods: ['password', 'cookie'], loginOptional: false, benefit: '', multiAccount: false },
  appletvplus: { id: 'appletvplus', methods: ['cookie'], loginOptional: true, region: '目录跟随账号地区，未登录默认美国', benefit: '导入官网登录态后查看可用画质并下载', multiAccount: false },
  crunchyroll: { id: 'crunchyroll', methods: ['token'], loginOptional: true, region: '内容与订阅跟随 CR 账号地区', benefit: '导入本人 refresh_token 后可下载；需本人 Widevine .wvd', multiAccount: false },
}

export const METHOD_LABEL: Record<LoginMethod, string> = {
  qr: '扫码登录', cookie: '导入 Cookie', token: '导入令牌', password: '账号密码', 'tv-code': '设备激活码', sms: '短信验证', none: '无需登录',
}

export function providerMeta(id: string): ProviderMeta {
  return PROVIDER_META[id] ?? { id, methods: ['none'], loginOptional: true, benefit: '', multiAccount: false }
}

/** Apply the user's saved order: known ids in saved order first, then the rest in their original order. */
export function orderProviders<T extends string>(available: readonly T[], order: readonly string[]): T[] {
  const set = new Set(available)
  const head = order.filter((p): p is T => set.has(p as T))
  const seen = new Set<string>(head)
  return [...new Set(head), ...available.filter((p) => !seen.has(p))]
}

/** Ordered and without hidden ones. */
export function visibleProviders<T extends string>(available: readonly T[], prefs: { providerOrder: readonly string[]; hiddenProviders: readonly string[] }): T[] {
  const hidden = new Set(prefs.hiddenProviders)
  return orderProviders(available, prefs.providerOrder).filter((p) => !hidden.has(p))
}

/**
 * Optional-login platforms (currently IQ 海外版) come after the ones the client
 * really needs, so 爱奇艺国内版 shows up first. Sorting is stable, so the user's
 * own order is preserved inside each group.
 */
export function optionalLast<T extends string>(available: readonly T[]): T[] {
  return [...available].sort((a, b) => Number(!!providerMeta(a).optional) - Number(!!providerMeta(b).optional))
}

/** Move one id up/down inside an order list built from `available`. Returns the new full order. */
export function moveProvider(available: readonly string[], order: readonly string[], id: string, delta: -1 | 1): string[] {
  const list = orderProviders(available, order)
  const i = list.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  return list
}

export type AccountTone = 'ok' | 'warn' | 'err' | 'muted'
export type AccountLike = { provider: string; tone: AccountTone; short: string; summary: string }

/** Accounts that need the user's attention (expired / not logged in where login matters / VIP check failed). */
export function needsAttention(a: AccountLike): boolean {
  if (a.tone === 'err' || a.tone === 'warn') return true
  if (a.tone === 'muted' && !providerMeta(a.provider).loginOptional && /待登录|未登录|需扫码|失效|过期/.test(a.short + a.summary)) return true
  return false
}

/** Compact status bucket used for card filters and sidebar dots. */
export function accountBucket(a: AccountLike): 'ok' | 'attention' | 'idle' {
  if (a.tone === 'ok') return 'ok'
  return needsAttention(a) ? 'attention' : 'idle'
}
