<script setup lang="ts">
// 筛选: the options of every filter on the current section, one row each,
// grouped under the filter title with a blank line between groups.
//
// The cursor is an option index (the runtime owns it, `filterRows` keeps that
// order); the blank line between groups is decoration inserted while drawing,
// so windowing still slices by option index and no row is lost.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import { colsLine, markCol } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import { sliceList, workspaceSections } from '../lib/view.ts'
import type { Snapshot } from '../bridge.ts'
import PageHeader from '../components/PageHeader.vue'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

const ws = computed(() => props.state.workspace)
const wsSections = computed(() => workspaceSections(ws.value))

const filterRows = computed(
  () =>
    wsSections.value[ws.value?.sectionIndex ?? 0]?.filters?.flatMap((f) =>
      f.options.map((o) => ({ ...o, key: f.key, title: f.title })),
    ) ?? [],
)

/** PageHeader takes two rows; the list gets what is left. */
const listH = computed(() => Math.max(1, bodyH.value - 2))
const filterView = computed(() =>
  sliceList(filterRows.value, props.state.cursor, listH.value),
)

/** The lines to draw: a blank spacer before a group's first option, cut to fit. */
const visible = computed(() => {
  const rows = filterView.value.rows
  if (!rows.length) return [] as Array<{ spacer: boolean; index: number }>
  const start = rows[0]!.index
  const drawn: Array<{ spacer: boolean; index: number }> = []
  for (const { index } of rows) {
    if (index > start && filterRows.value[index - 1]!.key !== filterRows.value[index]!.key)
      drawn.push({ spacer: true, index: -1 })
    drawn.push({ spacer: false, index })
  }
  return drawn.slice(0, listH.value)
})

/** `▌ 体裁    ● 全部` — the group title only on its first option. */
function filterLine(index: number): StyledText {
  const item = filterRows.value[index]!
  const on = index === props.state.cursor
  const first = filterRows.value[index - 1]?.key !== item.key
  const current = ws.value?.filters?.[item.key]
  const active = current ? current === item.value : first
  const cols: Col[] = [
    markCol(on),
    { text: first ? item.title : '', cells: 10, color: c.faint, bold: false },
    { text: active ? '● ' : '○ ', cells: 2, color: active ? c.accent : c.faint, bold: false },
    { text: item.label, grow: true, color: on || active ? c.text : c.dim },
  ]
  return colsLine(cols, bodyW.value, on)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      title="筛选"
      :subtitle="wsSections[ws?.sectionIndex ?? 0]?.title ?? ''"
      :width="bodyW"
    />
    <Text
      v-for="(row, order) in visible"
      :key="row.spacer ? `gap-${order}` : `opt-${row.index}`"
      :content="row.spacer ? '' : filterLine(row.index)"
      :bg="!row.spacer && row.index === state.cursor ? c.sel : undefined"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
  </Box>
</template>
