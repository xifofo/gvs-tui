/** Apple TV storefronts the gateway accepts (`country` / `itua`). */
export const APPLE_TV_REGIONS = ['hk', 'tw', 'jp', 'us', 'gb', 'au', 'ca', 'tr'] as const
export type AppleTVRegion = (typeof APPLE_TV_REGIONS)[number]

/** Region labels for pickers; keep in sync with APPLE_TV_REGIONS. */
export const APPLE_TV_REGION_LABELS: Record<AppleTVRegion, string> = {
  hk: '香港',
  tw: '台湾',
  jp: '日本',
  us: '美国',
  gb: '英国',
  au: '澳大利亚',
  ca: '加拿大',
  tr: '土耳其',
}

export const isAppleTVRegion = (value: string): value is AppleTVRegion =>
  (APPLE_TV_REGIONS as readonly string[]).includes(value)

/**
 * Build a transient Apple TV Cookie from a pasted media token and explicit region.
 *
 * The region is the ACCOUNT storefront (it drives the licence delivery service),
 * which can differ from the storefront a title is browsed from — the gateway
 * takes that separately via `country` on play/download.
 */
export function appleTVImportCookie(value: string, country?: string): string {
  const text = value.trim()
  if (/^0\.[A-Za-z0-9+/_=-]{20,}$/.test(text)) {
    const region = (country || '').toLowerCase()
    if (!isAppleTVRegion(region)) throw new Error('请选择 Apple 账号地区后导入媒体令牌')
    return `itua=${region.toUpperCase()}; media-user-token=${text}`
  }
  if (/\r|\n/.test(text) && !text.includes('\t') && !text.startsWith('[') && !text.startsWith('{')) throw new Error('Cookie 中包含无效换行')
  return text
}
