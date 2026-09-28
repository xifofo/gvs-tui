<script setup lang="ts">
// 搜索: the platform tabs, a framed search box, and the supported link shapes.
// The field is bound to the shell's ref (the shell forwards it to
// `bridge.set`) and the shell focuses it on scene change.
import { computed, ref } from 'vue-termui'
import { Box, Input, StyledText, Text, bold, fg } from 'vue-termui'
import { ink } from '../lib/rows.ts'
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
const searchPlatformLine = computed(() =>
  platformBar(providers.value, bodyW.value, providers.value[props.state.providerIndex] || ''),
)
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
          fg(c.text)(bold('搜索片名')),
          fg(c.faint)(`，在 ${providerName(providers[state.providerIndex] || '')} 中查找；也可以直接粘贴链接`),
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
      :content="ink(c.faint, '支持的链接')"
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :truncate="true"
    />
    <Text
      :content="ink(c.dim, '  优酷  https://v.youku.com/v_show/id_xxx.html')"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
    <Text
      :content="ink(c.dim, '  腾讯  https://v.qq.com/x/cover/xxx.html')"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
    <Text
      :content="ink(c.dim, '  抖音  分享口令整段粘贴即可')"
      :height="1"
      :width="bodyW"
      :truncate="true"
    />
  </Box>
</template>
