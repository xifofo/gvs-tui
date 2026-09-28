<script setup lang="ts">
/**
 * EmptyState: the one loading / empty / error block, centered both ways inside
 * a `width` × `height` box.
 *
 *   ⠋ 正在读取平台栏目与内容…      ← spinner while `loading`, else the tone icon
 *   这个栏目暂无内容                ← tone color for warn/err, c.dim otherwise
 *   按 / 搜索，或 r 刷新            ← optional hint, c.faint
 *
 * Degrades on short boxes: at height 2 the hint is dropped, at 1 only the
 * message is shown — the icon and the hint never push the block past its
 * height, and a long message is clipped instead of wrapping.
 */
import { computed } from 'vue-termui'
import { Box, Text } from 'vue-termui'
import Spinner from './Spinner.vue'
import { ink } from '../lib/rows.ts'
import { clip, displayWidth } from '../lib/text.ts'
import { c, toneColor, toneIcon } from '../lib/theme.ts'
import type { Tone } from '../lib/theme.ts'

const props = withDefaults(
  defineProps<{
    width: number
    height: number
    /** Semantic tone; `info` reads as a quiet placeholder. */
    tone?: Tone
    message: string
    /** Optional second line, e.g. the next key to press. */
    hint?: string
    /** Swap the icon for the spinner. */
    loading?: boolean
  }>(),
  { tone: 'info', hint: '', loading: false },
)

/** One line is always the icon + message; the hint is a second one when it fits. */
const showHint = computed(() => !!props.hint && props.height >= 3)
const top = computed(() => Math.max(0, Math.floor((props.height - (showHint.value ? 2 : 1)) / 2)))
/** Cells clipped off the message: `width` minus the icon column and 2 of margin. */
const room = computed(() => Math.max(1, props.width - 4))

const icon = computed(() => toneIcon(props.tone))
const iconColor = computed(() => toneColor(props.tone))
const messageColor = computed(() =>
  props.tone === 'warn' || props.tone === 'err' ? toneColor(props.tone) : c.dim,
)
const message = computed(() => clip(props.message, room.value))
const hintText = computed(() => `  ${clip(props.hint, room.value)}`)
/** The spinner is glyph + space, so it takes one cell more than the plain icon. */
const iconCells = computed(() => (props.loading ? 3 : 2))
const pad = computed(() =>
  Math.max(0, Math.floor((props.width - iconCells.value - displayWidth(message.value)) / 2)),
)
const messageCells = computed(() => Math.max(1, props.width - pad.value - iconCells.value))
const hintPad = computed(() =>
  Math.max(0, Math.floor((props.width - displayWidth(hintText.value)) / 2)),
)
const hintLine = computed(() => ' '.repeat(hintPad.value) + hintText.value)
</script>

<template>
  <Box flexDirection="column" :width="width" :height="height">
    <Text v-if="top > 0" :content="' '" :width="width" :height="top" />
    <Box flexDirection="row" :width="width" :height="1" :paddingLeft="pad">
      <Spinner v-if="loading" />
      <Text v-else :content="ink(iconColor, icon)" :width="2" :height="1" />
      <Text
        :content="ink(messageColor, message)"
        :width="messageCells"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
    </Box>
    <Text
      v-if="showHint"
      :content="ink(c.faint, hintLine)"
      :width="width"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
  </Box>
</template>
