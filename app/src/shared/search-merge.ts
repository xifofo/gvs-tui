/**
 * Merge per-provider search results into one row per show.
 * Key = normalized title (+ year when known). Rows with the same title and compatible years merge.
 */
export type MergeCard = {
  provider: string
  id: string
  title: string
  poster: string
  desc: string
  meta: string
  vip: boolean
  target: 'detail' | 'search' | 'unavailable'
  mediaKind?: 'movie' | 'show'
}

export type ShowRow<C extends MergeCard = MergeCard> = {
  key: string
  title: string
  year: number
  poster: string
  desc: string
  meta: string
  mediaKind?: 'movie' | 'show'
  /** One entry per provider (first hit per provider wins), in provider arrival order. */
  sources: C[]
  /** Best provider rank of any source (lower = better), used for stable sort. */
  rank: number
}

const FULLWIDTH = /[\uff01-\uff5e]/g
/** Normalize for matching: NFKC, full-width → half-width, lowercase, drop spaces/punctuation/brackets. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[《》<>「」『』【】\[\]()（）"'“”‘’·•・:：,，.。!！?？\-—_~\s]/g, '')
}

/** First plausible 4-digit year in meta/title/desc, else 0. */
export function extractYear(...texts: Array<string | undefined>): number {
  for (const t of texts) {
    const m = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/.exec(t ?? '')
    if (m) return Number(m[1])
  }
  return 0
}

const yearsCompatible = (a: number, b: number) => !a || !b || a === b

export function mergeSearch<C extends MergeCard>(groups: ReadonlyArray<{ provider: string; cards: readonly C[] }>): ShowRow<C>[] {
  const rows: ShowRow<C>[] = []
  const byTitle = new Map<string, ShowRow<C>[]>()
  groups.forEach((g) => {
    g.cards.forEach((c, idx) => {
      const norm = normalizeTitle(c.title)
      const year = extractYear(c.meta, c.title)
      const candidates = norm ? byTitle.get(norm) ?? [] : []
      const row = candidates.find((r) => yearsCompatible(r.year, year) && (!r.mediaKind || !c.mediaKind || r.mediaKind === c.mediaKind))
      if (row) {
        if (!row.sources.some((s) => s.provider === c.provider)) row.sources.push(c)
        if (!row.year && year) row.year = year
        if (!row.poster && c.poster) row.poster = c.poster
        if (!row.desc && c.desc) row.desc = c.desc
        if (!row.meta && c.meta) row.meta = c.meta
        if (!row.mediaKind && c.mediaKind) row.mediaKind = c.mediaKind
        row.rank = Math.min(row.rank, idx)
        return
      }
      const fresh: ShowRow<C> = {
        key: `${norm || c.provider + ':' + c.id}|${year || ''}|${rows.length}`,
        title: c.title, year, poster: c.poster, desc: c.desc, meta: c.meta, mediaKind: c.mediaKind,
        sources: [c], rank: idx,
      }
      rows.push(fresh)
      if (norm) byTitle.set(norm, [...candidates, fresh])
    })
  })
  // Stable: best per-provider rank first, then more platforms, then arrival order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.rank - b.r.rank || b.r.sources.length - a.r.sources.length || a.i - b.i)
    .map((x) => x.r)
}

/** Keep only rows having at least one source in `providers` (empty set = no filter), trimming other sources. */
export function filterRows<C extends MergeCard>(rows: ShowRow<C>[], providers: ReadonlySet<string>): ShowRow<C>[] {
  if (!providers.size) return rows
  return rows.flatMap((r) => {
    const sources = r.sources.filter((s) => providers.has(s.provider))
    return sources.length ? [{ ...r, sources }] : []
  })
}
