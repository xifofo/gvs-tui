<script setup lang="ts">
import { computed, Box, Text } from 'vue-termui'
import InfoPanel from '../components/InfoPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import { ink, kvLine } from '../lib/rows.ts'
import { compactSetting, settingGroup, settingInfoLines, splitPane } from '../lib/ui-layout.ts'
import { c, valueColor } from '../lib/theme.ts'
import { sliceList } from '../lib/view.ts'
import { wrapLines } from '../lib/text.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{ state: Snapshot; width: number; height: number }>()
const settings = computed(() => props.state.settings ?? [])
const current = computed(() => settings.value[props.state.cursor])
const currentGroup = computed(() => settingGroup(current.value?.label || ''))
const pane = computed(() => splitPane(props.width))
const panelHeight = computed(() => pane.value.side ? Math.max(4, props.height - 2) : Math.min(7, Math.max(4, props.height - 4)))
const rowRoom = computed(() => Math.max(1, props.height - (pane.value.side ? 2 : panelHeight.value + 3)))
const info = computed(() => settingInfoLines(current.value?.label || '', current.value?.value || ''))
const expandedLines = computed(() => {
  const lines = info.value.flatMap(line => wrapLines(line, props.width))
  const room = Math.max(1, props.height - 2)
  const offset = Math.min(props.state.contentOffset || 0, Math.max(0, lines.length - room))
  return lines.slice(offset, offset + room)
})
const settingView = computed(() => {
  const rows = settings.value.map((item, index) => ({ ...item, index })).filter(item => settingGroup(item.label) === currentGroup.value)
  const at = rows.findIndex(row => row.index === props.state.cursor)
  return sliceList(rows, Math.max(0, at), rowRoom.value)
})
</script>

<template>
  <Box flexDirection="column" :width="width">
    <template v-if="state.settingsExpanded">
      <PageHeader :title="current?.label || '设置详情'" right="I / Esc 收起" :width="width" />
      <Text v-for="(line, index) in expandedLines" :key="index" :content="ink(c.text, line)" :width="width" :height="1" wrapMode="none" />
    </template>
    <template v-else>
    <PageHeader :title="currentGroup" subtitle="←→ 切换分组 · 修改后立即保存" :width="width" />
    <Box flexDirection="row" :width="width">
      <Box flexDirection="column" :width="pane.main">
        <Text
          v-for="entry in settingView.rows"
          :key="entry.item.index"
          :width="pane.main"
          :height="1"
          wrapMode="none"
          :truncate="true"
          :bg="entry.item.index === state.cursor ? c.sel : undefined"
          :content="kvLine(entry.item.label, compactSetting(entry.item.label, entry.item.value), pane.main, entry.item.index === state.cursor, valueColor(entry.item.value))"
        />
      </Box>
      <Box v-if="pane.side" :width="pane.side" :marginLeft="2">
        <InfoPanel :title="current?.label || '设置说明'" :lines="info" :width="pane.side" :height="panelHeight" more="按 I 查看完整详情" />
      </Box>
    </Box>
    <Box v-if="!pane.side" :width="width" :marginTop="1">
      <InfoPanel :title="current?.label || '设置说明'" :lines="info" :width="width" :height="panelHeight" more="按 I 查看完整详情" />
    </Box>
    </template>
  </Box>
</template>
