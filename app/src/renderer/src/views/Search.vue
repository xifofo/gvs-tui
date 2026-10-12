<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PROVIDER_NAME, type Card, type Provider } from '@shared/api'
import { filterRows, mergeSearch } from '@shared/search-merge'
import { orderProviders } from '@shared/provider-registry'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import Skeleton from '../components/Skeleton.vue'
import { go, gvs, openCard, prefs, store } from '../store'
import { BADGE_LABEL, badgesFromText, mergeHints, qualityScore, type QualityHint } from '@shared/quality-badges'
import { reactive } from 'vue'

const groups = computed(() => store.search?.groups ?? [])
/** 结果到达顺序 → 用户的平台排序，保证合并后芯片顺序稳定 */
const orderedGroups = computed(() => {
  const order = orderProviders(groups.value.map((g) => g.provider), prefs().providerOrder)
  return order.map((p) => groups.value.find((g) => g.provider === p)!).filter(Boolean)
})
const rows = computed(() => mergeSearch<Card>(orderedGroups.value))
const filterSet = computed(() => new Set<string>(store.searchFilter))
// ---- 画质徽标：先用搜索结果自带的文字，没有再懒加载探测（主进程限流 2 并发、12 秒超时、缓存 6 小时）
const probed = reactive<Record<string, QualityHint | null>>({})
const asked = new Set<string>()
const PROBE_CAP = 12
type Row = (typeof rows.value)[number]
const probeTarget = (row: Row) => row.sources.find((c) => c.target === 'detail' && c.id && !c.video)
const metaHint = (row: Row) => badgesFromText(row.title, row.meta, ...row.sources.map((c) => `${c.title} ${c.meta} ${c.desc}`))
const hintOf = (row: Row): QualityHint => {
  const t = probeTarget(row)
  return mergeHints(metaHint(row), t ? probed[`${t.provider}:${t.id}`] : null)
}
const hintPending = (row: Row) => { const t = probeTarget(row); return !!t && asked.has(`${t.provider}:${t.id}`) && probed[`${t.provider}:${t.id}`] === undefined }
function requestHint(row: Row) {
  const t = probeTarget(row)
  if (!t || metaHint(row).height) return
  const key = `${t.provider}:${t.id}`
  if (asked.has(key) || asked.size >= PROBE_CAP * 4) return
  asked.add(key)
  void gvs('qualityHint', t.provider, t.id).then((h) => { probed[key] = h }).catch(() => { probed[key] = null })
}
let io: IntersectionObserver | null = null
const rowEls = new Map<Element, Row>()
let requested = 0
function observe(el: unknown, row: Row) {
  if (!(el instanceof Element) || rowEls.has(el)) return
  rowEls.set(el, row)
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const r = rowEls.get(e.target)
      if (r && requested < PROBE_CAP) { requested++; requestHint(r) }
      io?.unobserve(e.target)
    }
  }, { rootMargin: '120px' })
  io.observe(el)
}
watch(() => store.search?.query, () => { requested = 0; rowEls.clear(); io?.disconnect(); io = null })
onBeforeUnmount(() => io?.disconnect())

const sortBy = ref<'relevance' | 'quality'>('relevance')
const qFilter = ref<'' | '4k' | 'hdr' | 'dolby'>('')
const passQ = (h: QualityHint) => !qFilter.value || (qFilter.value === '4k' ? h.badges.includes('4K') : qFilter.value === 'hdr' ? h.badges.includes('HDR') || h.badges.includes('DV') : h.badges.includes('DOLBY') || h.badges.includes('ATMOS'))
const shown = computed(() => {
  const list = filterRows(rows.value, filterSet.value).filter((r) => passQ(hintOf(r)))
  return sortBy.value === 'quality' ? list.map((r, i) => ({ r, i, s: qualityScore(hintOf(r)) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r) : list
})
const total = computed(() => groups.value.reduce((n, g) => n + g.cards.length, 0))
const failed = computed(() => groups.value.filter((g) => g.error))
const returned = computed(() => groups.value.map((g) => g.provider))
const filterProviders = computed<Provider[]>(() => [...returned.value, ...store.searchPending.filter((p) => !returned.value.includes(p))])
const countOf = (p: Provider) => groups.value.find((g) => g.provider === p)?.cards.length ?? 0
watch(() => store.search?.query, () => { store.searchFilter = [] })

const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)
function toggleFilter(p: Provider) {
  const set = new Set(store.searchFilter)
  set.has(p) ? set.delete(p) : set.add(p)
  store.searchFilter = [...set]
}
const filterLabel = computed(() => {
  const n = store.searchFilter.length
  if (!n) return '全部平台'
  if (n === 1) return PROVIDER_NAME[store.searchFilter[0]!]
  return `${n} 个平台`
})
function onDoc(e: MouseEvent) {
  if (menuOpen.value && menu.value && !menu.value.contains(e.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))

const tailSkeleton = computed(() => (store.searching ? Math.min(2, Math.max(1, store.searchPending.length)) : 0))
const playable = (c: Card) => c.target !== 'unavailable'
function open(row: { sources: Card[] }, c?: Card) {
  const pick = c ?? row.sources.find(playable)
  if (!pick) return
  openCard(pick, row.sources.filter((s) => s !== pick))
}
const kindText = (k?: 'movie' | 'show') => (k === 'movie' ? '电影' : k === 'show' ? '剧集' : '')
/** 平台 meta 常带年份，行首已显示年份时去掉重复 */
function metaText(row: { year: number; meta: string }): string {
  if (!row.year) return row.meta
  return row.meta.split(/\s*[·|]\s*/).filter((part) => part.trim() !== String(row.year)).join(' · ')
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="h1 q">“{{ store.query }}”</h1>
      <span v-if="store.search && groups.length" class="muted">
        {{ rows.length }} 部作品 · {{ total }} 条结果 · {{ groups.length }} 个平台 · {{ (store.search.ms / 1000).toFixed(1) }}s
      </span>
      <div class="qtools">
        <select v-model="qFilter" class="qsel" aria-label="按画质筛选">
          <option value="">全部画质</option><option value="4k">仅 4K</option><option value="hdr">HDR / 杜比视界</option><option value="dolby">杜比音效</option>
        </select>
        <select v-model="sortBy" class="qsel" aria-label="排序">
          <option value="relevance">按相关度</option><option value="quality">画质优先</option>
        </select>
      </div>
      <div ref="menu" class="fwrap">
        <button type="button" class="btn sm" :class="{ outline: store.searchFilter.length }" :aria-expanded="menuOpen" aria-haspopup="listbox" @click="menuOpen = !menuOpen">
          平台：{{ filterLabel }}<Icon name="chevron" :size="14" />
        </button>
        <div v-if="menuOpen" class="fmenu card" role="listbox" aria-multiselectable="true" aria-label="按平台筛选">
          <div class="fm-h"><span>筛选平台</span><button type="button" class="linkish" @click="store.searchFilter = []">全部</button></div>
          <button v-for="p in filterProviders" :key="p" type="button" role="option" class="fm-i" :aria-selected="store.searchFilter.includes(p)" @click="toggleFilter(p)">
            <span class="cb" :class="{ on: store.searchFilter.includes(p) }"><Icon v-if="store.searchFilter.includes(p)" name="check" :size="12" :stroke="3" /></span>
            <PlatformLogo :provider="p" :size="16" />
            <span class="fm-n">{{ PROVIDER_NAME[p] }}</span>
            <span v-if="store.searchPending.includes(p)" class="spin" style="width: 12px; height: 12px" />
            <span v-else class="mono muted small">{{ groups.find((g) => g.provider === p)?.error ? '!' : countOf(p) }}</span>
          </button>
          <button type="button" class="fm-foot linkish" @click="go('accounts'); menuOpen = false">管理平台（排序 / 隐藏）</button>
        </div>
      </div>
    </div>

    <div v-if="store.searchPending.length || failed.length" class="status" aria-live="polite">
      <span v-for="p in store.searchPending" :key="p" class="chip"><span class="spin" style="width: 10px; height: 10px" />{{ PROVIDER_NAME[p] }} 搜索中</span>
      <span v-for="g in failed" :key="g.provider" class="chip warn" :title="g.error"><Icon name="alert" :size="13" />{{ PROVIDER_NAME[g.provider] }} 搜索失败</span>
    </div>

    <div v-if="store.searchError" class="error-box">{{ store.searchError }}</div>
    <div v-else class="list">
      <div v-for="row in shown" :key="row.key" :ref="(el) => observe(el, row)" class="card row" :class="{ off: !row.sources.some(playable) }">
        <button type="button" class="thumb-b" :disabled="!row.sources.some(playable)" :aria-label="`打开 ${row.title}`" @click="open(row)">
          <Poster class="thumb" :url="row.poster" :provider="row.sources[0]!.provider" :title="row.title" :title-size="12" />
        </button>
        <div class="info">
          <button type="button" class="t clamp2" :disabled="!row.sources.some(playable)" @click="open(row)">{{ row.title }}</button>
          <span class="dim small">{{ [row.year || '', kindText(row.mediaKind), metaText(row)].filter(Boolean).join(' · ') }}</span>
          <span v-if="hintOf(row).badges.length || hintPending(row)" class="qb" :title="hintOf(row).source === 'probe' ? '已探测第一集的最高画质' : '来自平台搜索信息'">
            <span v-for="b in hintOf(row).badges" :key="b" class="qbadge" :class="b === '1080P' ? 'r1080' : b">{{ BADGE_LABEL[b] }}</span>
            <span v-if="hintPending(row)" class="qbadge wait"><span class="spin" style="width: 9px; height: 9px" />探测画质</span>
          </span>
          <span v-if="row.desc" class="muted desc">{{ row.desc }}</span>
          <div class="srcs">
            <button
              v-for="c in row.sources" :key="c.provider + c.id" type="button" class="src" :disabled="!playable(c)"
              :title="c.reason || `在${PROVIDER_NAME[c.provider]}打开`" @click="open(row, c)"
            >
              <PlatformLogo :provider="c.provider" :size="16" />
              <span>{{ PROVIDER_NAME[c.provider] }}</span>
              <span v-if="c.vip" class="chip warn tiny">VIP</span>
              <span v-else-if="c.target !== 'unavailable'" class="chip ok tiny">可看</span>
              <span v-else class="chip tiny">预约</span>
            </button>
          </div>
        </div>
        <button type="button" class="btn outline go" :disabled="!row.sources.some(playable)" @click="open(row)">选集下载<Icon name="arrow" :size="16" /></button>
      </div>

      <div v-for="i in (groups.length ? tailSkeleton : store.searching ? 4 : 0)" :key="'sk' + i" class="card row sk-row">
        <Skeleton w="72" h="100" r="8" />
        <div class="info"><Skeleton w="42%" h="19" /><Skeleton w="26%" h="13" /><Skeleton w="80%" h="13" /><Skeleton w="56%" h="13" /></div>
      </div>

      <div v-if="!shown.length && !store.searching && store.search" class="empty">
        <Icon name="search" :size="28" />
        <span>{{ rows.length ? '所选平台没有结果' : '没有搜到结果' }}</span>
        <button v-if="store.searchFilter.length" type="button" class="btn sm" @click="store.searchFilter = []">显示全部平台</button>
      </div>
    </div>

    <div v-if="store.search && !store.searching" class="notice">
      <Icon name="link" :size="18" />
      <span>搜不到？直接把播放页链接粘到上面的搜索框</span>
      <span class="mono muted ex">v.youku.com/v_show/… · v.qq.com/x/cover/…</span>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.q { max-width: 60%; overflow-wrap: anywhere; }
.qtools { margin-left: auto; display: flex; gap: 6px; align-self: center; }
.qsel { height: 30px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: 0 8px; font-size: 13px; }
.fwrap { position: relative; align-self: center; }
.qb { display: flex; gap: 5px; flex-wrap: wrap; }
.qbadge { height: 20px; padding: 0 7px; border-radius: 4px; font: 700 11px var(--font-mono); display: inline-flex; align-items: center; gap: 4px; background: var(--ink); color: var(--paper); letter-spacing: .3px; }
.qbadge.r1080 { background: var(--paper-2); color: var(--ink); }
.qbadge.HDR { background: #6b4a12; color: #ffd98a; }
.qbadge.DV { background: #1d1d3a; color: #c9c3ff; }
.qbadge.DOLBY, .qbadge.ATMOS { background: #0f2f3a; color: #9fe3f5; }
.qbadge.wait { background: transparent; color: var(--ink-3); border: 1px dashed var(--line); font-weight: 500; }
.fmenu { position: absolute; right: 0; top: 42px; width: 280px; padding: 8px; z-index: 20; box-shadow: 0 14px 40px rgba(0, 0, 0, .16); display: flex; flex-direction: column; gap: 2px; }
.fm-h { display: flex; justify-content: space-between; padding: 4px 8px 6px; font-size: 12px; color: var(--ink-3); }
.fm-i { height: 36px; padding: 0 8px; border: 0; background: transparent; border-radius: 6px; display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px; text-align: left; }
.fm-i:hover { background: var(--paper); }
.fm-n { flex: 1; }
.cb { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid #cfcabe; display: flex; align-items: center; justify-content: center; }
.cb.on { background: var(--ink); border-color: var(--ink); color: var(--orange); }
.fm-foot { padding: 8px; border-top: 1px solid var(--line); margin-top: 4px; text-align: left; }
.status { display: flex; gap: 8px; flex-wrap: wrap; }
.status .chip { gap: 6px; }
.list { display: flex; flex-direction: column; gap: 10px; }
.row { padding: 12px; display: flex; gap: 16px; align-items: center; }
.row.off { opacity: .65; }
.thumb-b { border: 0; padding: 0; background: none; cursor: pointer; flex-shrink: 0; }
.thumb { width: 72px; height: 100px; padding: 8px; }
.sk-row { cursor: default; }
.info { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.t { border: 0; background: none; padding: 0; text-align: left; font-size: 17px; font-weight: 700; cursor: pointer; line-height: 1.35; }
.t:hover:not(:disabled) { color: var(--orange-text); }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.small { font-size: 12px; }
.desc { font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }
.srcs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.src { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.src:hover:not(:disabled) { border-color: var(--ink); background: var(--card); }
.src:disabled { cursor: not-allowed; opacity: .6; }
.tiny { height: 18px; padding: 0 6px; font-size: 11px; }
.go { flex-shrink: 0; }
.ex { margin-left: auto; font-size: 12px; }
</style>
