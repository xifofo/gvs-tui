<script setup lang="ts">
import { computed } from 'vue'
import { accountsOf, store } from '../store'
import Icon from './Icon.vue'

/** 选账号：v-model 模式（传 modelValue）或写到 store.accountPick（本次下载用） */
const props = defineProps<{ provider: string; modelValue?: string; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: string]; change: [id: string] }>()
const slots = computed(() => accountsOf(props.provider))
const def = computed(() => store.accounts?.book.defaults[props.provider] ?? '')
const active = computed(() => store.accounts?.book.active[props.provider] ?? '')
const value = computed(() => (props.modelValue !== undefined ? props.modelValue : store.accountPick[props.provider] ?? ''))
function set(id: string) {
  if (props.modelValue !== undefined) emit('update:modelValue', id)
  else store.accountPick = { ...store.accountPick, [props.provider]: id }
  emit('change', id)
}
const fmt = (s: (typeof slots.value)[number]) => [s.name, s.id === def.value ? '默认' : '', s.id === active.value ? '当前' : '', s.status?.tone === 'err' ? '受限' : '', s.mode === 'qr' && s.id !== active.value ? '需扫码' : ''].filter(Boolean).join(' · ')
</script>

<template>
  <label class="ap">
    <Icon name="user" :size="15" />
    <span class="muted">{{ label ?? '使用账号' }}</span>
    <select class="sel" :value="value" @change="set(($event.target as HTMLSelectElement).value)">
      <option value="">默认账号（{{ slots.find((s) => s.id === def)?.name ?? '—' }}）</option>
      <option v-for="s in slots" :key="s.id" :value="s.id">{{ fmt(s) }}</option>
    </select>
    <span class="muted small">受限时自动换用其它已保存 Cookie 的账号</span>
  </label>
</template>

<style scoped>
.ap { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.sel { height: 32px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: 0 8px; font-size: 13px; min-width: 200px; }
.small { font-size: 12px; }
</style>
