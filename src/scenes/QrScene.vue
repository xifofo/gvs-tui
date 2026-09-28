<script setup lang="ts">
// 扫码登录: the QR block, centred, with the PNG paths as a fallback when the
// window cannot hold it. A QR that does not fit is hidden, never cropped —
// a sliced code is unscannable, and that is worse than not showing it.
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import PageHeader from '../components/PageHeader.vue'
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

/** Quiet-zone rows are spaces — keep them. */
const qrLines = computed(() => {
  const raw = props.state.qrAscii || ''
  if (!raw) return [] as string[]
  return raw.replace(/\n$/, '').split('\n')
})
const qrWidest = computed(() =>
  qrLines.value.reduce((max, line) => Math.max(max, displayWidth(line)), 0),
)

/** The PNG fallback: a blank, a label, then one row per path. */
const pngPaths = computed(() => props.state.qrPngPaths ?? [])
const pngRows = computed(() => (pngPaths.value.length ? pngPaths.value.length + 2 : 0))

/** Rows the chrome owns: the 2-line header, a blank, a blank, the bottom hint. */
const CHROME = 5
const qrRoom = computed(() => Math.max(0, bodyH.value - CHROME - pngRows.value))
/** Rows the code needs before it is unscannable — clip it and it is worthless. */
const qrOverflow = computed(
  () => qrLines.value.length > qrRoom.value || qrWidest.value > bodyW.value,
)

const qrBlock = computed(() => {
  if (qrOverflow.value) return ''
  const indent = ' '.repeat(Math.max(0, Math.floor((bodyW.value - qrWidest.value) / 2)))
  return qrLines.value.map((line) => indent + line).join('\n')
})

/** Slack above the code, so a QR that fits sits in the middle of its box. */
const topPad = computed(() =>
  qrOverflow.value ? 0 : Math.max(0, Math.floor((qrRoom.value - qrLines.value.length) / 2)),
)

const subtitle = computed(() => props.state.qrHint || '用优酷 App 扫码登录，登录态会写进本机')
const bottomHint = '扫完按回车继续轮询（Win10 1809 控制台会把定时器卡住）'
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <PageHeader title="扫码登录" :subtitle="subtitle" :width="bodyW" />
    <Text :content="' '" :width="bodyW" :height="1" />
    <Text v-if="topPad" :content="' '" :width="bodyW" :height="topPad" />
    <Text
      v-if="qrOverflow"
      :content="ink(c.warn, '! 窗口太小画不下完整二维码，请打开下面的 PNG')"
      :width="bodyW"
      :height="1"
      :truncate="true"
    />
    <Text v-else-if="qrBlock" :content="qrBlock" :fg="c.text" wrapMode="none" />
    <Text
      v-else
      :content="ink(c.ok, '二维码图片已生成，并已尝试用系统图片查看器打开')"
      :width="bodyW"
      :height="1"
      :truncate="true"
    />
    <template v-if="pngPaths.length">
      <Text :content="' '" :width="bodyW" :height="1" />
      <Text
        :content="ink(c.faint, '扫码图片（PNG 绝对路径）')"
        :width="bodyW"
        :height="1"
        :truncate="true"
      />
      <Text
        v-for="path in pngPaths"
        :key="path"
        :content="ink(c.warn, `  ${path}`)"
        :width="bodyW"
        :height="1"
        :truncate="true"
      />
    </template>
    <Text :content="' '" :width="bodyW" :height="1" />
    <Text :content="ink(c.faint, bottomHint)" :width="bodyW" :height="1" :truncate="true" />
  </Box>
</template>
