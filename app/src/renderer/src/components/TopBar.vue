<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { go, modalOpen, runSearch, store, toast, errText } from '../store'
import Icon from './Icon.vue'

const text = ref(store.query)
watch(
  () => store.query,
  (q) => (text.value = q),
)

async function submit() {
  try {
    await runSearch(text.value)
  } catch (e) {
    toast(errText(e), 'err')
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (modalOpen() && !store.paletteOpen) return
    e.preventDefault()
    store.paletteOpen = !store.paletteOpen
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const running = computed(() => store.jobs.filter((j) => j.state === 'running' || j.state === 'queued'))
const runningPct = computed(() => {
  const list = running.value.filter((j) => j.state === 'running')
  return list.length ? Math.round(list.reduce((n, j) => n + j.pct, 0) / list.length) : 0
})
const shortcut = computed(() => (store.state?.platform === 'darwin' ? '⌘ K' : 'Ctrl K'))
</script>

<template>
  <header class="top">
    <form class="search" role="search" @submit.prevent="submit">
      <label for="gsearch" class="sr-only">搜索剧名或粘贴链接</label>
      <Icon name="search" :size="18" />
      <input id="gsearch" v-model="text" type="search" placeholder="搜索剧名，或粘贴任意平台的播放页链接" autocomplete="off" />
      <button type="button" class="kbd mono" title="打开命令面板" @click="store.paletteOpen = true">{{ shortcut }}</button>
    </form>
    <button v-if="running.length" type="button" class="dl" @click="go('downloads')">
      <Icon name="download" :size="16" />
      <span>{{ running.length }} 个下载中<template v-if="runningPct"> · {{ runningPct }}%</template></span>
    </button>
  </header>
</template>

<style scoped>
.top { height: 60px; flex-shrink: 0; padding: 0 28px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 16px; }
.search {
  width: min(620px, 75%); height: 40px; padding: 0 8px 0 14px; background: var(--card); border: 1px solid var(--line);
  border-radius: 10px; display: flex; align-items: center; gap: 10px; color: var(--ink-2);
}
.search:focus-within { border-color: var(--ink); box-shadow: 0 0 0 2px var(--orange-soft); }
.search input { flex-grow: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--ink); }
.search input::-webkit-search-cancel-button { display: none; }
.kbd { font-size: 11px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; background: var(--paper); cursor: pointer; }
.dl {
  margin-left: auto; height: 34px; padding: 0 12px; border-radius: 999px; border: 0; background: var(--orange-soft);
  display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: var(--orange-text);
}
.dl:hover { filter: brightness(.97); }
</style>
