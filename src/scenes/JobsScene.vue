<script setup lang="ts">
// 任务: one row per job (name + progress). The selected job's status — speed,
// error, or filename — sits in the pane on the right and follows the cursor.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import EmptyState from '../components/EmptyState.vue'
import InfoPanel from '../components/InfoPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import { barChunks, chipChunks, colsLine, markCol } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { c, jobTone } from '../lib/theme.ts'
import { jobSummary } from '../lib/ui-layout.ts'
import { jobLayout, jobWindow } from '../lib/view.ts'
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
const layout = computed(() => jobLayout(bodyW.value, props.height))
const jobView = computed(() => jobWindow(jobs.value, props.state.cursor, layout.value.rows))
const selectedJob = computed(() => jobs.value[props.state.cursor])

const side = computed(() => layout.value.side)
const main = computed(() => bodyW.value - (side.value ? side.value + 2 : 0))

// mark 2 + icon 2 + gap 1 + bar 16 + gap 1 + pct 4
const BAR_CELLS = 16
const TITLE_CHROME = 26
const titleCells = computed(() => Math.max(16, main.value - TITLE_CHROME))
const summary = computed(() => jobSummary(selectedJob.value, side.value || bodyW.value))

const stats = computed<TextChunk[]>(() => {
  const list = jobs.value
  const done = list.filter((job) => job.status === '完成').length
  const failed = list.filter((job) => job.status === '失败').length
  const queued = list.filter((job) => job.status === '排队').length
  const active = list.length - done - failed - queued
  // Zero counts are noise, except 进行 — the number that answers "is it working".
  const chunks: TextChunk[] = []
  if (done) chunks.push(...chipChunks(`完成 ${done}`, c.ok))
  chunks.push(...chipChunks(`进行中 ${active}`, c.accent))
  if (queued) chunks.push(...chipChunks(`排队 ${queued}`, c.faint))
  if (failed) chunks.push(...chipChunks(`失败 ${failed}`, c.err))
  return chunks
})

function jobHeader(): StyledText {
  return colsLine(
    [
      { text: '', cells: 4 },
      { text: '任务', cells: titleCells.value, color: c.faint },
      { text: ' ', cells: 1 },
      { text: '进度', cells: BAR_CELLS, color: c.faint },
      { text: ' ', cells: 1 },
      { text: '', cells: 4 },
    ],
    main.value,
  )
}

function jobLine(job: Job, selected: boolean): StyledText {
  const tone = jobTone(job.status)
  const pct = Math.max(0, Math.min(100, Math.round((job.pct ?? 0) * 100)))
  const failed = job.status === '失败'
  const downgraded = !!job.note
  const cols: Col[] = [
    markCol(selected),
    { text: `${downgraded ? '!' : tone.icon} `, cells: 2, color: downgraded ? c.warn : failed ? c.err : tone.color, bold: false },
    { text: job.title, cells: titleCells.value, color: failed && !selected ? c.dim : c.text },
    { text: ' ', cells: 1 },
    {
      chunks: (cells) => barChunks(pct / 100, cells, failed ? c.err : c.accent),
      cells: BAR_CELLS,
    },
    { text: ' ', cells: 1 },
    { text: `${pct}%`, cells: 4, align: 'right', color: failed ? c.err : pct >= 100 ? c.ok : c.dim, bold: false },
  ]
  return colsLine(cols, main.value, selected)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      title="下载任务"
      :subtitle="`共 ${jobs.length} 个任务`"
      :rightChunks="stats"
      :width="bodyW"
    />
    <template v-if="jobs.length">
      <Box flexDirection="row" :width="bodyW">
        <Box flexDirection="column" :width="main">
          <Text :content="jobHeader()" :width="main" :height="1" wrapMode="none" />
          <Text
            v-for="entry in jobView.rows"
            :key="entry.item.id"
            :content="jobLine(entry.item, entry.index === state.cursor)"
            :bg="entry.index === state.cursor ? c.sel : undefined"
            :width="main"
            :height="1"
            wrapMode="none"
          />
        </Box>
        <Box v-if="side" :width="side" :marginLeft="2">
          <InfoPanel
            title="状态"
            :lines="summary"
            :width="side"
            :height="Math.max(4, height - 2)"
            :color="selectedJob?.err ? c.err : undefined"
            more="回车查看完整详情"
          />
        </Box>
      </Box>
      <Box v-if="!side" :width="bodyW" :marginTop="1">
        <InfoPanel
          title="当前任务"
          :lines="summary"
          :width="bodyW"
          :height="layout.panel"
          :color="selectedJob?.err ? c.err : undefined"
          more="回车查看完整详情"
        />
      </Box>
    </template>
    <EmptyState
      v-else
      :width="bodyW"
      :height="Math.max(1, height - 2)"
      message="还没有下载任务"
      hint="按 F2 搜索，或 esc 回发现页选片"
    />
  </Box>
</template>
