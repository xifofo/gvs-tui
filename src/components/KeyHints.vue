<script setup lang="ts">
// Footer key hints: `⏎ 确认 · esc 返回` with the whole key on a subtle chip.
// When the terminal is narrow the low-priority hints are dropped rather than
// letting the line wrap; the trailing hint is always kept. `extra` (the global
// F-keys) is right-aligned. Reserve room for F1 before fitting scene hints so
// help remains available in a narrow terminal.
import { computed } from 'vue-termui'
import { StyledText, Text, fg } from 'vue-termui'
import { chipChunks } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import { displayWidth } from '../lib/text.ts'

const props = defineProps<{ hints: Array<[string, string]>; width: number; extra?: Array<[string, string]> }>()

// Two spaces, not ` · `: the chips already separate the hints visually, and a
// glyph between every pair costs the cells that the F1–F4 hints need to fit.
const SEPARATOR = '  '
const SEPARATOR_CELLS = displayWidth(SEPARATOR)
const EXTRA_GAP = '  '

/** ` 键 ` chip + label (the chip already carries the separating space). */
function hintWidth(key: string, label: string): number {
  return displayWidth(key) + 2 + displayWidth(label)
}

function measure(hints: Array<[string, string]>, gap = SEPARATOR_CELLS): number {
  if (!hints.length) return 0
  const body = hints.reduce((n, [key, label]) => n + hintWidth(key, label), 0)
  return body + (hints.length - 1) * gap
}

function measureExtra(hints: Array<[string, string]>): number {
  return hints.reduce((n, [key, label]) => n + displayWidth(`${key} ${label}`), 0)
    + Math.max(0, hints.length - 1) * EXTRA_GAP.length
}

const fitted = computed(() => {
  const all = props.hints
  const help = props.extra?.slice(0, 1) ?? []
  const width = Math.max(0, props.width - (help.length ? measureExtra(help) + EXTRA_GAP.length : 0))
  if (measure(all) <= width) return all
  if (!all.length) return []
  const head = all[0]!
  const tail = all[all.length - 1]!
  if (all.length === 1) return measure([head]) <= width ? [head] : []
  if (measure([head, tail]) > width)
    return measure([head]) <= width ? [head] : measure([tail]) <= width ? [tail] : []
  const kept: Array<[string, string]> = [head]
  for (const hint of all.slice(1, -1)) {
    if (measure([...kept, hint, tail]) > width) continue
    kept.push(hint)
  }
  return [...kept, tail]
})

/** The global F-keys, shrunk to `F1 帮助` when the full row does not fit. */
const fittedExtra = computed(() => {
  const extra = props.extra ?? []
  const room = props.width - measure(fitted.value)
  if (!extra.length || room < EXTRA_GAP.length + measureExtra(extra)) {
    const first = extra[0]
    return first && room >= EXTRA_GAP.length + measureExtra([first]) ? [first] : []
  }
  return extra
})

const content = computed(() => {
  const chunks = fitted.value.flatMap(([key, label], index) => [
    ...(index > 0 ? [fg(c.line)(SEPARATOR)] : []),
    ...chipChunks(key, c.accent),
    fg(c.faint)(label),
  ])
  const extra = fittedExtra.value
  if (extra.length) {
    const room = props.width - measure(fitted.value) - measureExtra(extra)
    chunks.push({ __isChunk: true, text: ' '.repeat(Math.max(0, room)) })
    extra.forEach(([key, label], index) => {
      if (index > 0) chunks.push({ __isChunk: true, text: EXTRA_GAP })
      chunks.push(fg(c.dim)(key), fg(c.faint)(` ${label}`))
    })
  }
  return new StyledText(chunks)
})
</script>

<template>
  <Text :content="content" :height="1" wrapMode="none" :truncate="true" />
</template>
