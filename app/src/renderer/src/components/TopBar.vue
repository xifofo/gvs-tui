<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { go, hasProvider, modalOpen, runSearch, store, toast, errText } from '../store'
import Icon from './Icon.vue'

const text = ref(store.query)
const input = ref<HTMLInputElement | null>(null)
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
  if (modalOpen()) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    input.value?.focus()
    input.value?.select()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const running = computed(() => store.jobs.filter((j) => j.state === 'running' || j.state === 'queued').length)
// 只有优酷/腾讯支持粘贴播放页链接；Key 没这两家权限就别提链接
const placeholder = computed(() => {
  const sites = [hasProvider('youku') && '优酷', hasProvider('tencent') && '腾讯', hasProvider('mewatch') && 'mewatch', hasProvider('hamivideo') && 'Hami', hasProvider('iq') && 'IQ'].filter(Boolean)
  return sites.length ? '搜索剧名或粘贴视频链接' : '搜索剧名'
})
const shortcut = computed(() => (store.state?.platform === 'darwin' ? '⌘ K' : 'Ctrl K'))
</script>

<template>
  <header class="top">
    <form class="search" role="search" @submit.prevent="submit">
      <label for="gsearch" class="sr-only">搜索剧名或粘贴链接</label>
      <Icon name="search" :size="18" />
      <input
        id="gsearch"
        ref="input"
        v-model="text"
        type="search"
        :placeholder="placeholder"
        autocomplete="off"
      />
      <span class="kbd mono">{{ shortcut }}</span>
    </form>
    <button v-if="running" type="button" class="dl" @click="go('downloads')">
      <Icon name="download" :size="17" />
      <span>{{ running }} 个下载中</span>
    </button>
  </header>
</template>

<style scoped>
.top { height: 64px; flex-shrink: 0; padding: 0 28px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 16px; }
.search {
  width: min(540px, 75%); height: 40px; padding: 0 14px; background: var(--card); border: 1px solid var(--line);
  border-radius: 8px; display: flex; align-items: center; gap: 10px; color: var(--ink-2);
}
.search:focus-within { border-color: var(--orange-text); box-shadow: 0 0 0 2px var(--orange-soft); }
.search input { flex-grow: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 15px; color: var(--ink); }
.search input::-webkit-search-cancel-button { display: none; }
.kbd { font-size: 12px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; }
.dl {
  margin-left: auto; height: 40px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--card);
  display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; color: var(--orange-text);
}
.dl span { color: var(--ink); }
.dl:hover { border-color: var(--ink); }
</style>
