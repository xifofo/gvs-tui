<script setup lang="ts">
// 确认: the last step of the wizard. Enter is what actually queues the job, so
// the screen is a plain read-back of what will be created.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bg, bold, fg } from 'vue-termui'
import { ink, kvLine } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
  /** H: the rule spacing tightens when the window is short. */
  H: number
}>()

const bodyW = computed(() => props.width)
/** Rows collapse their top margin on a short window instead of scrolling. */
const tight = computed(() => props.H < 24)
</script>

<template>
  <Box flexDirection="column" :width="bodyW"
    ><Text
      :content="
        new StyledText([
          fg(c.accent)(bold('确认下载  ')),
          fg(c.text)(bold(state.confirmation?.title || '')),
          fg(c.faint)('   回车后才会创建任务'),
        ])
      "
      :height="1"
      :width="bodyW"
      :truncate="true" /><Text
      :content="ink(c.line, '─'.repeat(bodyW))"
      :height="1"
      :marginTop="tight ? 0 : 1"
      :width="bodyW" /><Text
      v-for="(value, label) in {
        集数: state.confirmation?.episodes,
        画质: state.confirmation?.quality,
        音轨: state.confirmation?.audio,
        目录: state.confirmation?.directory,
        文件名: state.confirmation?.name,
      }"
      :key="label"
      :content="kvLine(String(label), value || '—', bodyW, false, label === '目录' || label === '文件名' ? c.text : c.dim, 10)"
      :height="1"
      :marginTop="tight ? 0 : 1"
      :width="bodyW"
      :truncate="true" /><Text
      :content="ink(c.line, '─'.repeat(bodyW))"
      :height="1"
      :marginTop="tight ? 0 : 1"
      :width="bodyW" /><Text
      :content="
        new StyledText([
          bg(c.accent)(fg(c.bg)(bold(' ⏎ 加入下载队列 '))),
        ])
      "
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :truncate="true"
  /></Box>
</template>
