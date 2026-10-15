<script setup lang="ts">
/** 双重鉴权表单，替换连接页展示；其余上游场景保持原有结构。 */
import { computed, ref } from 'vue-termui'
import { Box, Input, Text } from 'vue-termui'
import { c } from '../../lib/theme.ts'
import type { Snapshot } from '../../types.ts'

const props = defineProps<{ state: Snapshot; width: number }>()
const emit = defineEmits<{ field: [name: string, value: string] }>()
const host = defineModel<string>('host', { required: true })
type Field = { $el?: { focus?: () => void; blur?: () => void } }
const hostField = ref<Field | null>(null)
const plutoField = ref<Field | null>(null)
const form = computed(() => props.state.connectionForm ?? { field: 0, url: '', keyLength: 0, gatewayKeyLength: 0 })
const cardW = computed(() => Math.max(44, Math.min(76, props.width - 2)))
const fieldW = computed(() => cardW.value - 19)
function focus(): void {
  hostField.value?.$el?.blur?.()
  plutoField.value?.$el?.blur?.()
  if (form.value.field === 0) hostField.value?.$el?.focus?.()
  if (form.value.field === 2) plutoField.value?.$el?.focus?.()
}
defineExpose({ focus })
const hint = computed(() => {
  const p = props.state.plutofish
  if (p?.status === 'checking') return 'PlutoFish：正在验证…'
  if (p?.status === 'verified') return `PlutoFish：已验证 ${p.identity?.name ?? ''}`
  if (p?.status === 'error') return p.error
  return '网关和 PlutoFish 都验证通过后才能进入'
})
</script>

<template>
  <Box :flexGrow="1" justifyContent="center" alignItems="center">
    <Box :width="cardW" :border="true" borderStyle="rounded" :borderColor="c.line" :backgroundColor="c.panel" :paddingLeft="1" :paddingRight="1" flexDirection="column">
      <Text content="连接网关与 PlutoFish" :height="1" :fg="c.text" />
      <Text content="两套凭据分别填写；已保存密钥可留空沿用" :height="1" :fg="c.dim" />
      <Box flexDirection="row" :height="1">
        <Text content="网关地址" :width="15" :fg="form.field === 0 ? c.accent : c.dim" />
        <Input ref="hostField" v-model="host" autofocus :width="fieldW" placeholder="https://gateway.example" :textColor="c.text" :backgroundColor="c.sunken" :focusedBackgroundColor="c.sunken" />
      </Box>
      <Box flexDirection="row" :height="1">
        <Text content="网关 API Key" :width="15" :fg="form.field === 1 ? c.accent : c.dim" />
        <Text :content="form.gatewayKeyLength ? '•'.repeat(Math.min(form.gatewayKeyLength, fieldW)) : state.keyConfigured ? '已保存；输入可替换' : '请输入网关 API Key'" :height="1" :width="fieldW" :fg="form.field === 1 ? c.accent : c.dim" />
      </Box>
      <Box flexDirection="row" :height="1">
        <Text content="PlutoFish 地址" :width="15" :fg="form.field === 2 ? c.accent : c.dim" />
        <Input ref="plutoField" :modelValue="form.url" @update:modelValue="emit('field', 'plutofishUrl', $event)" :width="fieldW" placeholder="https://plutofish.example" :textColor="c.text" :backgroundColor="c.sunken" :focusedBackgroundColor="c.sunken" />
      </Box>
      <Box flexDirection="row" :height="1">
        <Text content="发布端密钥" :width="15" :fg="form.field === 3 ? c.accent : c.dim" />
        <Text :content="form.keyLength ? '•'.repeat(Math.min(form.keyLength, fieldW)) : state.plutofish?.hasKey ? '已保存；输入可替换' : '请输入 PlutoFish 密钥'" :height="1" :width="fieldW" :fg="form.field === 3 ? c.accent : c.dim" />
      </Box>
      <Text :content="hint" :height="1" :truncate="true" :fg="state.plutofish?.status === 'verified' ? c.accent : c.dim" />
      <Text content="Tab 切换 · Enter 验证并进入 · Ctrl+U 清空密钥" :height="1" :fg="c.faint" />
    </Box>
  </Box>
</template>
