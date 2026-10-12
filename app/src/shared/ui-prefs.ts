/**
 * Desktop-only UI preferences, persisted in tui.json under `desktopUi`.
 * Pure data + sanitizers so main process and renderer agree and tests can cover them.
 */
export type QualityCap = 'best' | '2160' | '1080' | '720'

export type UiPrefs = {
  /** Sidebar collapsed to the 64px icon rail. */
  sidebarCollapsed: boolean
  /** User-defined provider order (unknown ids are ignored, missing ids appended in default order). */
  providerOrder: string[]
  /** Providers the user hid: not searched, not shown in Discover / sidebar dots / onboarding. */
  hiddenProviders: string[]
  /** Most recent first, de-duplicated, capped at RECENT_LIMIT. */
  recentSearches: string[]
  /** Default quality pick on the quality panel: highest available at or below this height. */
  defaultQuality: QualityCap
}

export const RECENT_LIMIT = 12
const QUALITY_CAPS: QualityCap[] = ['best', '2160', '1080', '720']

export const DEFAULT_UI_PREFS: UiPrefs = {
  sidebarCollapsed: false,
  providerOrder: [],
  hiddenProviders: [],
  recentSearches: [],
  defaultQuality: 'best',
}

const strList = (v: unknown, limit = 64): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const s = item.trim().slice(0, 200)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= limit) break
  }
  return out
}

/** Accepts anything read from disk / IPC and returns a complete, valid UiPrefs. */
export function sanitizeUiPrefs(raw: unknown): UiPrefs {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    sidebarCollapsed: r.sidebarCollapsed === true,
    providerOrder: strList(r.providerOrder),
    hiddenProviders: strList(r.hiddenProviders),
    recentSearches: strList(r.recentSearches, RECENT_LIMIT),
    defaultQuality: QUALITY_CAPS.includes(r.defaultQuality as QualityCap) ? (r.defaultQuality as QualityCap) : 'best',
  }
}

/** Merge a partial patch over current prefs, then sanitize. */
export function mergeUiPrefs(current: unknown, patch: Partial<UiPrefs> | undefined): UiPrefs {
  return sanitizeUiPrefs({ ...sanitizeUiPrefs(current), ...(patch ?? {}) })
}

/** Put a query at the front of the recent list (case/space-insensitive de-dup). */
export function pushRecent(list: string[], query: string, limit = RECENT_LIMIT): string[] {
  const q = query.trim().replace(/\s+/g, ' ')
  if (!q) return list.slice(0, limit)
  const key = q.toLowerCase()
  return [q, ...list.filter((x) => x.trim().replace(/\s+/g, ' ').toLowerCase() !== key)].slice(0, limit)
}

/**
 * Index of the quality to pre-select. Qualities come best-first from the probe.
 * 'best' → 0; otherwise the first entry whose height is at or below the cap; if every entry is above
 * the cap (or heights are unknown), fall back to the last entry with a known height ≤ cap, else 0.
 */
export function preferredQualityIndex(qualities: ReadonlyArray<{ height: number }>, cap: QualityCap): number {
  if (!qualities.length || cap === 'best') return 0
  const limit = Number(cap)
  const i = qualities.findIndex((q) => q.height > 0 && q.height <= limit)
  return i >= 0 ? i : 0
}
