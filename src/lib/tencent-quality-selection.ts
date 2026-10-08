import type { Quality, TencentQualitySelection } from '../types.ts'

export function tencentCaption(value: string): string {
  const c = value.trim().toLowerCase()
  if (['soft', '软', '软字幕', 'srt'].includes(c)) return 'soft'
  if (['hard', '硬', '硬字幕', 'burn'].includes(c)) return 'hard'
  return c
}

export function tencentPersonaKey(value: string): string {
  return value.trim().replace(/_(?:软|硬|soft|hard)$/i, '')
}

/** Never persist expiring URLs, cookies or decryption keys with the rendition. */
export function selectedTencentQuality(q: Pick<Quality, 'id' | 'formatId' | 'persona' | 'group'> & Partial<Pick<Quality, 'width' | 'height' | 'fps' | 'hdr'>>): TencentQualitySelection | undefined {
  const parts = q.id.split('|')
  const formatId = q.formatId || (parts.length >= 3 && parts[2] !== '0' ? parts[2] : '')
  const persona = q.persona || (parts.length >= 4 && !['main', 'encode', 'source'].includes(parts[3]!) ? parts[3] : '')
  const group = q.group ?? (persona && /^(?:\d+|h264|default)$/.test(tencentPersonaKey(persona)) ? 'encode' : undefined)
  if (!formatId && !persona && group !== 'source' && !q.width && !q.height && !q.fps && !q.hdr) return undefined
  return { ...(formatId ? { formatId } : {}), ...(persona ? { persona } : {}), ...(group ? { group } : {}),
    ...(q.width ? { width: q.width } : {}), ...(q.height ? { height: q.height } : {}),
    ...(q.fps ? { fps: q.fps } : {}), ...(q.hdr ? { hdr: q.hdr } : {}) }
}

export type TencentQualityChoice = {
  quality?: string; stream?: string; caption?: string; group?: string
  formatId?: string; persona?: string; tencentQuality?: TencentQualitySelection
}

export function tencentChoiceSelection(q: TencentQualityChoice): TencentQualitySelection {
  const composite = (q.stream || q.quality || '').split('|')
  return q.tencentQuality ?? selectedTencentQuality({ id: composite.join('|'), formatId: q.formatId, persona: q.persona,
    group: ['main', 'encode', 'source'].includes(q.group || '') ? q.group as TencentQualitySelection['group'] : undefined }) ?? {}
}

/** Exact encoding selector is separate from the device persona override. */
export function tencentSelectedPlayInput(q: TencentQualityChoice): Record<string, string> {
  const parts = (q.stream || q.quality || 'fhd').trim().split('|')
  const out: Record<string, string> = { defn: parts[0]! }
  const cap = tencentCaption(q.caption || (parts.length > 1 ? parts[1]! : ''))
  if (cap === 'soft' || cap === 'hard') out.caption = cap
  const selection = tencentChoiceSelection(q)
  if (selection.formatId) out.format_id = selection.formatId
  if (selection.group === 'encode' && selection.persona) out.rendition_persona = selection.persona
  return out
}

export function tencentDownloadSelection(q: TencentQualityChoice): { stream: string; caption?: string; formatId?: string } {
  const selection = tencentChoiceSelection(q)
  const input = tencentSelectedPlayInput(q)
  return { stream: input.defn, caption: input.caption, formatId: selection.formatId }
}
