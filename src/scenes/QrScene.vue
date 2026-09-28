<script setup lang="ts">
// 扫码登录: the QR block, centred, with the PNG paths as a fallback when the
// window cannot hold it.
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { displayWidth } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

/** Never crop a QR. Quiet-zone rows are spaces — keep them. Hide rather than slice. */
const qrLines = computed(() => {
  const raw = props.state.qrAscii || ''
  if (!raw) return [] as string[]
  return raw.replace(/\n$/, '').split('\n')
})
const qrOverflow = computed(() => {
  const lines = qrLines.value
  if (!lines.length) return false
  const room = Math.max(0, bodyH.value - 6)
  const widest = lines.reduce(
    (max, line) => Math.max(max, displayWidth(line)),
    0,
  )
  return lines.length > room || widest > bodyW.value
})
const qrBlock = computed(() => {
  if (qrOverflow.value) return ''
  const lines = qrLines.value
  const widest = lines.reduce(
    (max, line) => Math.max(max, displayWidth(line)),
    0,
  )
  const indent = ' '.repeat(Math.max(0, Math.floor((bodyW.value - widest) / 2)))
  return lines.map((line) => indent + line).join('\n')
})
const qrPngHint = computed(() => {
  const paths = props.state.qrPngPaths ?? []
  if (!paths.length) return ''
  return `扫码图片（绝对路径）\n${paths.join('\n')}`
})
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="ink(c.dim, state.qrHint || '用优酷 App 扫码登录，登录态会写进本机')"
      :height="1"
    />
    <Box :height="1" />
    <Text
      v-if="qrOverflow"
      :content="
        ink(c.warn, '窗口太小画不下完整二维码，请打开下面路径的 PNG')
      "
    />
    <Text
      v-else-if="qrBlock"
      :content="qrBlock"
      :fg="c.text"
      wrapMode="none"
    />
    <Text
      v-else
      :content="ink(c.ok, '二维码图片已生成，并已尝试用系统图片查看器打开')"
      :height="1"
    />
    <Text
      v-if="qrPngHint"
      :content="ink(c.warn, qrPngHint)"
      wrapMode="wrap"
      :marginTop="1"
    />
    <Text
      :content="
        ink(
          c.faint,
          '扫完按回车继续轮询（Win10 1809 控制台会把定时器卡住）',
        )
      "
      :height="1"
      :marginTop="1"
    />
  </Box>
</template>
