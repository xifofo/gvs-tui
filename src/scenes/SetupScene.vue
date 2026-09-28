<script setup lang="ts">
// 连接网关: host + API key, inside a centred card. The two fields are bound to
// the shell's refs (the shell forwards them to `bridge.set`), and tab switches
// which one the shell focuses.
import { computed, ref } from 'vue-termui'
import { Box, Input, StyledText, Text, bold, fg } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW — the card is sized from the terminal, never a fixed number. */
  width: number
}>()

const host = defineModel<string>('host', { required: true })
// `key` is reserved by Vue (vnode keys), so the API key model is named
// `apiKey`; the runtime field it forwards to is still `key`.
const apiKey = defineModel<string>('apiKey', { required: true })

const hostField = ref<{ $el?: { focus?: () => void } } | null>(null)
const keyField = ref<{ $el?: { focus?: () => void } } | null>(null)

/** The shell focuses the active field on scene change and on tab. */
function focus(): void {
  const field = props.state.hostFocused ? hostField.value : keyField.value
  const fn = field?.$el?.focus
  if (typeof fn === 'function') fn.call(field!.$el)
}

defineExpose({ focus })

// Cards are sized from the terminal, never from a fixed number, so nothing
// overflows on a narrow window.
const cardW = computed(() => Math.max(44, Math.min(72, props.width - 2)))
const fieldBoxW = computed(() => cardW.value - 6)
const fieldW = computed(() => fieldBoxW.value - 3)
</script>

<template>
  <Box :flexGrow="1" flexDirection="row" justifyContent="center" alignItems="center">
    <Box
      :width="cardW"
      flexDirection="column"
      :border="true"
      borderStyle="rounded"
      :borderColor="c.line"
      :backgroundColor="c.panel"
      :paddingLeft="2"
      :paddingRight="2"
      :paddingTop="1"
      :paddingBottom="1"
    >
      <!-- Same words as the header, so the card does not re-brand itself. -->
      <Text
        :content="new StyledText([fg(c.text)(bold('连接网关')), fg(c.faint)('   填入管理台签发的网关地址与 API Key')])"
        :height="1"
      />
      <Text
        :content="'网关地址'"
        :height="1"
        :marginTop="1"
        :fg="state.hostFocused ? c.accent : c.dim"
      />
      <Box
        :width="fieldBoxW"
        :border="true"
        borderStyle="single"
        :borderColor="state.hostFocused ? c.accent : c.line"
        :backgroundColor="c.sunken"
        :paddingLeft="1"
      >
        <Input
          ref="hostField"
          v-model="host"
          placeholder="http://127.0.0.1:8080"
          autofocus
          :backgroundColor="c.sunken"
          :focusedBackgroundColor="c.sunken"
          :textColor="c.text"
          :placeholderColor="c.faint"
          :width="fieldW"
        />
      </Box>
      <Text
        :content="'API Key'"
        :height="1"
        :marginTop="1"
        :fg="state.keyFocused ? c.accent : c.dim"
      />
      <Box
        :width="fieldBoxW"
        :border="true"
        borderStyle="single"
        :borderColor="state.keyFocused ? c.accent : c.line"
        :backgroundColor="c.sunken"
        :paddingLeft="1"
      >
        <Input
          ref="keyField"
          v-model="apiKey"
          placeholder="sk_live_..."
          :backgroundColor="c.sunken"
          :focusedBackgroundColor="c.sunken"
          :textColor="c.text"
          :placeholderColor="c.faint"
          :width="fieldW"
        />
      </Box>
      <Text
        :content="ink(c.faint, 'tab 切换字段 · ⏎ 保存并进入')"
        :height="1"
        :marginTop="1"
      />
    </Box>
  </Box>
</template>
