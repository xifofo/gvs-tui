/** Shared, transport-free provider metadata for terminal and desktop clients. */
export const PROVIDER_IDS = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'mewatch', 'hamivideo', 'friday', 'linetv', 'iq', 'iqcn', 'mgtv', 'bilibili', 'migu', 'appletvplus', 'dsnp'] as const
export type ProviderID = (typeof PROVIDER_IDS)[number]
export const PROVIDER_LABELS: Record<string, string> = {
  youku: '优酷', tencent: '腾讯', hongguo: '红果', huangguo: '黄果', douyin: '抖音',
  mewatch: 'mewatch', hamivideo: 'HamiVideo', friday: 'friDay影音', linetv: 'LINE TV',
  iq: 'IQ 海外版',
  iqcn: '爱奇艺国内版',
  mgtv: '芒果 TV', bilibili: '哔哩哔哩', migu: '咪咕视频',
  appletvplus: 'Apple TV',
  dsnp: 'Disney+',
}
/** Disney+ is account-only in the desktop app for now: no browse / search / download wiring yet. */
export const accountOnly = (_provider: string): boolean => false

/**
 * Logins the客户端 can live without. 爱奇艺国内版（iqcn）扫码已经覆盖 iQ 内容的国内车道，
 * 所以 IQ 海外版登录只在 iq.com 独播内容时才需要。
 */
export const OPTIONAL_LOGIN_PROVIDERS = ['iq'] as const
export const isOptionalLogin = (provider: string): boolean =>
  (OPTIONAL_LOGIN_PROVIDERS as readonly string[]).includes(provider)

/** Login surfaces show the domestic scan first, the optional overseas account after it. */
export const LOGIN_PRIORITY = ['iqcn', 'iq'] as const
export function loginPriority(provider: string): number {
  const index = (LOGIN_PRIORITY as readonly string[]).indexOf(provider)
  return index < 0 ? LOGIN_PRIORITY.length : index
}

/** One-line note shown next to theIQ / 爱奇艺 login buttons. */
export const PROVIDER_LOGIN_NOTES: Record<string, string> = {
  iqcn: '爱奇艺 App 扫码；同一 API Key 下同时作为 iQ 内容的国内车道凭据',
  iq: '可选：仅 iq.com 独播内容需要；国内内容扫码登录爱奇艺国内版即可',
}
export const providerLoginNote = (provider: string): string => PROVIDER_LOGIN_NOTES[provider] ?? ''

export const supportsSearch = (provider: string): boolean => provider !== 'hamivideo' && provider !== 'appletvplus' && !accountOnly(provider)
export const supportsBrowse = (provider: string): boolean => provider !== 'hamivideo' && !accountOnly(provider)
export const isManifestProvider = (provider: string): boolean => provider === 'mewatch' || provider === 'hamivideo' || provider === 'friday' || provider === 'linetv' || provider === 'appletvplus' || provider === 'dsnp'
/** Providers with the shared movie/series type and optional TMDB naming workflow. */
export const supportsTmdb = (provider: string | undefined): boolean => ['youku','tencent','iq','iqcn','mgtv','bilibili','migu'].includes(provider || '')
