<script setup lang="ts">
// 快捷键: the scrollable key reference. The shell owns the cursor.
//
// A wide terminal gets the same groups side by side (发现页 + 随处可用 on the
// left, 下载 on the right) instead of a long ribbon of one-liners; a narrow one
// keeps the single scrollable column, still windowed around `state.cursor`.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import { colsLine, ruleLine } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'
import PageHeader from '../components/PageHeader.vue'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)
/** PageHeader takes two rows. */
const listH = computed(() => Math.max(1, bodyH.value - 2))

const KEY_CELLS = 10

type Group = { id: string; title: string; rows: Array<[string, string]> }

const HELP: Group[] = [
  {
    id: 'discover',
    title: '发现页',
    rows: [
      ['1-7', '切平台：1 优酷  2 腾讯  3 红果  4 黄果  5 抖音  6 mewatch  7 Hami'],
      ['← →', '换栏目；只有一个栏目时切推荐/榜单'],
      ['tab', '推荐 / 榜单'],
      ['⏎', '打开选中的节目'],
      ['/  f  r', '搜索 · 筛选 · 刷新'],
    ],
  },
  {
    id: 'download',
    title: '下载：选集 › 画质 › 匹配 › 确认（确认页回车才入队）',
    rows: [
      ['空格', '勾选当前集；⇧方向 从当前集连选'],
      ['a  c', '全选 · 清空'],
      ['← →', '画质页切到音轨，空格勾选要封装的音轨'],
      ['⏎  s  r', '匹配页：采用 · 跳过 · 重试'],
    ],
  },
  {
    id: 'global',
    title: '随处可用',
    rows: [
      ['F1-F4', '帮助 · 搜索 · 任务 · 设置'],
      ['esc', '返回上一步（不会入队）'],
      ['^C', '退出'],
      ['^1-7', 'Windows Terminal 会吃掉 Alt+数字，用 Ctrl+数字切平台'],
    ],
  },
]

/** `  ⏎  s  r   匹配页：采用 · 跳过 · 重试` — key column in the accent color. */
function keyLine(keys: string, desc: string, width: number): StyledText {
  return colsLine(
    [
      { text: '  ', cells: 2 },
      { text: keys, cells: KEY_CELLS, color: c.accent, bold: false },
      { text: desc, grow: true, color: c.dim },
    ],
    width,
  )
}

/** A group as a list of lines: its rule, then one line per key. */
function groupLines(group: Group, width: number): StyledText[] {
  return [ruleLine(group.title, width), ...group.rows.map(([keys, desc]) => keyLine(keys, desc, width))]
}

/** Single column: 18 lines, exactly the total the shell's cursor walks. */
const lines = computed<StyledText[]>(() => {
  const out: StyledText[] = []
  HELP.forEach((group, index) => {
    if (index) out.push(new StyledText([]))
    out.push(...groupLines(group, bodyW.value))
  })
  return out
})

/** Two columns once there is room for both without squeezing the descriptions. */
const twoCol = computed(() => bodyW.value >= 110 && listH.value >= 12)
const colW = computed(() => Math.max(24, Math.floor((bodyW.value - 2) / 2)))
const colRightW = computed(() => Math.max(8, bodyW.value - colW.value - 2))
const leftLines = computed(() => [
  ...groupLines(HELP[0]!, colW.value),
  new StyledText([]),
  ...groupLines(HELP[2]!, colW.value),
])
const rightLines = computed(() => groupLines(HELP[1]!, colRightW.value))

/** The window the shell's cursor selects; at the end the tail stays in view. */
const windowStart = computed(() =>
  Math.min(props.state.cursor, Math.max(0, lines.value.length - listH.value)),
)
const windowLines = computed(() => lines.value.slice(windowStart.value, windowStart.value + listH.value))
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader title="快捷键" :width="bodyW" />
    <Box v-if="twoCol" flexDirection="row" :width="bodyW" :height="listH">
      <Box flexDirection="column" :width="colW" :height="listH">
        <Text
          v-for="(line, index) in leftLines"
          :key="`l-${index}`"
          :content="line"
          :height="1"
          :width="colW"
          wrapMode="none"
          :truncate="true"
        />
      </Box>
      <Box flexDirection="column" :width="bodyW - colW" :height="listH" :paddingLeft="2">
        <Text
          v-for="(line, index) in rightLines"
          :key="`r-${index}`"
          :content="line"
          :height="1"
          :width="colRightW"
          wrapMode="none"
          :truncate="true"
        />
      </Box>
    </Box>
    <Text
      v-for="(line, index) in twoCol ? [] : windowLines"
      :key="index"
      :content="line"
      :height="1"
      :width="bodyW"
      wrapMode="none"
      :truncate="true"
    />
  </Box>
</template>
