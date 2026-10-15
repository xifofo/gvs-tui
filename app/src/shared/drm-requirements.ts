/**
 * Which platforms use the user's own DRM device files and where Widevine L1 is
 * required. Mirrors the gateway: dataplane drmWidevineProviders /
 * drmPlayReadyProviders, appletvplus widevineLevelFor (>1080p, HDR, DV need L1)
 * and dsnp requestTier (default tier is L1; an L3 file fails with 412
 * DRM_CLIENT_DEVICE_LEVEL, never a silent downgrade). The gateway exposes no
 * per-platform level metadata yet, so keep this table in sync with it.
 */
export type DRMRequirement = {
  provider: string
  name: string
  widevine: boolean
  playready: boolean
  /** Which qualities need a Widevine L1 file; absent when L3 is enough. */
  l1?: string
  note?: string
}

export const DRM_REQUIREMENTS: DRMRequirement[] = [
  { provider: 'appletvplus', name: 'Apple TV', widevine: true, playready: true, l1: '4K / HDR / 杜比视界', note: '同时上传时优先使用 .prd' },
  { provider: 'dsnp', name: 'Disney+', widevine: true, playready: false, l1: '默认画质（含 4K / HDR）' },
  { provider: 'friday', name: 'friDay影音', widevine: true, playready: false },
  { provider: 'hamivideo', name: 'HamiVideo', widevine: true, playready: false },
  { provider: 'linetv', name: 'LINE TV', widevine: true, playready: false },
]

export function drmRequirement(provider: string): DRMRequirement | undefined {
  return DRM_REQUIREMENTS.find((r) => r.provider === provider)
}

/** Short label such as "4K / HDR 需 L1" for chips; empty when L3 is enough. */
export function l1Badge(provider: string): string {
  const r = drmRequirement(provider)
  return r?.l1 ? `${r.l1} 需 L1` : ''
}

/** One line for drawers: which device files the platform uses. */
export function drmSummary(provider: string): string {
  const r = drmRequirement(provider)
  if (!r) return ''
  const files = [r.playready && 'PlayReady .prd', r.widevine && 'Widevine .wvd'].filter(Boolean).join(' 或 ')
  return `${files}${r.widevine ? (r.l1 ? `；Widevine ${r.l1}需要 L1，L3 只能下载其他画质` : '；L1 / L3 均可') : ''}${r.note ? `；${r.note}` : ''}`
}