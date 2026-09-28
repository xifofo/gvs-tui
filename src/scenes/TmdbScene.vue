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
import { tmdbWindow } from '../lib/view.ts'
import type { Snapshot } from '../types.ts'

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

const countLabel = computed(() =>
  tmdbView.value.total ? `${tmdbView.value.total} 个候选` : '',
)
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      title="匹配 TMDB"
      :subtitle="`「${clip(state.detail?.title || state.detailTitle || '', 28)}」 · 用于文件命名和刮削`"
      :right="countLabel"
      :width="bodyW"
    />
    <EmptyState
      v-if="!tmdbView.total"
      :width="bodyW"
      :height="Math.max(1, height - 2)"
      message="没有匹配的候选"
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
