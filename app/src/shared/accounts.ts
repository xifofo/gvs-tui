/**
 * 多账号（桌面端）：每个平台可以有多个账号槽位，其中一个是默认账号、一个是当前在网关生效的账号。
 *
 * 网关是瘦客户端模型：每个 API Key 每个平台只托管一份会话。所以「切换账号」=
 * 把该槽位保存的凭证（Cookie，经 Electron safeStorage 加密存本机）重新导入网关；
 * 扫码登录的槽位拿不到凭证原文，切换时需要重新扫码（复用原有扫码流程）。
 * 本文件只有纯数据与纯函数，主进程与界面共用，方便测试。
 */
export type AccountMode = 'cookie' | 'qr' | 'gateway'

export type AccountStatus = { short: string; summary: string; tone: 'ok' | 'warn' | 'err' | 'muted'; vipUntil: number; checkedAt: number }

export type AccountSlot = {
  id: string
  provider: string
  name: string
  /** cookie：本机加密保存了凭证，可一键切换；qr：切换需重新扫码；gateway：迁移前已在网关的会话 */
  mode: AccountMode
  hasSecret: boolean
  createdAt: number
  status: AccountStatus | null
}

export type AccountBook = {
  version: 1
  slots: AccountSlot[]
  /** provider → 默认账号 id */
  defaults: Record<string, string>
  /** provider → 当前在网关生效的账号 id */
  active: Record<string, string>
}

/** 能用 Cookie 导入网关、因而能本机保存并一键切换的平台 */
export const COOKIE_PROVIDERS = ['tencent', 'douyin', 'iq', 'bilibili'] as const
export const supportsCookieSlot = (p: string) => (COOKIE_PROVIDERS as readonly string[]).includes(p)
/** 免登录平台不需要账号槽位 */
export const NO_LOGIN = ['hongguo', 'huangguo']

export const emptyBook = (): AccountBook => ({ version: 1, slots: [], defaults: {}, active: {} })

const uid = (provider: string, now: number, n: number) => `${provider}-${now.toString(36)}${n ? '-' + n : ''}`

export function sanitizeBook(raw: unknown): AccountBook {
  const b = raw as Partial<AccountBook> | null
  if (!b || typeof b !== 'object' || !Array.isArray(b.slots)) return emptyBook()
  const slots = b.slots.filter((s): s is AccountSlot => !!s && typeof s.id === 'string' && typeof s.provider === 'string').map((s) => ({
    id: s.id, provider: s.provider, name: String(s.name || '账号').slice(0, 40),
    mode: (['cookie', 'qr', 'gateway'] as const).includes(s.mode) ? s.mode : 'gateway',
    hasSecret: !!s.hasSecret, createdAt: Number(s.createdAt) || 0, status: s.status ?? null,
  }))
  const ids = new Set(slots.map((s) => s.id))
  const pick = (m: unknown) => Object.fromEntries(Object.entries((m as Record<string, string>) ?? {}).filter(([, id]) => ids.has(id)))
  return fixDefaults({ version: 1, slots, defaults: pick(b.defaults), active: pick(b.active) })
}

/** 每个有槽位的平台都要有默认与生效账号 */
function fixDefaults(b: AccountBook): AccountBook {
  for (const p of new Set(b.slots.map((s) => s.provider))) {
    const first = b.slots.find((s) => s.provider === p)!.id
    if (!b.defaults[p]) b.defaults[p] = first
    if (!b.active[p]) b.active[p] = b.defaults[p]!
  }
  return b
}

/**
 * 旧版单账号 → 多账号：网关里已有的会话变成每个平台的「默认账号」（gateway 模式），
 * 不读取、不删除任何凭证，所以不会丢东西。已迁移过的平台保持不变。
 */
export function migrateBook(book: AccountBook | null | undefined, providers: string[], now = Date.now()): { book: AccountBook; changed: boolean } {
  const b = sanitizeBook(book ?? emptyBook())
  let changed = !book
  for (const p of providers) {
    if (NO_LOGIN.includes(p) || b.slots.some((s) => s.provider === p)) continue
    b.slots.push({ id: uid(p, now, 0), provider: p, name: '默认账号', mode: 'gateway', hasSecret: false, createdAt: now, status: null })
    changed = true
  }
  return { book: fixDefaults(b), changed }
}

export function slotsOf(b: AccountBook, provider: string): AccountSlot[] {
  const d = b.defaults[provider]
  return b.slots.filter((s) => s.provider === provider).sort((x, y) => Number(y.id === d) - Number(x.id === d) || x.createdAt - y.createdAt)
}

export function addSlot(b: AccountBook, provider: string, name: string, mode: AccountMode, hasSecret: boolean, now = Date.now()): { book: AccountBook; slot: AccountSlot } {
  const taken = new Set(b.slots.map((s) => s.id))
  let n = 0
  while (taken.has(uid(provider, now, n))) n++
  const count = b.slots.filter((s) => s.provider === provider).length
  const slot: AccountSlot = { id: uid(provider, now, n), provider, name: name.trim().slice(0, 40) || `账号 ${count + 1}`, mode, hasSecret, createdAt: now, status: null }
  return { book: fixDefaults({ ...b, slots: [...b.slots, slot] }), slot }
}

export function renameSlot(b: AccountBook, id: string, name: string): AccountBook {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('账号名称不能为空')
  return { ...b, slots: b.slots.map((s) => (s.id === id ? { ...s, name: n } : s)) }
}

/** 删除；平台的最后一个账号不能删。删掉默认/生效账号时由下一个顶上。 */
export function removeSlot(b: AccountBook, id: string): AccountBook {
  const s = b.slots.find((x) => x.id === id)
  if (!s) return b
  if (b.slots.filter((x) => x.provider === s.provider).length <= 1) throw new Error('每个平台至少保留一个账号')
  const slots = b.slots.filter((x) => x.id !== id)
  const defaults = { ...b.defaults }, active = { ...b.active }
  if (defaults[s.provider] === id) delete defaults[s.provider]
  if (active[s.provider] === id) delete active[s.provider]
  return fixDefaults({ ...b, slots, defaults, active })
}

export function setDefault(b: AccountBook, id: string): AccountBook {
  const s = b.slots.find((x) => x.id === id)
  if (!s) throw new Error('账号不存在')
  return { ...b, defaults: { ...b.defaults, [s.provider]: id } }
}

export function setActive(b: AccountBook, id: string): AccountBook {
  const s = b.slots.find((x) => x.id === id)
  if (!s) throw new Error('账号不存在')
  return { ...b, active: { ...b.active, [s.provider]: id } }
}

export function setStatus(b: AccountBook, id: string, status: AccountStatus): AccountBook {
  return { ...b, slots: b.slots.map((s) => (s.id === id ? { ...s, status } : s)) }
}

/** 用指定账号，空 = 默认账号 */
export function resolveSlot(b: AccountBook, provider: string, id?: string): AccountSlot | undefined {
  return b.slots.find((s) => s.provider === provider && s.id === (id || b.defaults[provider]))
}

/** 会员 / 登录类错误：换个账号可能就好了（爱奇艺 Q00503 / Q00505 等） */
export function isAccountError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '')
  return /Q0050[1-9]|A00001|会员|\bvip\b|未登录|需要登录|请先登录|登录(?:态)?(?:已)?(?:失效|过期)|凭证(?:已)?(?:失效|过期)|重新扫码|not\s*logged|unauthori[sz]ed|\b401\b/i.test(m)
}

/**
 * 失败后的换号顺序：同平台、不是刚失败的那个、能一键切换（有保存的凭证）；默认账号优先，
 * 其次最近检查为正常的。扫码槽位不会自动切换（需要人扫码）。
 */
export function fallbackCandidates(b: AccountBook, provider: string, failedId: string): AccountSlot[] {
  const d = b.defaults[provider]
  const score = (s: AccountSlot) => (s.id === d ? 0 : s.status?.tone === 'ok' ? 1 : s.status ? 3 : 2)
  return b.slots.filter((s) => s.provider === provider && s.id !== failedId && s.mode === 'cookie' && s.hasSecret).sort((x, y) => score(x) - score(y) || x.createdAt - y.createdAt)
}

/** 从平台账号摘要里抠会员到期日：「会员至 2026-12-01」「VIP 到期 2026/12/01」「有效期至2026年12月1日」 */
export function parseVipExpiry(summary: string): number {
  const m = /(?:到期|至|有效期|expire[sd]?)\D{0,6}(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/i.exec(summary || '')
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime()
}

export function statusFrom(view: { short: string; summary: string; tone: AccountStatus['tone'] } | undefined, now = Date.now()): AccountStatus | null {
  if (!view) return null
  return { short: view.short, summary: view.summary, tone: view.tone, vipUntil: parseVipExpiry(view.summary), checkedAt: now }
}

/** 渲染层用：去掉密钥标志之外的东西就是全部，可直接序列化 */
export type AccountsView = { book: AccountBook; encryption: boolean }
