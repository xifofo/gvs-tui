<script setup lang="ts">
import { computed, Box, Text } from 'vue-termui'
import { boundedLines } from '../lib/ui-layout'
import { ink } from '../lib/rows'
import { c } from '../lib/theme'
const props = defineProps<{ title: string; lines: string[]; width: number; height: number; color?: string; more?: string }>()
const visible = computed(() => boundedLines(props.lines, props.width, Math.max(1, props.height - 2), props.more))
</script>

<template>
  <Box flexDirection="column" :width="width" :height="height" :flexShrink="0">
    <Text :content="ink(c.accent, title, true)" :width="width" :height="1" :truncate="true" />
    <Text :content="ink(c.line, '─'.repeat(width))" :width="width" :height="1" />
    <Text v-for="(line, index) in visible" :key="index" :content="ink(color || c.dim, line)" :width="width" :height="1" :truncate="true" />
  </Box>
</template>
