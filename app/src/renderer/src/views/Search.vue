<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PROVIDER_NAME, type Card, type Provider } from '@shared/api'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import Skeleton from '../components/Skeleton.vue'
import { openCard, store } from '../store'

const filter = ref<Provider | 'all'>('all')
watch(
  () => store.search?.query,
  () => (filter.value = 'all'),
)

const groups = computed(() => store.search?.groups ?? [])
const total = computed(() => groups.value.reduce((n, g) => n + g.cards.length, 0))
const cards = computed<Card[]>(() =>
  groups.value.filter((g) => filter.value === 'all' || g.provider === filter.value).flatMap((g) => g.cards),
)
const failed = computed(() => groups.value.filter((g) => g.error && (filter.value === 'all' || g.provider === filter.value)))
/** 还没搜到任何东西 / 还有平台在搜：末尾补骨架行 */
const tailSkeleton = computed(() => (store.searching ? Math.min(2, Math.max(1, store.searchPending.length)) : 0))
const actionText = (c: Card) => (c.video || c.target === 'detail' ? '查看详情' : c.target === 'search' ? '搜这个' : '预约')
</script>

<template>
  <div class="page">
    <div class="h1-row">
      <h1 class="h1">“{{ store.query }}”</h1>
      <span v-if="store.search && groups.length" class="muted">
        {{ total }} 条结果 · {{ groups.length }} 个平台 · {{ (store.search.ms / 1000).toFixed(1) }}s
      </span>
    </div>

    <div v-if="store.searchError" class="error-box">{{ store.searchError }}</div>
    <div v-else-if="store.searching && !groups.length" class="list">
      <div class="filters">
        <span v-for="p in store.searchPending" :key="p" class="pill pending" aria-live="polite">
          <PlatformLogo :provider="p" :size="16" />{{ PROVIDER_NAME[p] }}<span class="spin" style="width: 12px; height: 12px" />
        </span>
      </div>
      <div v-for="i in 5" :key="i" class="card row sk-row">
        <Skeleton class="thumb-sk" w="76" h="106" r="8" />
        <div class="info">
          <Skeleton w="46%" h="19" />
          <Skeleton w="30%" h="13" />
          <Skeleton w="88%" h="13" />
          <Skeleton w="64%" h="13" />
        </div>
        <Skeleton class="src-sk" w="72" h="20" />
        <Skeleton w="104" h="38" r="8" />
      </div>
    </div>
    <template v-else-if="store.search">
      <div class="filters">
        <button type="button" class="pill" :class="{ on: filter === 'all' }" @click="filter = 'all'">
          全部<span class="count">{{ total }}</span>
        </button>
        <button
          v-for="g in groups"
          :key="g.provider"
          type="button"
          class="pill"
          :class="{ on: filter === g.provider }"
          :disabled="!g.cards.length && !g.error"
          @click="filter = g.provider"
        >
          <PlatformLogo :provider="g.provider" :size="16" />{{ PROVIDER_NAME[g.provider] }}
          <span class="count">{{ g.error ? '!' : g.cards.length }}</span>
        </button>
        <span v-for="p in store.searchPending" :key="p" class="pill pending" aria-live="polite">
          <PlatformLogo :provider="p" :size="16" />{{ PROVIDER_NAME[p] }}<span class="spin" style="width: 12px; height: 12px" />
        </span>
      </div>

      <div class="list">
        <button v-for="c in cards" :key="c.provider + (c.id || c.title)" type="button" class="card row" :disabled="c.target === 'unavailable'" :title="c.reason" @click="openCard(c)">
          <Poster class="thumb" :url="c.poster" :provider="c.provider" :title="c.title" :title-size="13" />
          <div class="info">
            <div class="t-row">
              <h3 class="t">{{ c.title }}</h3>
              <span v-if="c.vip" class="chip warn">VIP</span>
              <span v-if="c.score" class="chip mono">{{ c.score }}</span>
            </div>
            <span v-if="c.meta" class="dim">{{ c.meta }}</span>
            <span v-if="c.desc" class="muted desc">{{ c.desc }}</span>
          </div>
          <div class="src"><PlatformLogo :provider="c.provider" :size="20" /><span>{{ PROVIDER_NAME[c.provider] }}</span></div>
          <span class="btn outline">{{ actionText(c) }}<Icon name="arrow" :size="16" /></span>
        </button>

        <div v-for="i in tailSkeleton" :key="'sk' + i" class="card row sk-row">
          <Skeleton class="thumb-sk" w="76" h="106" r="8" />
          <div class="info">
            <Skeleton w="42%" h="19" />
            <Skeleton w="26%" h="13" />
            <Skeleton w="80%" h="13" />
            <Skeleton w="56%" h="13" />
          </div>
          <Skeleton class="src-sk" w="72" h="20" />
          <Skeleton w="104" h="38" r="8" />
        </div>

        <div v-if="!cards.length && !failed.length && !store.searching" class="empty">没有搜到结果</div>
        <div v-for="g in failed" :key="g.provider" class="warn-box">
          {{ PROVIDER_NAME[g.provider] }} 搜索失败：{{ g.error }}
        </div>
      </div>

      <div class="notice">
        <Icon name="link" :size="18" />
        <span>搜不到？直接把播放页链接粘到上面的搜索框</span>
        <span class="mono muted ex">v.youku.com/v_show/… · v.qq.com/x/cover/…</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.pending { cursor: default; color: var(--ink-3); border-style: dashed; }
.list { display: flex; flex-direction: column; gap: 12px; }
.row {
  padding: 16px; display: flex; gap: 18px; align-items: center; width: 100%; text-align: left;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
}
.row:hover:not(:disabled) { border-color: var(--ink); }
.row:disabled { cursor: not-allowed; opacity: .65; }
.thumb { width: 76px; height: 106px; padding: 8px; }
.thumb-sk { flex-shrink: 0; }
.src-sk { width: 88px; flex-shrink: 0; }
.sk-row { cursor: default; }
.sk-row .info { gap: 9px; }
.info { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.t-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.t { font-size: 19px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desc { font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }
.src { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; width: 88px; flex-shrink: 0; }
.ex { margin-left: auto; font-size: 12px; }
</style>
