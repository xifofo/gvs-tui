/** Preview for the explicit create-folder button; never creates or changes a directory. */
export function publicationDirectoryPreview(input: { categoryLabel: string; title: string; tmdbId?: number; kind: 'movie' | 'show'; season?: number }): string {
  if (!input.tmdbId || !Number.isInteger(input.tmdbId) || input.tmdbId <= 0 || !input.categoryLabel.trim() || !input.title.trim()) return ''
  const clean = (value: string, maxBytes = 255) => {
    const source = value.trim().replace(/[/\\:*?"<>|\p{Cc}]/gu, '_')
    let result = '', bytes = 0
    for (const character of source) {
      const size = new TextEncoder().encode(character).length
      if (bytes + size > maxBytes) break
      result += character; bytes += size
    }
    result = result.trim()
    return !result || result === '.' || result === '..' ? '_' : result
  }
  const suffix = ` {tmdbid-${input.tmdbId}}`
  const parts = [clean(input.categoryLabel), `${clean(input.title, 255 - new TextEncoder().encode(suffix).length)}${suffix}`]
  if (input.kind === 'show') {
    if (!Number.isInteger(input.season) || input.season! < 0) return ''
    parts.push(`season ${String(input.season).padStart(2, '0')}`)
  }
  return parts.join('/')
}
