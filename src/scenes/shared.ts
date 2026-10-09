// Controls two scenes render identically: the platform tab bar is the same
// control on 发现 and 搜索, so it lives here instead of being copied into either
// scene — and in one place for a future redesign to touch.
import { colsLine, tabChunks, tabsWidth } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { providerName } from '../lib/theme.ts'
import type { StyledText } from 'vue-termui'

/** Fixed order of the platform tabs; the digit prefix is part of the label. */
export const PLATFORM_ORDER = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'iqcn'] as const

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
  const cols: Col[] = []
  PLATFORM_ORDER.forEach((id, i) => {
    const label = `${i + 1} ${providerName(id)}`
    cols.push({
      chunks: () => tabChunks(label, id === current && allowed.has(id), allowed.has(id)),
      cells: tabsWidth([label]),
    })
  })
  cols.push({ text: '', grow: true })
  if (modes)
    cols.push({
      chunks: () => [...tabChunks('推荐', modes === 'rec'), ...tabChunks('榜单', modes === 'rank')],
      cells: tabsWidth(['推荐', '榜单']),
    })
  return colsLine(cols, width)
}
