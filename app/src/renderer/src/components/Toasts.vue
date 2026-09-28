<script setup lang="ts">
import { store } from '../store'
import Icon from './Icon.vue'

const ICON: Record<string, string> = { ok: 'check', err: 'alert', warn: 'alert', muted: 'info' }
const close = (id: number) => {
  const i = store.toasts.findIndex((t) => t.id === id)
  if (i >= 0) store.toasts.splice(i, 1)
}
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="tst">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.tone">
        <Icon :name="ICON[t.tone] ?? 'info'" :size="16" :stroke="2.4" class="ic" />
        <span class="tx">{{ t.message }}</span>
        <button type="button" class="x" aria-label="关闭" @click="close(t.id)"><Icon name="x" :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; right: 24px; bottom: 24px; display: flex; flex-direction: column; gap: 10px; z-index: 50; max-width: 420px; }
.toast {
  padding: 12px 12px 12px 14px; border-radius: 8px; background: var(--ink); color: var(--paper); font-size: 14px; line-height: 1.5;
  box-shadow: var(--shadow-orange); display: flex; align-items: flex-start; gap: 10px;
}
.ic { margin-top: 2px; }
.tx { flex-grow: 1; word-break: break-word; }
.x { background: none; border: 0; padding: 2px; cursor: pointer; color: inherit; opacity: .6; display: flex; border-radius: 4px; }
.x:hover { opacity: 1; }
.toast.ok { box-shadow: 4px 4px 0 var(--ok); }
.toast.ok .ic { color: var(--side-ok); }
.toast.err { background: var(--err); color: #fff; box-shadow: var(--shadow-ink); }
.toast.warn { background: var(--orange-soft); color: var(--orange-text); border: 1.5px solid var(--orange-text); box-shadow: none; }
.tst-enter-active { transition: opacity .18s ease, transform .18s ease; }
.tst-leave-active { transition: opacity .14s ease, transform .14s ease; position: absolute; }
.tst-enter-from { opacity: 0; transform: translateX(16px); }
.tst-leave-to { opacity: 0; transform: translateX(16px); }
@media (prefers-reduced-motion: reduce) {
  .tst-enter-active, .tst-leave-active { transition: none; }
}
</style>
