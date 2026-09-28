<script setup lang="ts">
// 确认: the last step of the wizard. Enter is what actually queues the job, so
// the screen is a card that reads back exactly what will be created, with the
// primary action right under it.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, bg, bold, fg } from 'vue-termui'
import PageHeader from '../components/PageHeader.vue'
import { colsLine } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../types.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
  /** H: the rule spacing tightens when the window is short. */
  H: number
}>()

const bodyW = computed(() => props.width)

type Kv = { label: string; value: string }

/** The five things the job is made of, in the order the wizard asked for them. */
const rows = computed<Kv[]>(() => [
  { label: '集数', value: props.state.confirmation?.episodes || '—' },
  { label: '画质', value: props.state.confirmation?.quality || '—' },
  { label: '音轨', value: props.state.confirmation?.audio || '—' },
  { label: '目录', value: props.state.confirmation?.directory || '—' },
  { label: '文件名', value: props.state.confirmation?.name || '—' },
])

/**
 * A short window drops the blank line between the selection rows and the paths
 * before it drops anything that carries information.
 */
const roomy = computed(() => props.H >= 30)
/** Rows as drawn: the group gap costs one row, and the card border costs four. */
const contentRows = computed(() => rows.value.length + (roomy.value ? 1 : 0))
const cardRows = computed(() => contentRows.value + 4)
/** PageHeader (2) + gap + card + gap + button has to fit in the body budget. */
const useBorder = computed(() => cardRows.value <= props.height - 5)
const cardH = computed(() => (useBorder.value ? cardRows.value : contentRows.value))
const innerW = computed(() => Math.max(8, bodyW.value - (useBorder.value ? 6 : 4)))

/** `集数 ……… 1, 2, 3` — fixed 8-cell label column, value on the same grid. */
function kv(label: string, value: string): StyledText {
  const strong = label === '目录' || label === '文件名'
  return colsLine(
    [
      { text: label, cells: 8, color: c.faint },
      { text: value, grow: true, color: c.text, bold: strong },
    ],
    innerW.value,
  )
}

/** ` ⏎ 加入下载队列 ` on the accent, the two secondary keys quiet beside it. */
const buttonLine = computed(() =>
  colsLine(
    [
      {
        chunks: () => [bg(c.accent)(fg(c.bg)(bold(' ⏎ 加入下载队列 ')))],
        cells: 16,
      },
      { text: '   o 改目录  ·  esc 返回画质', grow: true, color: c.faint },
    ],
    bodyW.value,
  ),
)
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader
      title="确认下载"
      :subtitle="state.confirmation?.title || ''"
      right="回车后才会创建任务"
      :width="bodyW"
    />
    <Text :content="' '" :width="bodyW" :height="1" />
    <Box
      flexDirection="column"
      :width="bodyW"
      :height="cardH"
      :border="useBorder"
      borderStyle="rounded"
      :borderColor="c.line"
      :backgroundColor="c.panel"
      :paddingLeft="2"
      :paddingRight="2"
      :paddingTop="useBorder ? 1 : 0"
      :paddingBottom="useBorder ? 1 : 0"
    >
      <template v-for="(row, i) in rows" :key="row.label">
        <Text
          v-if="roomy && i === 3"
          :content="' '"
          :width="innerW"
          :height="1"
        />
        <Text
          :content="kv(row.label, row.value)"
          :width="innerW"
          :height="1"
          wrapMode="none"
          :truncate="true"
        />
      </template>
    </Box>
    <Text :content="' '" :width="bodyW" :height="1" />
    <Text
      :content="buttonLine"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
  </Box>
</template>
