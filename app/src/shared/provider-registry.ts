/**
 * Data-driven provider registry for the desktop account center / onboarding.
 * Declares how each platform signs in, so the UI does not hard-code per-platform button rows.
 */
export type LoginMethod = 'qr' | 'cookie' | 'password' | 'tv-code' | 'sms' | 'none'

export type ProviderMeta = {
  id: string
  /** Login methods the gateway/desktop actually supports today, in preferred order. */
  methods: LoginMethod[]
  /** Works without any login (anonymous or public API). */
  loginOptional: boolean
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
  iq: { id: 'iq', methods: ['password', 'cookie'], loginOptional: false, region: '需要台湾 / 海外网络节点', benefit: '普通话独立音轨与字幕随下载合流', multiAccount: false },
  iqcn: { id: 'iqcn', methods: ['qr'], loginOptional: false, benefit: '爱奇艺 App 扫码，网关按 Key 保存', multiAccount: false },
  mgtv: { id: 'mgtv', methods: ['qr'], loginOptional: false, benefit: '芒果 TV App 扫码', multiAccount: false },
  bilibili: { id: 'bilibili', methods: ['qr', 'cookie'], loginOptional: true, benefit: '匿名可用；登录后解锁高画质', multiAccount: false },
  migu: { id: 'migu', methods: ['qr'], loginOptional: false, benefit: '合并 TV 4K 与 App HDR Vivid 画质', multiAccount: false },
  mewatch: { id: 'mewatch', methods: ['tv-code'], loginOptional: false, region: '新加坡区域内容', benefit: '官方设备激活', multiAccount: false },
  hamivideo: { id: 'hamivideo', methods: ['cookie', 'sms'], loginOptional: false, region: '台湾区域内容', benefit: 'Web / TV 会话独立', multiAccount: false },
  douyin: { id: 'douyin', methods: ['cookie'], loginOptional: true, benefit: '网页 Cookie（需含 sessionid）', multiAccount: false },
  hongguo: { id: 'hongguo', methods: ['none'], loginOptional: true, benefit: '公开接口，无需账号', multiAccount: false },
  huangguo: { id: 'huangguo', methods: ['none'], loginOptional: true, benefit: '公开接口，无需账号', multiAccount: false },
}

export const METHOD_LABEL: Record<LoginMethod, string> = {
  qr: '扫码登录', cookie: '导入 Cookie', password: '账号密码', 'tv-code': '设备激活码', sms: '短信验证', none: '无需登录',
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
