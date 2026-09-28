<script setup lang="ts">
// 发现 / 首页: platform tabs, a section strip with the active filters on the
// right, and the content list. On a wide terminal a summary pane sits to the
// right of the list.
import { computed } from 'vue-termui'
// `fg` / `bold` / `StyledText` are template-level too: the error row builds a
// StyledText inline, exactly as it did in the shell.
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import { colsLine, ink, markCol, tabChunks, tabsWidth } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { displayWidth } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { sliceList, workspaceSections } from '../lib/view.ts'
import type { DiscoveryView } from '../lib/discovery.ts'
import type { Row, Snapshot } from '../bridge.ts'
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

// --- rows -----------------------------------------------------------------
const wide = computed(() => props.W >= 120)
const wsSummaryWidth = computed(() => (wide.value ? 30 : 0))
const wsListWidth = computed(() =>
  Math.max(16, bodyW.value - (wide.value ? wsSummaryWidth.value + 2 : 0)),
)
const wsRows = computed(() => {
  const rows = [...(ws.value?.rows ?? [])]
  if (ws.value?.more) rows.push({ title: '加载更多…', id: '__more__', sub: '' })
  return sliceList(
    rows,
    ws.value?.cursor ?? 0,
    bodyH.value - 3 - (ws.value?.error || ws.value?.notice ? 3 : 0),
  )
})
const wsSelected = computed(() => ws.value?.rows[ws.value.cursor])

/**
 * Pack a list row to the left: the title column is only as wide as the widest
 * title in the list, so the blurb sits next to the titles instead of floating
 * at the far edge; a trailing spacer takes the slack.
 */
function packTitle(cols: Col[], titleAt: number, rows: Row[] | undefined, width: number): Col[] {
  const widest = (rows ?? []).reduce((n, r) => Math.max(n, displayWidth(r.title)), 0)
  const rest = cols.reduce((n, col, i) => n + (i === titleAt ? 0 : (col.cells ?? 0)), 0)
  cols[titleAt] = { ...cols[titleAt]!, grow: false, cells: Math.max(6, Math.min(widest + 2, width - rest)) }
  return [...cols, { text: '', grow: true }]
}

/** One blurb column width per list, so the blurbs line up across rows. */
function blurbCells(rows: Row[] | undefined, width: number): number {
  const widest = (rows ?? []).reduce((n, r) => Math.max(n, displayWidth(r.desc || (r.tags ?? []).join('·'))), 0)
  return Math.min(widest, Math.floor(width * 0.4))
}

function wsRow(row: Row, index: number) {
  const on = index === ws.value?.cursor
  const width = wsListWidth.value
  const target =
    row.target?.type === 'search' ? '搜索 →' : row.target?.type === 'channel' ? '频道 →' : ''
  const all = ws.value?.rows ?? []
  const desc = row.desc || (row.tags ?? []).join('·')
  const descW = blurbCells(all, width)
  const cols: Col[] = [
    markCol(on),
    {
      text: row.rank ? String(row.rank).padStart(3, ' ') + '  ' : '',
      cells: all.some((r) => r.rank) ? 5 : 0,
      color: row.rank && row.rank <= 3 ? c.accent : c.faint,
      bold: false,
    },
    { text: row.title, grow: true, color: on ? c.text : c.dim },
  ]
  if (descW) cols.push({ text: '', cells: 2 }, { text: desc, cells: descW, color: c.faint, bold: false })
  if (all.some((r) => r.score))
    cols.push({ text: row.score ? `★${row.score}` : '', cells: 7, align: 'right', color: c.warn, bold: false })
  if (all.some((r) => r.target?.type === 'search' || r.target?.type === 'channel'))
    cols.push({ text: target, cells: 8, align: 'right', color: c.faint, bold: false })
  return colsLine(packTitle(cols, 2, ws.value?.rows, width), width, on)
}

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
    <Box flexDirection="row" :height="Math.max(2, bodyH - 3)">
      <Box flexDirection="column" :width="wsListWidth">
        <Text
          v-if="ws?.error"
          :content="
            new StyledText([
              fg(c.err)(bold('✖ ')),
              fg(c.err)(ws.error),
              fg(c.faint)(/重试/.test(ws.error) ? '' : '  ·  按 r 重试'),
            ])
          "
          :width="wsListWidth"
          :height="2"
          :marginTop="1"
        />
        <Text
          v-else-if="ws?.notice"
          :content="ink(c.warn, '! ' + ws.notice)"
          :width="wsListWidth"
          :height="2"
          :marginTop="1"
        />
        <Text
          v-if="!wsRows.total && !ws?.loading && !ws?.notice && !ws?.error"
          :content="
            ink(
              c.dim,
              providers.length
                ? '这个栏目暂无内容  ·  按 / 搜索，或 r 刷新'
                : '当前 Key 没有可浏览的平台  ·  按 F4 检查设置',
            )
          "
          :width="wsListWidth"
          :height="2"
          :marginTop="1"
        />
        <Text
          v-if="ws?.loading && !wsRows.total"
          :content="ink(c.faint, '正在读取平台栏目与内容…')"
          :height="1"
          :marginTop="1"
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
      </Box>
      <Box
        v-if="wide"
        :width="wsSummaryWidth + 2"
        :paddingLeft="1"
        :border="['left']"
        :borderColor="c.line"
        flexDirection="column"
        ><Text
          :content="ink(c.text, wsSelected?.title || '未选中', true)"
          :width="wsSummaryWidth"
          :height="displayWidth(wsSelected?.title || '') > wsSummaryWidth ? 2 : 1"
          wrapMode="char" /><Text
          v-if="wsSelected?.score"
          :content="ink(c.warn, `★ ${wsSelected.score}`)"
          :height="1"
          :marginTop="1" /><Text
          v-if="wsSelected?.desc || wsSelected?.tags?.length"
          :content="ink(c.dim, [wsSelected?.desc, (wsSelected?.tags ?? []).join(' · ')].filter(Boolean).join('\n\n'))"
          :width="wsSummaryWidth"
          :marginTop="1"
          wrapMode="char" /><Text
          v-if="wsSelected"
          :content="ink(c.faint, wsSelected.target?.type === 'search' ? '⏎ 搜索同名候选' : '⏎ 进入详情')"
          :height="1"
          :marginTop="1"
      /></Box>
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
