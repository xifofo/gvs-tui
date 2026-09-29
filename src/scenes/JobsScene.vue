<script setup lang="ts">
// 任务: the download queue. Every row is laid out from the body width, so the
// columns stay put while the speed / stage text changes, and the trailing
// column only ever shows what the row is actually doing (a file name, a speed,
// a queue state) — the full path lives on the 任务详情 screen.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import EmptyState from '../components/EmptyState.vue'
import PageHeader from '../components/PageHeader.vue'
import { barChunks, chipChunks, colsLine, markCol } from '../lib/rows.ts'
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
/** Two rows of chrome above the list: the page header and the column header. */
const jobView = computed(() => sliceList(jobs.value, props.state.cursor, props.height - 3))

// --- columns --------------------------------------------------------------
// Fixed cells: mark 2 + icon 2 + gap 1 + bar 16 + gap 1 + pct 4 + gap 2.
const FIXED_CELLS = 28
const BAR_CELLS = 16
/** Title keeps at least 16 cells; the detail column takes the rest, up to 30. */
const detailCells = computed(() =>
  Math.max(12, Math.min(30, bodyW.value - FIXED_CELLS - 16)),
)
const titleCells = computed(() => Math.max(14, bodyW.value - FIXED_CELLS - detailCells.value))

/** `D:\downloads\剧名\S01E01.mkv` → `S01E01.mkv` (the path is on the detail page). */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut >= 0 ? path.slice(cut + 1) : path
}

/** What the trailing column says: failure, degradation, file, speed or stage. */
function detail(job: Job): { text: string; color: string } {
  if (job.status === '失败') return { text: job.err || '失败', color: c.err }
  if (job.status === '完成')
    return job.note
      ? { text: `提示：${job.note}`, color: c.warn }
      : { text: job.log ? baseName(job.log) : '完成', color: c.faint }
  return { text: job.log || job.status, color: c.faint }
}

const stats = computed<TextChunk[]>(() => {
  const list = jobs.value
  const done = list.filter((job) => job.status === '完成').length
  const failed = list.filter((job) => job.status === '失败').length
  const queued = list.filter((job) => job.status === '排队').length
  const active = list.length - done - failed - queued
  // Zero counts are noise, except 进行 — the number that answers "is it working".
  const chunks: TextChunk[] = []
  if (done) chunks.push(...chipChunks(`${done} 完成`, c.ok))
  chunks.push(...chipChunks(`${active} 进行`, c.accent))
  if (queued) chunks.push(...chipChunks(`${queued} 排队`, c.faint))
  if (failed) chunks.push(...chipChunks(`${failed} 失败`, c.err))
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
      { text: '  ', cells: 2 },
      { text: '状态 · 详情', grow: true, color: c.faint },
    ],
    bodyW.value,
  )
}

function jobLine(job: Job, selected: boolean): StyledText {
  const tone = jobTone(job.status)
  const pct = Math.max(0, Math.min(100, Math.round((job.pct ?? 0) * 100)))
  const failed = job.status === '失败'
  const degraded = job.status === '完成' && !!job.note
  const info = detail(job)
  const cols: Col[] = [
    markCol(selected),
    { text: `${tone.icon} `, cells: 2, color: degraded ? c.warn : tone.color, bold: false },
    { text: job.title, cells: titleCells.value, color: failed && !selected ? c.dim : c.text },
    { text: ' ', cells: 1 },
    {
      chunks: (cells) => barChunks(pct / 100, cells, failed ? c.err : c.accent),
      cells: BAR_CELLS,
    },
    { text: ' ', cells: 1 },
    { text: `${pct}%`, cells: 4, align: 'right', color: failed ? c.err : pct >= 100 ? c.ok : c.dim, bold: false },
    { text: '  ', cells: 2 },
    { text: info.text, cells: detailCells.value, color: info.color, bold: false },
  ]
  return colsLine(cols, bodyW.value, selected)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      title="下载任务"
      :subtitle="`共 ${jobs.length} 个`"
      :rightChunks="stats"
      :width="bodyW"
    />
    <template v-if="jobs.length">
      <Text :content="jobHeader()" :width="bodyW" :height="1" wrapMode="none" :truncate="true" />
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
