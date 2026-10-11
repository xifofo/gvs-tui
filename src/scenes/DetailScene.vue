<script setup lang="ts">
// 选集: PageHeader, one facts line, the synopsis, the group tab strip, then
// either the movie edition list or the episode grid.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import type { TextChunk } from 'vue-termui'
import EpisodeGrid from '../components/EpisodeGrid.vue'
import PageHeader from '../components/PageHeader.vue'
import { chipChunks, colsLine, ink, markCol, tabsWidth } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth, wrapLines } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { isMovieDetail, sliceList } from '../lib/view.ts'
import { gridWindow } from '../lib/grid.ts'
import { detailListRows } from '../lib/ui-layout.ts'
import type { Episode, Snapshot } from '../types.ts'
import { tabStrip } from './shared.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

const episodes = computed(() => props.state.episodes ?? [])
const detail = computed(() => props.state.detail)
const isMovie = computed(() => isMovieDetail(detail.value))
const selectedEpisode = computed(() => episodes.value[props.state.cursor])

/** Keep selection compact; the full synopsis is a separate scrollable view. */
const synopsis = computed(() => {
  const desc = (props.state.detail?.desc ?? '').replace(/\s+/g, ' ').trim()
  if (!desc) return null
  return colsLine([
    { text: `  ${desc}`, grow: true, color: c.faint },
    { text: '  I 简介', cells: 8, color: c.dim },
  ], bodyW.value)
})
const expandedLines = computed(() => {
  const lines = wrapLines(detail.value?.desc || '暂无简介', bodyW.value)
  const room = Math.max(1, bodyH.value - 2)
  const offset = Math.min(props.state.contentOffset || 0, Math.max(0, lines.length - room))
  return lines.slice(offset, offset + room)
})

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** `奇幻短剧 · 奇幻/古代/乡村 · 评分 8.0 · 每集约 0:40 · CENC 加密…` */
const detailFacts = computed(() => {
  const d = props.state.detail
  if (!d) return null
  const parts: string[] = []
  if (d.tags?.length) parts.push(d.tags.join('·'))
  if (d.score) parts.push(`评分 ${d.score}`)
  const firstLen = episodes.value[0]?.duration ?? 0
  if (d.episodes <= 1 && d.duration > 0) parts.push(`时长 ${clock(d.duration)}`)
  else if (firstLen > 0) parts.push(`每集约 ${clock(firstLen)}`)
  if (d.drm) parts.push(d.drm)
  if (!parts.length) return null
  return ink(c.dim, `  ${clip(parts.join('  ·  '), Math.max(4, bodyW.value - 2))}`)
})

/** One tab per episode group; the right side keeps the `[ ]` key hint. */
const groupTabs = computed(() => {
  const labels = props.state.episodeGroups ?? []
  if (labels.length <= 1) return null
  const current = props.state.episodeGroup ?? labels[0]
  const hint = '[ ] 切换分组'
  const room = Math.max(8, bodyW.value - displayWidth(hint) - 2)
  const cells = Math.min(tabsWidth(labels), room)
  return colsLine(
    [
      { chunks: (w: number) => tabStrip(labels, Math.max(0, labels.indexOf(current!)), w), cells },
      { text: hint, grow: true, align: 'right', color: c.faint },
    ],
    bodyW.value,
  )
})

/**
 * The cursor line above the grid: `E21` in the accent, its runtime quiet and
 * the episode title faint — plus where the visible rows sit while scrolled.
 * The movie edition list carries the same facts per row, so it goes without.
 */
const episodeLine = computed(() => {
  const ep = selectedEpisode.value
  if (!ep || isMovie.value) return null
  const title = (ep.title || '').trim()
  const scroll = scrollLabel.value
  const label = `  E${String(ep.number).padStart(2, '0')}`
  const chunks: TextChunk[] = [fg(c.accent)(bold(label))]
  let used = displayWidth(label)
  const len = clock(ep.duration ?? 0)
  if (len) {
    chunks.push(fg(c.dim)(` · ${len}`))
    used += 3 + displayWidth(len)
  }
  if (title) {
    const room = Math.max(6, bodyW.value - used - displayWidth(scroll) - 4)
    const text = displayWidth(title) > room ? clip(title, room) : title
    chunks.push(fg(c.faint)(`  ${text}`))
    used += 2 + displayWidth(text)
  }
  if (scroll) {
    const room = Math.max(0, bodyW.value - used - 2)
    chunks.push(fg(c.faint)(`  ${clip(scroll, room)}`))
  }
  return new StyledText(chunks)
})

/**
 * `行 3-15 / 22` — only drawn when the grid is actually scrolled and the label
 * still fits next to the episode line, so an untouched list stays quiet.
 */
const scrollLabel = computed(() => {
  if (!selectedEpisode.value || isMovie.value) return ''
  const start = view.value.startRow + 1
  const label = `行 ${start}-${start + Math.min(view.value.totalRows, gridRows.value) - 1} / ${view.value.totalRows}`
  return view.value.startRow > 0 && displayWidth(label) <= Math.max(0, bodyW.value - 40)
    ? label
    : ''
})

const gridRows = computed(() => detailListRows(bodyH.value, props.state))
const editions = computed(() => sliceList(episodes.value, props.state.cursor, gridRows.value))
const view = computed(() =>
  gridWindow(episodes.value.length, props.state.cursor, bodyW.value, gridRows.value),
)

/** `151 集` / `电影` / `N 个版本` */
const detailCountLabel = computed(() => {
  if (isMovie.value)
    return episodes.value.length > 1 ? `${episodes.value.length} 个版本` : '电影'
  return `${episodes.value.length} 集`
})

const titleChips = computed<TextChunk[]>(() => [
  ...(props.state.detail?.vip ? chipChunks('VIP', c.violet) : []),
  { __isChunk: true, text: ' ' },
  ...chipChunks(detailCountLabel.value, c.dim),
])

/** Movie editions: `▌ ✓  国语版 …………………………… 1:23:45`, like every other list. */
function editionLine(ep: Episode, here: boolean): StyledText {
  const cols: Col[] = [
    markCol(here),
    {
      text: `${ep.selected ? '✓' : '□'}  ${ep.title || '正片'}`,
      grow: true,
      color: here ? c.text : ep.selected ? c.ok : c.faint,
    },
    {
      text: clock(ep.duration ?? 0),
      cells: 8,
      align: 'right',
      color: c.faint,
    },
  ]
  return colsLine(cols, bodyW.value)
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <template v-if="state.detailExpanded">
      <PageHeader title="完整简介" right="I / Esc 收起" :width="bodyW" />
      <Text v-for="(line, index) in expandedLines" :key="index" :content="ink(c.text, line)" :width="bodyW" :height="1" wrapMode="none" />
    </template>
    <template v-else>
    <PageHeader
      :title="state.detail?.title || state.detailTitle || (isMovie ? '电影' : '剧集')"
      :subtitle="state.detail?.category || ''"
      :rightChunks="titleChips"
      :width="bodyW"
    />
    <Text
      v-if="detailFacts"
      :content="detailFacts"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text
      v-if="synopsis"
      :content="synopsis"
      :width="bodyW"
      :height="1"
      wrapMode="none"
    />
    <Text
      v-if="groupTabs"
      :content="groupTabs"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text
      v-if="episodeLine"
      :content="episodeLine"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
      :marginTop="1"
    />
    <Text
      v-if="!episodes.length"
      :content="ink(c.faint, '这部没有返回正片，esc 返回换一部')"
      :height="1"
      :marginTop="1"
    />
    <Box
      v-else-if="isMovie"
      flexDirection="column"
      :width="bodyW"
      :marginTop="1"
    >
      <Text
        v-for="entry in editions.rows"
        :key="entry.item.vid || entry.index"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
        :bg="entry.index === state.cursor ? c.sel : undefined"
        :content="editionLine(entry.item, entry.index === state.cursor)"
      />
    </Box>
    <EpisodeGrid
      v-else
      :episodes="episodes"
      :cursor="state.cursor"
      :width="bodyW"
      :rows="gridRows"
    />
    </template>
  </Box>
</template>
