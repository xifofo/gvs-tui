<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { store } from '../store'

const props = withDefaults(defineProps<{ title: string; message?: string; confirmText?: string; danger?: boolean; checkbox?: string }>(), {
  message: '',
  confirmText: '确定',
  danger: false,
  checkbox: '',
})
const emit = defineEmits<{ confirm: [checked: boolean]; cancel: [] }>()

const checked = ref(false)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}
onMounted(() => {
  store.dialogCount++
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  store.dialogCount--
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="scrim" @click.self="emit('cancel')">
    <div class="dlg" role="alertdialog" aria-modal="true" :aria-label="props.title">
      <h2 class="title">{{ props.title }}</h2>
      <p v-if="props.message" class="msg">{{ props.message }}</p>
      <label v-if="props.checkbox" class="opt">
        <input v-model="checked" type="checkbox" />
        <span class="bx"><span /></span>
        <span>{{ props.checkbox }}</span>
      </label>
      <div class="foot">
        <button type="button" class="btn" @click="emit('cancel')">取消</button>
        <button type="button" class="btn" :class="{ danger: props.danger }" @click="emit('confirm', checked)">{{ props.confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(23, 24, 28, .45); display: flex; align-items: center; justify-content: center; z-index: 45; }
.dlg {
  width: 440px; max-width: calc(100vw - 48px); background: var(--paper); border: 1.5px solid var(--ink); border-radius: 12px;
  box-shadow: 8px 8px 0 var(--ink); padding: 24px; display: flex; flex-direction: column; gap: 16px;
}
.title { font-size: 20px; font-weight: 700; }
.msg { font-size: 14px; line-height: 1.6; color: var(--ink-2); word-break: break-word; }
.opt { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
.opt input { position: absolute; opacity: 0; pointer-events: none; }
.bx { width: 20px; height: 20px; border-radius: 5px; border: 2px solid var(--ink); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.bx span { width: 10px; height: 10px; border-radius: 2px; background: transparent; }
.opt input:checked + .bx span { background: var(--orange); }
.opt input:focus-visible + .bx { outline: 2px solid var(--orange); outline-offset: 2px; }
.foot { display: flex; justify-content: flex-end; gap: 10px; }
.btn.danger { border: 1.5px solid var(--err); color: var(--err); font-weight: 700; }
.btn.danger:hover { background: var(--err); color: #fff; }
</style>
