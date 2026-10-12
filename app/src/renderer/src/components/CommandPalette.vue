<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { PROVIDER_NAME } from '@shared/api'
import { needsAttention } from '@shared/provider-registry'
import { go, prefs, runSearch, savePrefs, store, type View } from '../store'
import Icon from './Icon.vue'
import PlatformLogo from './PlatformLogo.vue'
import { useDialogFocus } from '../dialog-focus'

type Item = { key: string; icon: string; label: string; hint?: string; provider?: string; run: () => void; removable?: string }

const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
const cursor = ref(0)
const close = () => { store.paletteOpen = false }
useDialogFocus(dialog, close)
onMounted(() => void nextTick(() => input.value?.focus()))

const NAV: Array<[View, string, string]> = [
  ['home', '首页', 'home'], ['downloads', '打开下载', 'download'], ['calendar', '追剧日历', 'calendar'],
  ['subscriptions', '订阅', 'star'], ['accounts', '账号', 'user'], ['settings', '设置', 'gear'], ['discover', '按平台浏览', 'compass'],
]

const items = computed<Item[]>(() => {
  const text = q.value.trim()
  const lower = text.toLowerCase()
  const out: Item[] = []
  if (text) out.push({ key: 'search', icon: 'search', label: `搜索「${text}」`, hint: '全部已启用平台', run: () => void runSearch(text) })
  for (const r of prefs().recentSearches) {
    if (lower && !r.toLowerCase().includes(lower)) continue
    if (r === text) continue
    out.push({ key: 'r:' + r, icon: 'clock', label: r, hint: '最近搜索', run: () => void runSearch(r), removable: r })
    if (out.length > 6) break
  }
  for (const a of store.state?.accounts ?? []) {
    if (!needsAttention(a)) continue
    const label = `${PROVIDER_NAME[a.provider]}：${a.short}`
    if (lower && !label.toLowerCase().includes(lower)) continue
    out.push({ key: 'a:' + a.provider, icon: 'user', label, hint: '去登录', provider: a.provider, run: () => { go('accounts'); store.accountDrawer = a.provider } })
  }
  for (const [v, label, icon] of NAV) {
    if (lower && !label.includes(text)) continue
    out.push({ key: 'n:' + v, icon, label, hint: '跳转', run: () => go(v) })
  }
  return out
})
watch(items, () => (cursor.value = 0))

function pick(i: Item) {
  close()
  i.run()
}
function removeRecent(r: string) {
  void savePrefs({ recentSearches: prefs().recentSearches.filter((x) => x !== r) })
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); cursor.value = Math.min(items.value.length - 1, cursor.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cursor.value = Math.max(0, cursor.value - 1) }
  else if (e.key === 'Enter') { e.preventDefault(); const it = items.value[cursor.value]; if (it) pick(it) }
}
</script>

<template>
  <div class="scrim" @mousedown.self="close">
    <div ref="dialog" class="pal card" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="in">
        <Icon name="search" :size="18" />
        <input ref="input" v-model="q" placeholder="搜索剧名、粘贴链接，或输入「下载」「账号」跳转" autocomplete="off" @keydown="onKey" />
        <span class="kbd mono">Esc</span>
      </div>
      <ul class="list" role="listbox">
        <li v-for="(it, i) in items" :key="it.key" role="option" :aria-selected="i === cursor" class="it" :class="{ on: i === cursor }" @mouseenter="cursor = i" @click="pick(it)">
          <PlatformLogo v-if="it.provider" :provider="it.provider" :size="16" />
          <Icon v-else :name="it.icon" :size="16" />
          <span class="lb">{{ it.label }}</span>
          <span v-if="it.hint" class="hint">{{ it.hint }}</span>
          <button v-if="it.removable" type="button" class="rm" aria-label="删除这条最近搜索" @click.stop="removeRecent(it.removable)"><Icon name="x" :size="13" /></button>
        </li>
        <li v-if="!items.length" class="none">输入剧名后回车搜索</li>
      </ul>
      <div class="foot mono">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(23, 24, 28, .38); z-index: 60; display: flex; justify-content: center; padding-top: 12vh; }
.pal { width: min(640px, 92vw); max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, .28); }
.in { height: 56px; padding: 0 18px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
.in input { flex: 1; border: 0; outline: 0; font-size: 16px; background: transparent; }
.kbd { font-size: 11px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; }
.list { list-style: none; margin: 0; padding: 8px; overflow-y: auto; }
.it { height: 40px; padding: 0 12px; border-radius: 8px; display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; }
.it.on { background: var(--orange-soft); }
.lb { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint { font-size: 12px; color: var(--ink-3); }
.rm { border: 0; background: transparent; color: var(--ink-3); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; }
.rm:hover { color: var(--ink); background: var(--paper-2); }
.none { padding: 18px; color: var(--ink-3); font-size: 13px; }
.foot { padding: 8px 18px; border-top: 1px solid var(--line); font-size: 11px; color: var(--ink-3); background: var(--paper); }
</style>
