<script setup lang="ts">
/**
 * PageHeader: the two-line page chrome every scene should use instead of
 * hand-rolling its own title row.
 *
 *   line 1  title (bold, c.text) + two spaces + subtitle (c.faint)   …right text
 *   line 2  `─` hairline in c.line across `width`                   (rule !== false)
 *
 * Everything is cut by display width (CJK = 2 cells), so a long Chinese title
 * can never wrap the line. `right` is a plain right-aligned string; pass
 * `rightChunks` instead when the right side is a colored chip (VIP badge…).
 */
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import { colsLine, hr } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth } from '../lib/text.ts'
import { c } from '../lib/theme.ts'

const props = withDefaults(
  defineProps<{
    title: string
    /** Muted text after the title, e.g. the selected show. */
    subtitle?: string
    /** Right-aligned plain text, e.g. `151 集`. */
    right?: string
    /** Color for `right` (default c.faint). */
    rightColor?: string
    /** Right-aligned chunks, for a colored chip instead of plain text. */
    rightChunks?: TextChunk[]
    /** Layout budget handed by the shell (bodyW). */
    width: number
    /** Draw the `─` line under the title row (default true). */
    rule?: boolean
  }>(),
  { rule: true },
)

const ruleText = computed(() => hr(props.width))

const rightChunks = computed(() => props.rightChunks ?? [])
const rightCells = computed(() =>
  rightChunks.value.length
    ? rightChunks.value.reduce((n, chunk) => n + displayWidth(chunk.text), 0)
    : displayWidth(props.right ?? ''),
)

/** Title + subtitle, clipped to `cells` and padded so the row is exact. */
function leftChunks(cells: number): TextChunk[] {
  if (cells <= 0) return []
  const title = displayWidth(props.title) > cells ? clip(props.title, cells) : props.title
  const out: TextChunk[] = [fg(c.text)(bold(title))]
  let used = displayWidth(title)
  const subtitle = props.subtitle ?? ''
  if (subtitle && used + 4 <= cells) {
    const room = cells - used - 2
    const text = displayWidth(subtitle) > room ? clip(subtitle, room) : subtitle
    out.push(fg(c.faint)(`  ${text}`))
    used += 2 + displayWidth(text)
  }
  if (used < cells) out.push({ __isChunk: true, text: ' '.repeat(cells - used) })
  return out
}

/** Right side gets 2 cells of gap, then the widest of text/chunks that fits. */
const right = computed(() => {
  if (props.width < 12) return { gap: 0, text: '', chunks: [] as TextChunk[], cells: 0 }
  const cells = Math.min(rightCells.value, Math.max(0, props.width - 12))
  if (rightChunks.value.length && cells >= rightCells.value)
    return { gap: 2, text: '', chunks: rightChunks.value.slice(), cells }
  const text = props.right ?? ''
  const clippedText = displayWidth(text) > cells ? clip(text, cells) : text
  return { gap: 2, text: clippedText, chunks: [] as TextChunk[], cells: displayWidth(clippedText) }
})

const line = computed(() => {
  const r = right.value
  const cols: Col[] = [{ chunks: leftChunks, grow: true }]
  if (r.cells > 0) {
    cols.push({ text: '', cells: r.gap })
    if (r.chunks.length) cols.push({ chunks: () => r.chunks, cells: r.cells })
    else cols.push({ text: r.text, cells: r.cells, align: 'right', color: props.rightColor ?? c.faint })
  }
  return colsLine(cols, props.width)
})
</script>

<template>
  <Box flexDirection="column" :width="width" :height="rule ? 2 : 1">
    <Text
      :content="line"
      :width="width"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text v-if="rule" :content="ruleText" :width="width" :height="1" />
  </Box>
</template>
