<script setup lang="ts">
// 选集: title, synopsis and facts, then either the movie edition list or the
// episode grid.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import EpisodeGrid from '../components/EpisodeGrid.vue'
import { colsLine, ink } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { clip, displayWidth, wrapLines } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { isMovieDetail } from '../lib/view.ts'
import type { Episode, Snapshot } from '../bridge.ts'

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

const gridRows = computed(() =>
  Math.max(1, bodyH.value - (props.state.detail?.desc ? 6 : 4)),
)

/** Synopsis as at most two indented lines; the second one ends in `..` when cut. */
const descLines = computed(() => {
  const desc = (props.state.detail?.desc ?? '').replace(/\s+/g, ' ').trim()
  if (!desc) return []
  const room = Math.max(10, bodyW.value - 2)
  const lines = wrapLines(desc, room)
  if (lines.length > 2) lines[1] = clip(`${lines[1]}${lines[2]}`, room)
  return lines.slice(0, 2).map((line) => `  ${line}`)
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

/** `奇幻短剧 · 奇幻/古代/乡村 · 评分 8.0 · 总时长 1:21:50` */
const detailFacts = computed(() => {
  const d = props.state.detail
  if (!d) return ''
  const parts: string[] = []
  if (d.category) parts.push(d.category)
  if (d.tags?.length) parts.push(d.tags.join('/'))
  if (d.score) parts.push(`评分 ${d.score}`)
  const firstLen = episodes.value[0]?.duration ?? 0
  if (d.episodes <= 1 && d.duration > 0) parts.push(`时长 ${clock(d.duration)}`)
  else if (firstLen > 0) parts.push(`每集约 ${clock(firstLen)}`)
  if (d.drm) parts.push(d.drm)
  return parts.length ? clip(`  ${parts.join('  ·  ')}`, bodyW.value) : ''
})

const episodeLine = computed(() => {
  const ep = selectedEpisode.value
  if (!ep) return ''
  const bits: string[] = isMovie.value
    ? [ep.title || '正片']
    : [`E${String(ep.number).padStart(2, '0')}`]
  const len = clock(ep.duration ?? 0)
  if (len) bits.push(len)
  const title = isMovie.value ? '' : (ep.title || '').trim()
  return new StyledText([
    fg(c.accent)(bold(`  ${bits.join(' · ')}`)),
    fg(c.faint)(
      title ? `  ${clip(title, Math.max(10, bodyW.value - 24))}` : '',
    ),
  ])
})

const detailCountLabel = computed(() => {
  if (isMovie.value)
    return episodes.value.length > 1
      ? `${episodes.value.length} 个版本`
      : '电影'
  return `${episodes.value.length} 集`
})

function editionLine(ep: Episode, here: boolean) {
  const mark = ep.selected ? '✓' : '□'
  const cols: Col[] = [
    {
      text: `${mark}  ${ep.title || '正片'}`,
      grow: true,
      color: here ? c.text : ep.selected ? c.ok : c.faint,
      bold: here,
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
    <Text
      :content="
        colsLine(
          [
            {
              text:
                state.detail?.title ||
                state.detailTitle ||
                (isMovie ? '电影' : '剧集'),
              grow: true,
              color: c.text,
              bold: true,
            },
            {
              text: state.detail?.vip ? 'VIP' : '',
              cells: 4,
              align: 'right',
              color: c.violet,
            },
            {
              text: detailCountLabel,
              cells: displayWidth(detailCountLabel),
              align: 'right',
              color: c.faint,
            },
          ],
          bodyW,
        )
      "
      :width="bodyW"
      :height="1"
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
      v-for="(line, i) in descLines"
      :key="`desc-${i}`"
      :content="ink(c.faint, line)"
      :width="bodyW"
      :height="1"
      wrapMode="none"
    />
    <Text
      v-if="(state.episodeGroups?.length ?? 0) > 1"
      :content="ink(c.accent, `[ / ] 切换栏目 · ${state.episodeGroup} · ${state.episodeGroups?.join(' / ')}`)"
      :width="bodyW" :height="1" wrapMode="none" :truncate="true"
    />
    <Text
      v-if="selectedEpisode && !isMovie"
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
    />
    <Box
      v-else-if="isMovie"
      flexDirection="column"
      :width="bodyW"
      :marginTop="1"
    >
      <Text
        v-for="(ep, i) in episodes"
        :key="ep.vid || i"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
        :bg="i === state.cursor ? c.sel : undefined"
        :content="editionLine(ep, i === state.cursor)"
      />
    </Box>
    <EpisodeGrid
      v-else
      :episodes="episodes"
      :cursor="state.cursor"
      :width="bodyW"
      :rows="gridRows"
    />
  </Box>
</template>
