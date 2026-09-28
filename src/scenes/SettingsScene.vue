<script setup lang="ts">
// 设置: the config list, grouped under the platform whose prefix the label
// carries (`优酷…`, `腾讯…`, `红果…`).
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import { ink, kvLine } from '../lib/rows.ts'
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

/** Settings grouped by platform prefix; `index` is the setting's cursor index. */
const SETTING_GROUPS = ['优酷', '腾讯', '红果'] as const
const settingRows = computed(() => {
  const out: Array<{ header: string } | { label: string; value: string; index: number }> = []
  let group = ''
  settings.value.forEach((item, index) => {
    const prefix = SETTING_GROUPS.find((g) => item.label.startsWith(g)) ?? ''
    const name = prefix ? prefix : '常规'
    if (name !== group) {
      if (group) out.push({ header: '' })
      out.push({ header: name })
      group = name
    }
    const label = prefix ? item.label.slice(prefix.length).trim() || item.label : item.label
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
          ? ink(c.accent, entry.item.header, true)
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
