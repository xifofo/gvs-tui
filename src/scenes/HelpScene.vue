<script setup lang="ts">
// 快捷键: the scrollable key reference. The shell owns the cursor.
import { computed } from 'vue-termui'
import { Box, StyledText, Text } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { column } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'
import { fg } from 'vue-termui'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

const HELP: Array<[string, Array<[string, string]>]> = [
  [
    '发现页',
    [
      ['1-4', '切平台：1 优酷  2 腾讯  3 红果  4 抖音'],
      ['← →', '换栏目；只有一个栏目时切推荐/榜单'],
      ['tab', '推荐 / 榜单'],
      ['⏎', '打开选中的节目'],
      ['/  f  r', '搜索 · 筛选 · 刷新'],
    ],
  ],
  [
    '下载：选集 › 画质 › 匹配 › 确认（确认页回车才入队）',
    [
      ['空格', '勾选当前集；⇧方向 从当前集连选'],
      ['a  c', '全选 · 清空'],
      ['← →', '画质页切到音轨，空格勾选要封装的音轨'],
      ['⏎  s  r', '匹配页：采用 · 跳过 · 重试'],
    ],
  ],
  [
    '随处可用',
    [
      ['F1-F4', '帮助 · 搜索 · 任务 · 设置'],
      ['esc', '返回上一步（不会入队）'],
      ['^C', '退出'],
      ['^1-4', 'Windows Terminal 会吃掉 Alt+数字，用 Ctrl+数字切平台'],
    ],
  ],
]
const helpLines = computed(() => {
  const out: StyledText[] = []
  HELP.forEach(([title, rows], i) => {
    if (i) out.push(new StyledText([]))
    out.push(ink(c.accent, title, true))
    for (const [keys, desc] of rows)
      out.push(new StyledText([fg(c.text)(`  ${column(keys, 10)}`), fg(c.dim)(desc)]))
  })
  return out
})
</script>

<template>
  <Box flexDirection="column"
    ><Text
      v-for="(line, index) in helpLines.slice(
        Math.min(state.cursor, Math.max(0, helpLines.length - bodyH)),
        Math.min(state.cursor, Math.max(0, helpLines.length - bodyH)) +
          bodyH,
      )"
      :key="index"
      :content="line"
      :height="1"
      :width="bodyW"
      :truncate="true"
  /></Box>
</template>
