<script setup lang="ts">
// 发现 / 首页: platform tabs, a section strip with the active filters on the
// right, and the content list. On a wide terminal a summary pane sits to the
// right of the list.
//
// Columns: the rank column is fixed, the title grows, the blurb keeps a fixed
// share of the list (so the blurbs line up) and the score is right-aligned on
// the far edge — the row is used edge to edge instead of trailing off into
// empty space.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, fg } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import { chipChunks, colsLine, hr, ink, markCol, tabChunks, tabsWidth } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth, wrapLines } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { sliceList, workspaceSections } from '../lib/view.ts'
import type { DiscoveryView } from '../lib/discovery.ts'
import type { Row, Snapshot } from '../bridge.ts'
import EmptyState from '../components/EmptyState.vue'
import { platformBar } from './shared.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW — the layout budget the shell hands every scene. */
  width: number
  /** bodyH */
  height: number
  /** W: the wide-terminal breakpoint is a fraction of the window, not the body. */
  W: number
}>()

// `bodyW` / `bodyH` keep the row builders reading exactly as they did in the
// shell; they are just the props under the shell's names.
const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

const ws = computed(() => props.state.workspace)
const wsSections = computed(() => workspaceSections(ws.value as DiscoveryView | undefined))
const providers = computed(() => props.state.providers ?? [])

const RANK_CELLS = 4
const SCORE_CELLS = 6

// --- list + summary pane --------------------------------------------------
/** Two chrome rows (platform bar, section strip) and one hairline above the list. */
const listH = computed(() => Math.max(2, bodyH.value - 4))
const wide = computed(() => props.W >= 100)
const wsSelected = computed(() => ws.value?.rows[ws.value.cursor])
/** The pane is the selection's detail, so it only appears when there is one. */
const showSummary = computed(() => wide.value && (!!wsSelected.value || !!ws.value?.more))
const summaryW = computed(() =>
  showSummary.value ? Math.min(36, Math.max(26, Math.floor(bodyW.value * 0.3))) : 0,
)
const wsListWidth = computed(() =>
  Math.max(16, bodyW.value - (summaryW.value ? summaryW.value + 2 : 0)),
)
/** Blurb column: a fixed slice of the list so every row's blurb starts together. */
const blurbW = computed(() => Math.max(10, Math.floor(wsListWidth.value * 0.3)))
const wsHasBlurb = computed(() =>
  (ws.value?.rows ?? []).some((r) => r.desc || (r.tags ?? []).length),
)

/** A failed/notice line stays visible above cached rows instead of hiding them. */
const wsInline = computed(() => {
  const view = ws.value
  if (!view?.rows?.length) return false
  return !!(view.error || view.notice)
})
const wsRoom = computed(() => Math.max(1, listH.value - (wsInline.value ? 1 : 0)))
const wsRows = computed(() => {
  const rows = [...(ws.value?.rows ?? [])]
  if (ws.value?.more) rows.push({ title: '加载更多…', id: '__more__', sub: '' })
  return sliceList(rows, ws.value?.cursor ?? 0, wsRoom.value)
})

/** The centred block that replaces the list when there is nothing to show. */
const wsState = computed<{
  tone: 'info' | 'warn' | 'err'
  message: string
  hint: string
  loading: boolean
} | null>(() => {
  const view = ws.value
  if (!view?.rows?.length) {
    if (view?.error)
      return {
        tone: 'err',
        message: view.error,
        hint: /重试/.test(view.error) ? '' : '按 r 重试',
        loading: false,
      }
    if (view?.notice)
      return {
        tone: 'warn',
        message: view.notice,
        hint: /Key|平台|权限|设置/.test(view.notice) ? '按 F4 检查设置' : '按 r 刷新',
        loading: false,
      }
    if (view?.loading)
      return { tone: 'info', message: '正在读取平台栏目与内容…', hint: '', loading: true }
    if (!view) return null
    return providers.value.length
      ? { tone: 'info', message: '这个栏目暂无内容', hint: '按 / 搜索，或 r 刷新', loading: false }
      : {
          tone: 'warn',
          message: '当前 Key 没有可浏览的平台',
          hint: '按 F4 检查设置',
          loading: false,
        }
  }
  return null
})
const wsInlineLine = computed(() => {
  const view = ws.value
  if (!view) return new StyledText([])
  if (view.error)
    return new StyledText([
      fg(c.err)('✖ '),
      fg(c.err)(view.error),
      fg(c.faint)(/重试/.test(view.error) ? '' : '  ·  按 r 重试'),
    ])
  return new StyledText([fg(c.warn)('! '), fg(c.warn)(view.notice)])
})

/** `▌    1  标题 ………………  简介        ★9.1` — exact width, never wraps. */
function wsRow(row: Row, index: number) {
  const on = index === ws.value?.cursor
  const width = wsListWidth.value
  const all = ws.value?.rows ?? []
  const ranked = all.some((r) => r.rank)
  const scored = all.some((r) => r.score)
  const linked = all.some((r) => r.target?.type === 'search' || r.target?.type === 'channel')
  const target = row.target?.type === 'search' ? '搜索 →' : row.target?.type === 'channel' ? '频道 →' : ''
  const cols: Col[] = [markCol(on)]
  if (ranked) {
    cols.push(
      {
        text: row.rank ? String(row.rank) : '',
        cells: RANK_CELLS - 1,
        align: 'right',
        color: row.rank && row.rank <= 3 ? c.accent : c.faint,
        bold: false,
      },
      { text: '', cells: 1 },
    )
  }
  cols.push({ text: row.title, grow: true, color: on ? c.text : c.dim })
  if (wsHasBlurb.value)
    cols.push(
      { text: '', cells: 2 },
      {
        text: row.desc || (row.tags ?? []).join('·'),
        cells: blurbW.value,
        color: c.faint,
        bold: false,
      },
    )
  if (linked)
    cols.push(
      { text: '', cells: 2 },
      { text: target, cells: 6, align: 'right', color: c.faint, bold: false },
    )
  if (scored)
    cols.push(
      { text: '', cells: 2 },
      { text: row.score ? `★${row.score}` : '', cells: SCORE_CELLS, align: 'right', color: c.warn, bold: false },
    )
  return colsLine(cols, width, on)
}

// --- summary pane ---------------------------------------------------------
/** Title / score / blurb on top, the ⏎ hint pinned to the bottom edge. */
const wsSummary = computed(() => {
  const width = summaryW.value
  const row = wsSelected.value
  if (!width) return { lines: [] as StyledText[], hint: '' }
  if (!row) return { lines: [] as StyledText[], hint: '⏎ 加载更多' }
  const room = Math.max(1, listH.value - 1)
  const lines: StyledText[] = []
  const wrapped = wrapLines(row.title, width)
  const titles = wrapped.length > 2 ? [wrapped[0]!, clip(wrapped.slice(1).join(''), width)] : wrapped
  for (const text of titles) lines.push(ink(c.text, text, true))
  if (row.score) lines.push(new StyledText(chipChunks(`★ ${row.score}`, c.warn)))
  const blurb = [row.desc, (row.tags ?? []).join(' · ')].filter(Boolean).join('   ')
  if (blurb) {
    if (lines.length) lines.push(new StyledText([]))
    for (const text of wrapLines(blurb, width)) lines.push(ink(c.dim, text))
  }
  return {
    lines: lines.slice(0, room),
    hint: row.target?.type === 'search' ? '⏎ 搜索同名候选' : '⏎ 进入详情',
  }
})

// --- strip ----------------------------------------------------------------
const platformLine = computed(() =>
  platformBar(
    providers.value,
    bodyW.value,
    ws.value?.provider || '',
    ws.value?.mode === 'rank' ? 'rank' : 'rec',
  ),
)
/** Active filter labels (the view stores option values). */
const filterLabels = computed(() => {
  const active = ws.value?.filters ?? {}
  const defs = wsSections.value[ws.value?.sectionIndex ?? 0]?.filters ?? []
  return Object.entries(active).map(
    ([key, value]) => defs.find((f) => f.key === key)?.options.find((o) => o.value === value)?.label ?? value,
  )
})
/** Visible slice of the section tabs around `index`, with `‹ ›` when clipped. */
function sectionStrip(titles: string[], index: number, width: number): TextChunk[] {
  if (!titles.length || width <= 0) return [fg(c.faint)(' 没有栏目')]
  const cells = (from: number, to: number) =>
    tabsWidth(titles.slice(from, to + 1)) + (from > 0 ? 2 : 0) + (to < titles.length - 1 ? 2 : 0)
  let lo = Math.max(0, Math.min(index, titles.length - 1))
  let hi = lo
  while (lo > 0 || hi < titles.length - 1) {
    const canNext = hi < titles.length - 1 && cells(lo, hi + 1) <= width
    const canPrev = lo > 0 && cells(lo - 1, hi) <= width
    if (canNext && (hi - index <= index - lo || !canPrev)) hi += 1
    else if (canPrev) lo -= 1
    else break
  }
  return [
    ...(lo > 0 ? [fg(c.faint)('‹ ')] : []),
    ...titles.slice(lo, hi + 1).flatMap((title, i) => tabChunks(title, lo + i === index)),
    ...(hi < titles.length - 1 ? [fg(c.faint)(' ›')] : []),
  ]
}
const sectionLine = computed(() => {
  const right = [
    ws.value?.loading ? '加载中' : `${ws.value?.rows.length ?? 0} 条`,
    filterLabels.value.join('/'),
  ]
    .filter(Boolean)
    .join(' · ')
  const room = Math.max(8, bodyW.value - displayWidth(right) - 1)
  const strip = sectionStrip(
    wsSections.value.map((s) => s.title),
    ws.value?.sectionIndex ?? 0,
    room,
  )
  return colsLine(
    [
      { chunks: (cells) => [...strip, { __isChunk: true, text: ' '.repeat(Math.max(0, cells - strip.reduce((n, ch) => n + displayWidth(ch.text), 0))) }], grow: true },
      { text: right, cells: displayWidth(right), align: 'right', color: c.faint },
    ],
    bodyW.value,
  )
})
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="platformLine"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text
      :content="sectionLine"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text :content="hr(bodyW)" :width="bodyW" :height="1" />
    <Box flexDirection="row" :height="listH">
      <Box flexDirection="column" :width="wsListWidth" :height="listH">
        <EmptyState
          v-if="wsState"
          :width="wsListWidth"
          :height="listH"
          :tone="wsState.tone"
          :message="wsState.message"
          :hint="wsState.hint"
          :loading="wsState.loading"
        />
        <template v-else>
          <Text
            v-if="wsInline"
            :content="wsInlineLine"
            :width="wsListWidth"
            :height="1"
            wrapMode="none"
            :truncate="true"
          />
          <Text
            v-for="entry in wsRows.rows"
            :key="entry.index"
            :content="wsRow(entry.item, entry.index)"
            :width="wsListWidth"
            :height="1"
            wrapMode="none"
            :truncate="true"
            :bg="entry.index === ws?.cursor ? c.sel : undefined"
          />
        </template>
      </Box>
      <Box
        v-if="summaryW"
        :width="summaryW + 2"
        :height="listH"
        :paddingLeft="1"
        :border="['left']"
        :borderColor="c.line"
        flexDirection="column"
      >
        <Text
          v-for="(line, index) in wsSummary.lines"
          :key="index"
          :content="line"
          :width="summaryW"
          :height="1"
          wrapMode="none"
          :truncate="true"
        />
        <Box :flexGrow="1" />
        <Text
          :content="ink(c.faint, wsSummary.hint)"
          :width="summaryW"
          :height="1"
          wrapMode="none"
          :truncate="true"
        />
      </Box>
    </Box>
    <Text
      :content="
        ink(
          c.faint,
          `${ws?.compatibility ? '旧网关兼容 · ' : ''}${ws?.source || '公开内容'}`,
        )
      "
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
  </Box>
</template>
