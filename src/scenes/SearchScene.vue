<script setup lang="ts">
// 搜索: the platform tabs, a framed search box, and the supported link shapes.
// The field is bound to the shell's ref (the shell forwards it to
// `bridge.set`) and the shell focuses it on scene change.
import { computed, ref } from 'vue-termui'
import { Box, Input, StyledText, Text, bold, fg } from 'vue-termui'
import { chipChunks, colsLine, ruleLine } from '../lib/rows.ts'
import { displayWidth } from '../lib/text.ts'
import { c, providerName } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'
import { platformBar } from './shared.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
}>()

const bodyW = computed(() => props.width)
const query = defineModel<string>('query', { required: true })

const searchField = ref<{ $el?: { focus?: () => void } } | null>(null)

/** The shell focuses the field on scene change. */
function focus(): void {
  const fn = searchField.value?.$el?.focus
  if (typeof fn === 'function') fn.call(searchField.value!.$el)
}

defineExpose({ focus })

const providers = computed(() => props.state.providers ?? [])
const platform = computed(() => providerName(providers.value[props.state.providerIndex] || ''))
const searchPlatformLine = computed(() =>
  platformBar(providers.value, bodyW.value, providers.value[props.state.providerIndex] || ''),
)

/** ` 优酷  https://…` — the platform chip in a fixed column, the example in c.dim. */
const LINK_LABEL = 6
function linkLine(name: string, example: string): StyledText {
  const chip = ` ${name} `
  const pad = Math.max(0, LINK_LABEL - displayWidth(chip))
  return colsLine(
    [
      { chunks: () => [...chipChunks(name), { __isChunk: true, text: ' '.repeat(pad) }], cells: LINK_LABEL },
      { text: example, grow: true, color: c.dim },
    ],
    bodyW.value,
  )
}

const LINKS: Array<[string, string]> = [
  ['优酷', 'https://v.youku.com/v_show/id_xxx.html'],
  ['腾讯', 'https://v.qq.com/x/cover/xxx.html'],
  ['抖音', '分享口令整段粘贴即可'],
]
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="searchPlatformLine"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="true"
    />
    <Text
      :content="
        new StyledText([
          fg(c.text)(bold('搜索')),
          fg(c.faint)(`  在 ${platform} 中查找片名，也可以直接粘贴链接`),
        ])
      "
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :truncate="true"
    />
    <Box
      flexDirection="row"
      :width="bodyW"
      :height="3"
      :marginTop="1"
      :border="true"
      borderStyle="rounded"
      :borderColor="c.accent"
      :backgroundColor="c.sunken"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <Input
        ref="searchField"
        v-model="query"
        autofocus
        placeholder="搜片名，或粘贴优酷/腾讯/抖音链接"
        :backgroundColor="c.sunken"
        :focusedBackgroundColor="c.sunken"
        :textColor="c.text"
        :placeholderColor="c.faint"
        :width="bodyW - 4"
      />
    </Box>
    <Text
      :content="ruleLine('支持的链接', bodyW)"
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :truncate="true"
    />
    <Text
      v-for="[name, example] in LINKS"
      :key="name"
      :content="linkLine(name, example)"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
  </Box>
</template>
