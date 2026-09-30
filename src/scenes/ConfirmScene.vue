<script setup lang="ts">
import { computed, Box, Text } from 'vue-termui'
import PageHeader from '../components/PageHeader.vue'
import { confirmationLines } from '../lib/ui-layout.ts'
import { ink } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../types.ts'

const props = defineProps<{ state: Snapshot; width: number; height: number; H: number }>()
const lines = computed(() => props.state.confirmation ? confirmationLines(props.state.confirmation, props.width) : [])
const visible = computed(() => {
  const room = Math.max(1, props.height - 2)
  const offset = Math.min(props.state.contentOffset || 0, Math.max(0, lines.value.length - room))
  return lines.value.slice(offset, offset + room)
})
</script>

<template>
  <Box flexDirection="column" :width="width">
    <PageHeader title="确认下载" right="回车后创建任务" :width="width" />
    <Text v-for="(line, index) in visible" :key="index" :content="ink(c.text, line)" :width="width" :height="1" wrapMode="none" />
  </Box>
</template>
