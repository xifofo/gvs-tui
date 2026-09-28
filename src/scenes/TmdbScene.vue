<script setup lang="ts">
// 匹配: TMDB candidates for the open title. Each hit takes two rows — the name
// line and its synopsis.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bold, fg } from 'vue-termui'
import { ink, pickLine } from '../lib/rows.ts'
import { clip, column } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { tmdbWindow } from '../lib/view.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)

const tmdbView = computed(() =>
  tmdbWindow(props.state.tmdbHits, props.state.cursor, props.height),
)
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="
        new StyledText([
          fg(c.text)(bold(`「${clip(state.detail?.title || state.detailTitle || '', 30)}」`)),
          fg(c.faint)('  选一个 TMDB 条目，用于文件命名和刮削'),
        ])
      "
      :height="1"
      :width="bodyW"
      :truncate="true"
      :marginBottom="1"
    />
    <Text
      v-if="!tmdbView.total"
      :content="ink(c.dim, '没有匹配的候选  ·  s 跳过匹配，r 重试')"
      :height="2"
      :width="bodyW"
    />
    <Box
      v-for="entry in tmdbView.rows"
      :key="entry.item.id"
      flexDirection="column"
      :width="bodyW"
    >
      <Text
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
        :bg="entry.index === state.cursor ? c.sel : undefined"
        :content="
          pickLine(
            `${entry.item.name || entry.item.title}${entry.item.year ? ` (${entry.item.year})` : ''}`,
            `tmdb-${entry.item.id}`,
            bodyW,
            entry.index === state.cursor,
          )
        "
      />
      <Text
        v-if="entry.item.overview"
        :content="
          ink(
            entry.index === state.cursor ? c.dim : c.faint,
            `  ${column(entry.item.overview, Math.max(8, bodyW - 2))}`,
          )
        "
        :bg="entry.index === state.cursor ? c.sel : undefined"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
    </Box>
  </Box>
</template>
