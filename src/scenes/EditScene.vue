<script setup lang="ts">
// 编辑: one setting value in a framed box. The ref is bound to the shell's
// `edit` ref and the shell focuses the field on scene change.
import { computed, ref } from 'vue-termui'
import { Box, Input, Text } from 'vue-termui'
import { ink } from '../lib/rows.ts'
import { c } from '../lib/theme.ts'
import type { Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
}>()

const bodyW = computed(() => props.width)
const edit = defineModel<string>('edit', { required: true })

const editField = ref<{ $el?: { focus?: () => void } } | null>(null)

/** The shell focuses the field on scene change. */
function focus(): void {
  const fn = editField.value?.$el?.focus
  if (typeof fn === 'function') fn.call(editField.value!.$el)
}

defineExpose({ focus })

const boxW = computed(() => Math.max(30, Math.min(72, bodyW.value - 2)))
const fieldW = computed(() => boxW.value - 4)
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="ink(c.text, state.editField || '编辑', true)"
      :height="1"
    />
    <Box
      :width="boxW"
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
        ref="editField"
        v-model="edit"
        autofocus
        :backgroundColor="c.sunken"
        :focusedBackgroundColor="c.sunken"
        :textColor="c.text"
        :placeholderColor="c.faint"
        :width="fieldW"
      />
    </Box>
  </Box>
</template>
