<script setup lang="ts">
// 搜索结果: one row per hit, with the platform rendered as a `共 N 条` heading.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import { colsLine, ink, markCol, pickLine } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth } from '../lib/text.ts'
import { c, providerName } from '../lib/theme.ts'
import { resultWindow } from '../lib/view.ts'
import type { Row, Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const providers = computed(() => props.state.providers ?? [])

const resultView = computed(() =>
  resultWindow(props.state.rows, props.state.cursor, props.height),
)

/** One blurb column width per list, so the blurbs line up across rows. */
function blurbCells(rows: Row[] | undefined, width: number): number {
  const widest = (rows ?? []).reduce((n, r) => Math.max(n, displayWidth(r.desc || (r.tags ?? []).join('·'))), 0)
  return Math.min(widest, Math.floor(width * 0.4))
}

/**
 * Pack a list row to the left: the title column is only as wide as the widest
 * title in the list, so the blurb sits next to the titles instead of floating
 * at the far edge; a trailing spacer takes the slack.
 */
function packTitle(cols: Col[], titleAt: number, rows: Row[] | undefined, width: number): Col[] {
  const widest = (rows ?? []).reduce((n, r) => Math.max(n, displayWidth(r.title)), 0)
  const rest = cols.reduce((n, col, i) => n + (i === titleAt ? 0 : (col.cells ?? 0)), 0)
  cols[titleAt] = { ...cols[titleAt]!, grow: false, cells: Math.max(6, Math.min(widest + 2, width - rest)) }
  return [...cols, { text: '', grow: true }]
}

/** `▌ 斗破苍穹年番              萧炎智斗蛇人族   ★9.1  优酷` */
function resultLine(row: Row, selected: boolean, width: number): StyledText {
  const meta = row.desc || (row.tags ?? []).join('·')
  const metaW = blurbCells(props.state.rows, width)
  // Platform ids are long and only matter when two titles collide; show them
  // when there is room to spare.
  const id = width >= 118 && row.id ? `  ${row.id}` : ''
  const cols: Col[] = [
    markCol(selected),
    { text: row.title, grow: true, color: selected ? c.text : c.dim },
  ]
  if (metaW) cols.push({ text: '', cells: 2 }, { text: meta, cells: metaW, color: c.faint, bold: false })
  cols.push({ text: row.score ? `★${row.score}` : '', cells: 7, align: 'right', color: c.warn, bold: false })
  cols.push({ text: `  ${providerName(row.sub)}`, cells: 6, color: c.faint, bold: false })
  if (id) cols.push({ text: id, cells: displayWidth(id), color: c.line, bold: false })
  return colsLine(packTitle(cols, 1, props.state.rows, width), width, selected)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="
        new StyledText([
          fg(c.text)(bold(state.query ? `「${clip(state.query, 30)}」` : '搜索结果')),
          fg(c.faint)(`  ${providerName(providers[state.providerIndex] || '')} · ${resultView.total} 条${state.listMore ? '+' : ''}`),
        ])
      "
      :height="1"
      :width="bodyW"
      :truncate="true"
      :marginBottom="1"
    />
    <Text
      v-if="!resultView.total"
      :content="ink(c.dim, '没有结果  ·  按 / 换个关键词，或在搜索页用 tab 换平台')"
      :height="1"
    />
    <Text
      v-for="entry in resultView.rows"
      :key="`${entry.item.sub}-${entry.item.id}-${entry.index}`"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
      :bg="entry.index === state.cursor ? c.sel : undefined"
      :content="resultLine(entry.item, entry.index === state.cursor, bodyW)"
    />
    <Text
      v-if="state.listMore"
      :content="
        pickLine(
          '加载更多…',
          '',
          bodyW,
          state.cursor === (state.rows?.length ?? 0),
        )
      "
      :height="1"
      :width="bodyW"
    />
  </Box>
</template>
