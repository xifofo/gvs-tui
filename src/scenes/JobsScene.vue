<script setup lang="ts">
// 任务: the download queue. The header row and the progress bar are laid out
// from the body width, so the columns stay put while the log text changes.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import { barChunks, colsLine, ink, markCol } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { c, jobTone } from '../lib/theme.ts'
import { sliceList } from '../lib/view.ts'
import type { Job, Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)

const jobs = computed(() => props.state.jobs ?? [])
const jobView = computed(() => sliceList(jobs.value, props.state.cursor, props.height - 2))

const jobCells = computed(() => ({
  title: Math.min(34, Math.max(14, Math.floor(bodyW.value * 0.34))),
  bar: Math.min(18, Math.max(8, Math.floor(bodyW.value * 0.16))),
}))

function jobHeader(): StyledText {
  const { title, bar } = jobCells.value
  return colsLine(
    [
      { text: '', cells: 4 },
      { text: '任务', cells: title, color: c.faint },
      { text: '', cells: 1 },
      { text: '进度', cells: bar + 5, color: c.faint },
      { text: '', cells: 2 },
      { text: '状态', grow: true, color: c.faint },
    ],
    bodyW.value,
  )
}

function jobLine(job: Job, selected: boolean): StyledText {
  const tone = jobTone(job.status)
  const pct = Math.max(0, Math.min(100, Math.round((job.pct ?? 0) * 100)))
  const { title: titleCells, bar: barCells } = jobCells.value
  const failed = job.status === '失败'
  const degraded = job.status === '完成' && !!job.note
  const trailing = failed
    ? job.err || '失败'
    : job.status === '完成'
      ? degraded ? `降级：${job.note} · ${job.log}` : job.log || '完成'
      : job.log || job.status
  const cols: Col[] = [
    markCol(selected),
    { text: `${tone.icon} `, cells: 2, color: degraded ? c.warn : tone.color, bold: false },
    { text: job.title, cells: titleCells, color: failed ? c.dim : c.text },
    { text: ' ', cells: 1 },
    {
      chunks: (cells) => barChunks(pct / 100, cells, failed ? c.err : c.accent),
      cells: barCells,
    },
    { text: ' ', cells: 1 },
    {
      text: `${pct}%`,
      cells: 4,
      align: 'right',
      color: pct >= 100 ? c.ok : c.dim,
      bold: false,
    },
    { text: '  ', cells: 2 },
    { text: trailing, grow: true, color: failed ? c.err : degraded ? c.warn : c.faint, bold: false },
  ]
  return colsLine(cols, bodyW.value, selected)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      v-if="!jobs.length"
      :content="ink(c.dim, '还没有下载任务  ·  按 F2 搜索，或 esc 回发现页选片')"
      :height="1"
      :marginTop="1"
    />
    <template v-else>
      <Text :content="jobHeader()" :width="bodyW" :height="1" wrapMode="none" />
      <Text :content="ink(c.line, '─'.repeat(bodyW))" :width="bodyW" :height="1" />
    </template>
    <Text
      v-for="entry in jobView.rows"
      :key="entry.item.id"
      :content="jobLine(entry.item, entry.index === state.cursor)"
      :bg="entry.index === state.cursor ? c.sel : undefined"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
  </Box>
</template>
