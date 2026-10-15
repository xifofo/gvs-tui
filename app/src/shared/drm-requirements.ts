/**
 * Which platforms use the user's own DRM device files and where Widevine L1 is
 * required. Mirrors the gateway: dataplane drmWidevineProviders /
 * drmPlayReadyProviders, appletvplus widevineLevelFor (>1080p, HDR, DV need L1)
 * and dsnp requestTier (default tier is L1; an L3 file fails with 412
 * DRM_CLIENT_DEVICE_LEVEL, never a silent downgrade). The gateway exposes no
 * per-platform level metadata yet, so keep this table in sync with it.
 */
import type { DRMGatewayRequirement, DRMLevelRule } from '../../../src/lib/drm-types'

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

let active: DRMRequirement[] = DRM_REQUIREMENTS
/** Install the table a gateway returned (null keeps the fallback). */
export function useRequirements(list: DRMRequirement[] | null): void { active = list ?? DRM_REQUIREMENTS }
export function activeRequirements(): DRMRequirement[] { return active }

export function drmRequirement(provider: string): DRMRequirement | undefined {
  return active.find((r) => r.provider === provider)
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
/** Gateway-provided table wins; the static table above is only for older gateways. */
export function fromGateway(list: DRMGatewayRequirement[] | undefined): DRMRequirement[] | null {
  if (!Array.isArray(list) || !list.length) return null
  const out: DRMRequirement[] = []
  for (const r of list) {
    if (!r || typeof r.provider !== 'string' || !Array.isArray(r.systems)) continue
    const known = DRM_REQUIREMENTS.find((d) => d.provider === r.provider)
    const l1 = r.widevineL1 ? (r.widevineL1.summary || describeRule(r.widevineL1)) : undefined
    const sl = r.playReadyMin ? `PlayReady SL${r.playReadyMin}${r.playReadyRule?.summary ? `（${r.playReadyRule.summary}）` : ''}` : undefined
    out.push({
      provider: r.provider,
      name: known?.name ?? r.provider,
      widevine: r.systems.includes('widevine'),
      playready: r.systems.includes('playready'),
      l1,
      note: [r.systems.length > 1 ? `同时上传时优先使用 ${r.systems[0] === 'playready' ? '.prd' : '.wvd'}` : '', sl ? `需要 ${sl}` : ''].filter(Boolean).join('；') || undefined,
    })
  }
  return out.length ? out : null
}

function describeRule(r: DRMLevelRule): string {
  return [r.aboveHeight ? `${r.aboveHeight}p 以上` : '', r.hdr ? 'HDR' : '', r.dolbyVision ? '杜比视界' : '', ...(r.tiers ?? [])].filter(Boolean).join(' / ')
}