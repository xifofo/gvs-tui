<script setup lang="ts">
// 搜索结果: one row per hit, with the platform rendered as a chip on the right
// edge — the same column scheme as the discovery list.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import { chipChunks, colsLine, markCol, pickLine } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth } from '../lib/text.ts'
import { c, providerName } from '../lib/theme.ts'
import { resultWindow } from '../lib/view.ts'
import type { Row, Snapshot } from '../bridge.ts'
import EmptyState from '../components/EmptyState.vue'
import PageHeader from '../components/PageHeader.vue'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const providers = computed(() => props.state.providers ?? [])

/** PageHeader takes two rows; the list gets what is left. */
const listH = computed(() => Math.max(2, props.height - 2))
const resultView = computed(() =>
  resultWindow(props.state.rows, props.state.cursor, listH.value),
)

const platform = computed(() => providerName(providers.value[props.state.providerIndex] || ''))
const title = computed(() => (props.state.query ? `「${clip(props.state.query, 30)}」` : '搜索结果'))

/** One blurb column width per list, so the blurbs line up across rows. */
function blurbCells(rows: Row[] | undefined, width: number): number {
  const widest = (rows ?? []).reduce((n, r) => Math.max(n, displayWidth(r.desc || (r.tags ?? []).join('·'))), 0)
  return Math.max(10, Math.min(widest, Math.floor(width * 0.3)))
}

/** `▌ 斗破苍穹年番        萧炎智斗蛇人族        ★9.1  优酷 ` */
function resultLine(row: Row, selected: boolean, width: number): StyledText {
  const meta = row.desc || (row.tags ?? []).join('·')
  const metaW = blurbCells(props.state.rows, width)
  const cols: Col[] = [
    markCol(selected),
    { text: row.title, grow: true, color: selected ? c.text : c.dim },
  ]
  if (meta) cols.push({ text: '', cells: 2 }, { text: meta, cells: metaW, color: c.faint, bold: false })
  cols.push(
    { text: '', cells: 2 },
    { text: row.score ? `★${row.score}` : '', cells: 6, align: 'right', color: c.warn, bold: false },
    { text: '', cells: 2 },
    { chunks: () => chipChunks(providerName(row.sub)), cells: displayWidth(providerName(row.sub)) + 2 },
  )
  return colsLine(cols, width, selected)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      :title="title"
      :subtitle="`${platform} · ${resultView.total} 条${state.listMore ? '+' : ''}`"
      :width="bodyW"
    />
    <EmptyState
      v-if="!resultView.total"
      :width="bodyW"
      :height="listH"
      message="没有结果"
      hint="按 / 换个关键词，或在搜索页用 tab 换平台"
    />
    <template v-else>
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
        :content="pickLine('加载更多…', '', bodyW, state.cursor === (state.rows?.length ?? 0))"
        :height="1"
        :width="bodyW"
      />
    </template>
  </Box>
</template>
