<script setup lang="ts">
// 设置: the config list, grouped by the platform whose name prefixes the label
// (`优酷登录`, `腾讯 Cookie` …), with the generic fields under 常规 and the log
// file under 其他.
//
// The runtime hands the list over flat and in display order, so grouping is a
// single pass: walk the fields, start a group when the name changes, and put a
// blank row between groups. The blank is a real row of the mixed header/item
// list that `sliceList` windows, which is what keeps the cursor row on screen.
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import { kvLine, ruleLine } from '../lib/rows.ts'
import { c, valueColor } from '../lib/theme.ts'
import { sliceList } from '../lib/view.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)

const settings = computed(() => props.state.settings ?? [])

/**
 * Label prefixes that name a platform. The runtime declares its fields in
 * groups, so walking the list and starting a new group whenever the name
 * changes gives the right order — and because a label is matched at most once,
 * a group can never open twice.
 */
const PLATFORM_GROUPS = ['优酷', '腾讯', '红果', '黄果', '抖音'] as const

/**
 * The group a label belongs to, and the label with its group prefix stripped
 * (`腾讯 caption=all` → `caption=all`). Everything the prefixes miss is a
 * generic field (常规); 运行日志 is the log file, chrome rather than a setting,
 * so it is parked at the end under 其他.
 */
function groupOf(label: string): { group: string; name: string } {
  if (label === '运行日志') return { group: '其他', name: label }
  for (const group of PLATFORM_GROUPS) {
    if (label === group) return { group, name: label }
    if (label.startsWith(group))
      return { group, name: label.slice(group.length).trim() || label }
  }
  return { group: '常规', name: label }
}

type Row = { header: string } | { label: string; value: string; index: number }

const settingRows = computed<Row[]>(() => {
  const out: Row[] = []
  let group = ''
  settings.value.forEach((item, index) => {
    const { group: name, name: label } = groupOf(item.label)
    if (name !== group) {
      if (group) out.push({ header: '' })
      out.push({ header: name })
      group = name
    }
    out.push({ label, value: item.value, index })
  })
  return out
})

const settingView = computed(() => {
  const rows = settingRows.value
  const at = rows.findIndex((row) => 'index' in row && row.index === props.state.cursor)
  return sliceList(rows, Math.max(0, at), props.height)
})
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      v-for="entry in settingView.rows"
      :key="'header' in entry.item ? `h-${entry.index}` : `s-${entry.item.index}`"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
      :bg="'index' in entry.item && entry.item.index === state.cursor ? c.sel : undefined"
      :content="
        'header' in entry.item
          ? entry.item.header
            ? ruleLine(entry.item.header, bodyW)
            : ''
          : kvLine(
              entry.item.label,
              entry.item.value,
              bodyW,
              entry.item.index === state.cursor,
              valueColor(entry.item.value),
            )
      "
    />
  </Box>
</template>
