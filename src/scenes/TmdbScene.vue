<script setup lang="ts">
// 匹配: TMDB candidates for the open title. Each hit is a two-row card — the
// name line and its synopsis — separated by a blank row when there is room.
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import EmptyState from '../components/EmptyState.vue'
import PageHeader from '../components/PageHeader.vue'
import { colsLine, ink, markCol } from '../lib/rows.ts'
import { clip, column, displayWidth } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { sliceList, tmdbWindow } from '../lib/view.ts'
import type { Snapshot } from '../types.ts'
import type { TmdbSeason } from '../lib/tmdb-types.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
/** Rows between two cards: 0 in a short frame, 1 when the list has room. */
const gap = computed(() => (props.height >= 10 ? 1 : 0))
const tmdbView = computed(() =>
  tmdbWindow(props.state.tmdbHits, props.state.cursor, props.height),
)

const picker = computed(() => props.state.tmdbSeasonPicker)
const seasonView = computed(() => sliceList([
  { number: -1, name: '沿用平台季号', episodeCount: 0, airDate: '' } as TmdbSeason,
  ...(picker.value?.seasons ?? []),
], props.state.cursor, props.height - 3))
const loading = computed(() => picker.value ? picker.value.state === 'loading' : props.state.tmdbState === 'loading' || (props.state.busy && !tmdbView.value.total))
const failed = computed(() => picker.value ? picker.value.state === 'error' : props.state.tmdbState === 'error')
const countLabel = computed(() =>
  loading.value ? '读取中' : picker.value ? `${picker.value.seasons.length} 个季号选项` : tmdbView.value.total ? `${tmdbView.value.total} 个候选` : '',
)
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      :title="picker ? '选择 TMDB 季号' : '匹配 TMDB'"
      :subtitle="picker ? `「${clip(picker.title, 28)}」 · 整批输出季号，集号沿用平台` : `「${clip(state.detail?.title || state.detailTitle || '', 28)}」 · 用于文件命名和刮削`"
      :right="countLabel"
      :width="bodyW"
    />
    <EmptyState
      v-if="loading"
      :width="bodyW"
      :height="Math.max(1, height - 2)"
      loading
      :message="picker ? '正在读取 TMDB 季列表…' : '正在搜索 TMDB 电影和剧集…'"
      :hint="picker ? 'esc 保留当前编号' : 's 跳过匹配，esc 返回画质'"
    />
    <EmptyState
      v-else-if="failed"
      :width="bodyW"
      :height="Math.max(1, height - 2)"
      tone="err"
      :message="picker ? `季列表读取失败：${picker.error}` : state.tmdbError ? `TMDB 搜索失败：${state.tmdbError}` : 'TMDB 搜索失败'"
      :hint="picker ? 'r 重试，esc 保留当前编号' : 's 跳过匹配，r 重试'"
    />
    <Box v-else-if="picker" flexDirection="column" :width="bodyW">
      <Text :width="bodyW" :height="1" :content="picker.warning ? '  剧集分组读取不完整，R 重试；已读取季号仍可选。' : picker.seasons.length ? '  普通季或剧集分组仅用于输出季号，集号沿用平台。' : '  TMDB 暂无季列表，可沿用平台季号下载。'" :fg="picker.warning ? c.warn : c.dim" />
      <Text v-for="entry in seasonView.rows" :key="entry.index" :width="bodyW" :height="1" wrapMode="none" :truncate="true"
        :bg="entry.index === state.cursor ? c.sel : undefined"
        :content="colsLine([
          markCol(entry.index === state.cursor),
          { text: [entry.item.groupId ? `[${entry.item.groupName}]` : '', entry.item.name, entry.item.episodeCount ? `${entry.item.episodeCount} 集` : '', entry.item.airDate.slice(0, 4)].filter(Boolean).join(' · '), grow: true, color: entry.index === state.cursor ? c.text : c.dim },
          { text: entry.item.number < 0 ? '' : `S${String(entry.item.number).padStart(2, '0')}`, cells: 6, align: 'right', color: c.faint },
        ], bodyW, entry.index === state.cursor)" />
    </Box>
    <EmptyState
      v-else-if="!tmdbView.total"
      :width="bodyW"
      :height="Math.max(1, height - 2)"
      message="未找到匹配影片"
      hint="s 跳过匹配，r 重试"
    />
    <Box v-else flexDirection="column" :width="bodyW">
      <template v-for="(entry, i) in tmdbView.rows" :key="entry.item.id">
        <Text
          v-if="i > 0 && gap"
          :content="' '"
          :width="bodyW"
          :height="1"
        />
        <Text
          :width="bodyW"
          :height="1"
          wrapMode="none"
          :truncate="true"
          :bg="entry.index === state.cursor ? c.sel : undefined"
          :content="
            colsLine(
              [
                markCol(entry.index === state.cursor),
                {
                  text: `${entry.item.name || entry.item.title}${entry.item.year ? ` (${entry.item.year})` : ''}`,
                  grow: true,
                  color: entry.index === state.cursor ? c.text : c.dim,
                },
                {
                  text: `tmdb-${entry.item.id}`,
                  cells: displayWidth(`tmdb-${entry.item.id}`),
                  align: 'right',
                  color: c.faint,
                },
              ],
              bodyW,
              entry.index === state.cursor,
            )
          "
        />
        <Text
          :content="
            ink(
              entry.index === state.cursor ? c.dim : c.faint,
              `    ${column(entry.item.overview || '（无简介）', Math.max(8, bodyW - 4))}`,
            )
          "
          :bg="entry.index === state.cursor ? c.sel : undefined"
          :width="bodyW"
          :height="1"
          wrapMode="none"
          :truncate="true"
        />
      </template>
    </Box>
  </Box>
</template>
