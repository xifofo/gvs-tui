// Controls two scenes render identically: the platform tab bar is the same
// control on 发现 and 搜索, so it lives here instead of being copied into either
// scene — and in one place for a future redesign to touch.
import { colsLine, tabChunks, tabsWidth } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { c, providerName } from '../lib/theme.ts'
import { clip, displayWidth } from '../lib/text.ts'
import { fg, type StyledText, type TextChunk } from 'vue-termui'

/** Fixed order of the platform tabs; the digit prefix is part of the label. */
export const PLATFORM_ORDER = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'iqcn'] as const

/** Keep the current tab visible; overflow arrows describe the hidden neighbours. */
export function tabStrip(labels: string[], active: number, width: number, enabled?: boolean[]): TextChunk[] {
  const room = Math.max(0, Math.floor(width))
  if (!labels.length || !room) return []
  const current = Math.max(0, Math.min(labels.length - 1, active))
  let first = current
  let last = current
  const measure = (from: number, to: number) => tabsWidth(labels.slice(from, to + 1)) + (from > 0 ? 2 : 0) + (to < labels.length - 1 ? 2 : 0)
  while (first > 0 || last < labels.length - 1) {
    const previous = first > 0 && measure(first - 1, last) <= room
    const next = last < labels.length - 1 && measure(first, last + 1) <= room
    if (previous && (current - first <= last - current || !next)) first--
    else if (next) last++
    else break
  }
  const before = first > 0 && room >= 6 ? 2 : 0
  const after = last < labels.length - 1 && room - before >= 6 ? 2 : 0
  const available = Math.max(0, room - before - after)
  const chunks: TextChunk[] = before ? [fg(c.faint)('‹ ')] : []
  if (first === last) {
    const label = clip(labels[current]!, Math.max(0, available - 2))
    if (available >= 2) chunks.push(...tabChunks(label, true, enabled?.[current] ?? true))
  } else {
    for (let index = first; index <= last; index++)
      chunks.push(...tabChunks(labels[index]!, index === current, enabled?.[index] ?? true))
  }
  if (after) chunks.push(fg(c.faint)(' ›'))
  return chunks
}

/**
 * `1 优酷  2 腾讯 …`, plus `推荐 / 榜单` when the screen has both modes.
 * The active tab is accent bold on the selection slate; platforms this Key
 * cannot browse stay flat in c.faint.
 */
export function platformBar(
  providers: string[],
  width: number,
  current: string,
  modes?: 'rec' | 'rank',
): StyledText {
  const allowed = new Set(providers)
  const ids: string[] = [...PLATFORM_ORDER, ...providers.filter(id => !PLATFORM_ORDER.includes(id as typeof PLATFORM_ORDER[number]))]
  const labels = ids.map(id => {
    const slot = PLATFORM_ORDER.indexOf(id as typeof PLATFORM_ORDER[number])
    return `${slot >= 0 ? `${slot + 1} ` : ''}${providerName(id)}`
  })
  const modeWidth = modes ? tabsWidth(['推荐', '榜单']) : 0
  const tabWidth = Math.max(0, width - (modeWidth ? modeWidth + 2 : 0))
  const chunks = tabStrip(labels, Math.max(0, ids.indexOf(current)), tabWidth, ids.map(id => allowed.has(id)))
  const used = chunks.reduce((cells, chunk) => cells + displayWidth(chunk.text), 0)
  const cols: Col[] = [{ chunks: () => [...chunks, { __isChunk: true, text: ' '.repeat(Math.max(0, tabWidth - used)) }], cells: tabWidth }]
  if (modes)
    cols.push({ text: '', cells: 2 }, {
      chunks: () => [...tabChunks('推荐', modes === 'rec'), ...tabChunks('榜单', modes === 'rank')],
      cells: modeWidth,
    })
  return colsLine(cols, width)
}
