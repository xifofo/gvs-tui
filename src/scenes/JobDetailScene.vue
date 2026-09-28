<script setup lang="ts">
// 任务详情: the job's title and state in the page header, its progress on one
// line, then the rotating log. The log is what the ↑↓ keys scroll, and the
// status line reports the same window, so the two can never disagree.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, fg } from 'vue-termui'
import EmptyState from '../components/EmptyState.vue'
import PageHeader from '../components/PageHeader.vue'
import { barChunks, chipChunks, colsLine, ruleLine } from '../lib/rows.ts'
import { clip } from '../lib/text.ts'
import { c, jobTone } from '../lib/theme.ts'
import { logWindow } from '../lib/view.ts'
import type { Job, Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const lines = computed(() => props.state.jobDetailLines ?? [])

/** line 0 is the title, line 1 the `状态 X · n%` summary; logs start at line 2. */
const title = computed(() => lines.value[0] ?? '')
const status = computed(() => lines.value[1] ?? '')
const jobToneInfo = computed(() => {
  const match = /^(?:状态 )?([^\s·：:]+)/.exec(status.value)
  return jobTone(match?.[1] ?? '')
})
const statusText = computed(() => {
  const match = /^(?:状态 )?([^\s·：:]+)/.exec(status.value)
  return match?.[1] ?? ''
})

/** The list row behind this screen; its pct is what the progress line draws. */
const job = computed<Job | undefined>(() => props.state.jobs?.[props.state.cursor])
/** Running jobs show their progress; finished or failed ones keep the full status (the failure reason). */
const showBar = computed(
  () => !!job.value && (job.value.pct ?? 0) > 0 && !['完成', '失败'].includes(statusText.value),
)

/** Same window the status line reports: header (2) + info line + 日志 rule. */
const logView = computed(() => logWindow(lines.value, props.state.logOffset ?? 0, props.height))

/** Failures shout, retries warn, everything else stays background. */
function logColor(line: string): string {
  if (/失败|错误|error/i.test(line)) return c.err
  if (/重试|403/.test(line)) return c.warn
  return c.dim
}

function progressLine(): StyledText {
  const pct = Math.max(0, Math.min(100, Math.round((job.value?.pct ?? 0) * 100)))
  const cells = Math.max(8, Math.floor(bodyW.value * 0.4))
  return colsLine(
    [
      { chunks: (n) => barChunks(pct / 100, n), cells },
      { text: `${pct}%`, cells: 5, align: 'right', color: pct >= 100 ? c.ok : c.dim, bold: false },
      { text: `  ${clip(job.value?.log || '', Math.max(0, bodyW.value - cells - 5 - 2))}`, grow: true, color: c.faint, bold: false },
    ],
    bodyW.value,
  )
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <template v-if="lines.length">
      <PageHeader
        :title="title"
        :rightChunks="chipChunks(`${jobToneInfo.icon} ${statusText}`, jobToneInfo.color)"
        :width="bodyW"
      />
      <Text
        :content="showBar ? progressLine() : new StyledText([fg(jobToneInfo.color)(status)])"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
      <Text :content="ruleLine('日志', bodyW)" :width="bodyW" :height="1" />
      <Text
        v-for="(line, index) in logView.lines"
        :key="index"
        :content="new StyledText([fg(logColor(line))(line)])"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
    </template>
    <EmptyState
      v-else
      :width="bodyW"
      :height="height"
      message="没有日志"
      hint="按 esc 返回任务列表"
    />
  </Box>
</template>
