<script setup lang="ts">
// Episode picker: a dense grid of ` ✓ 012 ` cells that wraps to the terminal
// width and scrolls by whole rows, so the cursor cell is always on screen.
//
// Contrast comes from three layers, not from brackets: selected numbers are
// `ok` green with a ✓, everything else is faint with a `·`, and the cursor is a
// solid accent block with the background color as its text — it reads at a
// glance even on a washed-out terminal.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bg, bold, fg } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import { c } from '../lib/theme.ts'
import { gridWindow } from '../lib/grid.ts'
import { padStart } from '../lib/text.ts'
import type { Episode } from '../types.ts'

const props = defineProps<{
  episodes: Episode[]
  cursor: number
  width: number
  /** How many grid rows fit on screen. */
  rows: number
}>()

const view = computed(() => gridWindow(props.episodes.length, props.cursor, props.width, props.rows))

const lines = computed(() => {
  // `cellWidth` comes from the same helper the shell uses, so a cell is exactly
  // as wide as the row-stepping math assumes.
  const { perRow, numWidth, cellWidth, startRow, totalRows } = view.value
  const endRow = Math.min(totalRows, startRow + props.rows)
  const out: { key: string; content: StyledText }[] = []
  for (let row = startRow; row < endRow; row++) {
    const chunks: TextChunk[] = []
    for (let col = 0; col < perRow; col++) {
      const index = row * perRow + col
      const ep = props.episodes[index]
      if (!ep) break
      const number = padStart(String(ep.number || index + 1), numWidth)
      const label = ` ${ep.selected ? '✓' : '·'} ${number} `
      const here = index === props.cursor
      // The cursor cell is a solid block: accent background, screen color as
      // the text, and the ✓ kept so a selected episode still reads as selected.
      if (here) chunks.push(bg(c.accent)(fg(c.bg)(bold(label))))
      else chunks.push(fg(ep.selected ? c.ok : c.faint)(label))
    }
    out.push({ key: `row-${row}`, content: new StyledText(chunks) })
  }
  return out
})
</script>

<template>
  <Box flexDirection="column" :width="width" :height="lines.length">
    <Text
      v-for="line in lines"
      :key="line.key"
      :content="line.content"
      :width="width"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
  </Box>
</template>
