<script setup lang="ts">
// 任务详情: the fixed title/status block, then the rotating log below it.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, fg } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { c, jobTone } from '../lib/theme.ts'
import { logWindow } from '../lib/view.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)

const logView = computed(() =>
  logWindow(props.state.jobDetailLines, props.state.logOffset ?? 0, props.height),
)
const jobDetailTone = computed(() => {
  const line = props.state.jobDetailLines?.[1] ?? ''
  return jobTone(/^(?:状态 )?([^\s·：:]+)/.exec(line)?.[1] ?? '')
})
</script>

<template>
  <Box flexDirection="column"
    ><Text
      :content="ink(c.text, state.jobDetailLines?.[0] ?? '', true)"
      :height="1"
      :width="bodyW"
      :truncate="true" /><Text
      :content="
        new StyledText([
          fg(jobDetailTone.color)(`${jobDetailTone.icon} `),
          fg(jobDetailTone.color)(state.jobDetailLines?.[1] ?? ''),
        ])
      "
      :height="1"
      :width="bodyW"
      :truncate="true" /><Text
      :content="ink(c.line, '─'.repeat(bodyW))"
      :height="1"
      :width="bodyW" /><Text
      v-for="(line, index) in logView.lines"
      :key="index"
      :content="ink(c.dim, line)"
      :height="1"
      :width="bodyW"
      :truncate="true"
  /></Box>
</template>
