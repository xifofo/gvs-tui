<script setup lang="ts">
// 筛选: the options of every filter on the current section, one row each.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import { colsLine, markCol } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import { sliceList, workspaceSections } from '../lib/view.ts'
import type { Snapshot } from '../bridge.ts'

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
const filterView = computed(() =>
  sliceList(filterRows.value, props.state.cursor, bodyH.value - 2),
)

/** `▌ 体裁    ● 全部` — the group title only on its first option. */
function filterLine(item: (typeof filterRows.value)[number], index: number): StyledText {
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
  <Box flexDirection="column"
    ><Text
      :content="
        new StyledText([
          fg(c.text)(bold('筛选 ')),
          fg(c.dim)(wsSections[ws?.sectionIndex ?? 0]?.title ?? ''),
        ])
      "
      :height="1"
      :marginBottom="1" /><Text
      v-for="entry in filterView.rows"
      :key="entry.item.key + entry.item.value"
      :content="filterLine(entry.item, entry.index)"
      :bg="entry.index === state.cursor ? c.sel : undefined"
      :height="1"
      :width="bodyW"
      :truncate="true"
  /></Box>
</template>
