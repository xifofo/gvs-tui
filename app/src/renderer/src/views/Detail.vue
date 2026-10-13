<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { cardSourceName } from '@shared/search-sources'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import Skeleton from '../components/Skeleton.vue'
import Quality from './Quality.vue'
import { back, errText, go, gvs, openCard, openQuality, runSearch, store, subscriptionOf, toast } from '../store'
import type { Card } from '@shared/api'
import { BADGE_LABEL, badgesFromQualities, badgesFromText, mergeHints, type QualityHint } from '@shared/quality-badges'
import { episodeStates, stateOf, STATE_LABEL, type EpisodeState } from '@shared/episode-status'

const d = computed(() => store.detail)
const collection = computed({ get: () => store.detailCollection, set: value => { store.detailCollection = value } })
const collections = computed(() => {
  const names = [...new Set((d.value?.episodes ?? []).map(e => e.collection).filter((g): g is string => !!g))]
  return names.includes('正片') ? ['正片', ...names.filter(g => g !== '正片')] : names
})
/** 季：平台返回多个季号时才出现季标签 */
const season = ref(0)
const seasons = computed(() => {
  const nums = [...new Set((d.value?.episodes ?? []).filter(e => !collection.value || e.collection === collection.value).map(e => e.season ?? 0))].sort((a, b) => a - b)
  return nums.length > 1 ? nums : []
})
const eps = computed(() => (d.value?.episodes ?? []).filter(e => (!collection.value || e.collection === collection.value) && (!seasons.value.length || (e.season ?? 0) === season.value)))
function switchSeason(n: number) {
  season.value = n
  store.picked = []
  anchor.value = -1
  range.value = ''
}
const duplicateNumbers = computed(() => new Set(eps.value.map(e => e.number)).size < eps.value.length)
const picked = computed(() => new Set(store.picked))
/** 同一部剧在其它平台的来源（来自合并搜索结果） */
const alternates = computed(() => (store.detailCard && store.detailCard.provider === d.value?.provider ? store.detailAlternates : []))
function switchSource(c: Card) {
  const current = store.detailCard
  openCard(c, [...alternates.value.filter((a) => a !== c), ...(current ? [current] : [])])
}
// 选集变了，之前探测的画质就作废：收起内嵌画质面板
watch(() => store.picked.join(','), () => {
  if (store.qualityInline && !store.probing) store.qualityInline = false
})
const range = ref('')
const rangeError = ref('')
const anchor = ref(-1)

/** 每集下载状态（已下载 / 排队 / 下载中…），来自下载任务列表 */
/** 下载历史（SQLite）：本地文件删掉后也算已下载 */
const historyLabels = ref<string[]>([])
watch(() => (d.value ? `${d.value.provider}:${d.value.id}` : ''), async (k) => {
  historyLabels.value = []
  if (!k || !d.value) return
  try {
    const rows = await gvs('historyForShow', d.value.provider, d.value.id)
    if (k === (d.value ? `${d.value.provider}:${d.value.id}` : '')) historyLabels.value = rows.map((r) => r.label)
  } catch { /* 历史库不可用时只看任务列表 */ }
}, { immediate: true })
const epStates = computed(() => {
  const m = d.value ? episodeStates(store.jobs, d.value.provider, d.value.id) : new Map<string, EpisodeState>()
  for (const l of historyLabels.value) if (!m.has(l)) m.set(l, 'done')
  return m
})
const epState = (e: { number: number; season?: number; title: string }) => stateOf(epStates.value, e, isMovie.value)
const doneCount = computed(() => eps.value.filter(e => epState(e) === 'done').length)

/** 长剧先显示前 FOLD 集，其余平滑展开 */
const FOLD = 60
const showAll = ref(false)
const headEps = computed(() => (showAll.value ? eps.value : eps.value.slice(0, FOLD)))
const tailCount = computed(() => Math.max(0, eps.value.length - FOLD))

/** 最佳画质徽标：平台文字 + 懒加载探测（主进程限流缓存），已取到画质时以探测为准 */
const hintProbe = ref<QualityHint | null>(null)
let hintSeq = 0
async function loadHint() {
  const v = d.value
  const seq = ++hintSeq
  hintProbe.value = null
  if (!v) return
  try {
    const h = await gvs('qualityHint', v.provider, v.id)
    if (seq === hintSeq) hintProbe.value = h
  } catch { /* 徽标是锦上添花，失败不提示 */ }
}
onUnmounted(() => { ++hintSeq })
const badges = computed(() => {
  const v = d.value
  if (!v) return []
  const card = store.detailCard && store.detailCard.provider === v.provider ? store.detailCard : null
  let h = mergeHints(badgesFromText(v.title, v.tags.join(' '), v.category, card?.meta), hintProbe.value)
  if (store.qualityInline && store.probe) h = mergeHints(h, badgesFromQualities(store.probe.qualities, store.probe.audios))
  return h.badges
})
const kindLabel = computed(() => (isMovie.value ? '电影' : d.value?.category || '剧集'))
const backdrop = computed(() => {
  const u = d.value?.poster || hintPoster.value
  return u ? `url("gvs-img://poster/?u=${encodeURIComponent(u)}&p=${encodeURIComponent(d.value?.provider ?? '')}")` : 'none'
})

function switchCollection(name: string) {
  collection.value = name
  store.picked = []
  anchor.value = -1
  range.value = ''
}

function setPicked(vids: string[]) {
  store.picked = eps.value.filter((e) => vids.includes(e.vid)).map((e) => e.vid)
}

function toggle(i: number, e: MouseEvent) {
  const ep = eps.value[i]
  if (!ep) return
  if (e.shiftKey && anchor.value >= 0) {
    const [a, b] = [Math.min(anchor.value, i), Math.max(anchor.value, i)]
    const on = !picked.value.has(ep.vid)
    const span = eps.value.slice(a, b + 1).map((x) => x.vid)
    const set = new Set(store.picked)
    for (const v of span) on ? set.add(v) : set.delete(v)
    setPicked([...set])
  } else {
    const set = new Set(store.picked)
    set.has(ep.vid) ? set.delete(ep.vid) : set.add(ep.vid)
    setPicked([...set])
  }
  anchor.value = i
}

function applyRange() {
  rangeError.value = ''
  const input = range.value.trim().replace(/\s*([-~–])\s*/g, '$1')
  if (!input) { rangeError.value = '输入集数范围，例如 1-12、15'; return }
  const nums = new Set<number>()
  for (const part of input.split(/[,，\s]+/)) {
    const m = /^(\d+)(?:\s*[-~–]\s*(\d+))?$/.exec(part.trim())
    if (!m) { rangeError.value = '范围格式不正确，例如 1-12、15'; return }
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || Math.abs(b-a) > 5000) { rangeError.value = '集数范围过大或无效'; return }
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 5000; n++) nums.add(n)
  }
  const ids = eps.value.filter((e) => nums.has(e.number)).map((e) => e.vid)
  if (!ids.length) { rangeError.value = '当前栏目没有这些集数，已保留原选择'; return }
  setPicked(ids)
}

const all = () => setPicked(eps.value.map((e) => e.vid))
const invert = () => setPicked(eps.value.filter((e) => !picked.value.has(e.vid)).map((e) => e.vid))
const clear = () => setPicked([])

const isMovie = computed(() => d.value?.kind === 'movie')
const meta = computed(() => {
  const v = d.value
  if (!v) return ''
  return [v.year || '', v.episodeCount && !isMovie.value ? `${v.episodeCount} ${collections.value.length ? '条' : '集'}` : '', v.category, v.tags.join(' / ')]
    .filter(Boolean)
    .join(' · ')
})
const label = (n: number) => String(n).padStart(eps.value.length >= 100 ? 3 : 2, '0')
function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '时长未知'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor(seconds % 3600 / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 还没拿到详情时：先用卡片带上来的标题/海报撑住骨架 */
const hint = computed(() => store.detailHint ?? {})
const hintPoster = computed(() => hint.value.poster ?? '')
const descOpen = ref(false)
/** 4 行以上的简介才给展开按钮（按字符数估，不引额外测量） */
const descLong = computed(() => (d.value?.desc?.length ?? 0) > 150)

/** 订阅：剧集（非电影）可订阅，按规则组自动下载新集 */
const sub = computed(() => (d.value ? subscriptionOf(d.value.provider, d.value.id) : null))
const subBusy = ref(false)
async function subscribe() {
  const v = d.value
  if (!v || subBusy.value) return
  subBusy.value = true
  try {
    const card = store.detailCard
    await gvs('subscribe', { provider: v.provider, showId: v.id, title: v.title, poster: v.poster, kind: v.kind, updateText: card && card.provider === v.provider ? [card.meta, card.desc].join(' ') : '' })
    toast(`已订阅《${v.title}》：之后的新集会按规则自动下载`, 'ok')
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    subBusy.value = false
  }
}

// 放在最后：immediate 回调会用到上面声明的 ref / 函数
watch(d, () => {
  range.value = ''
  anchor.value = -1
  if (!collections.value.includes(collection.value)) collection.value = d.value?.episodes.find(e => store.picked.includes(e.vid) || e.vid === d.value?.focusVid)?.collection ?? collections.value[0] ?? ''
  const focus = d.value?.episodes.find(e => store.picked.includes(e.vid) || e.vid === d.value?.focusVid)
  season.value = seasons.value.length ? (focus?.season ?? seasons.value[0]!) : 0
  showAll.value = false
  void loadHint()
}, { immediate: true })
</script>


<template>
  <div class="page detail-page">
    <div class="backdrop-clip" aria-hidden="true"><div class="backdrop" :style="{ backgroundImage: backdrop }" /></div>
    <button type="button" class="back back-chip" @click="back(store.search ? 'search' : 'home')"><Icon name="back" :size="16" />返回</button>

    <template v-if="store.detailLoading">
      <div class="hero">
        <div class="wrap">
          <Poster v-if="hintPoster" class="poster hero-target" :url="hintPoster" :title="hint.title ?? ''" :title-size="22" />
          <Skeleton v-else class="poster-sk" w="190" h="270" r="11" />
        </div>
        <div class="info">
          <Skeleton w="140" h="14" />
          <h1 v-if="hint.title" class="title">{{ hint.title }}</h1>
          <Skeleton v-else w="58%" h="42" r="8" />
          <div class="chips"><Skeleton w="52" h="24" r="6" /><Skeleton w="88" h="24" r="6" /><Skeleton w="64" h="24" r="6" /></div>
          <Skeleton w="96%" h="14" /><Skeleton w="92%" h="14" /><Skeleton w="70%" h="14" />
          <div class="actions"><Skeleton w="132" h="42" r="11" /><Skeleton w="112" h="42" r="11" /></div>
        </div>
      </div>
      <section class="card eps">
        <div class="eps-h">
          <Skeleton w="120" h="19" r="6" />
          <div class="sk-tools"><Skeleton w="120" h="36" r="8" /><Skeleton w="58" h="36" r="8" /><Skeleton w="58" h="36" r="8" /></div>
        </div>
        <div class="sk-grid">
          <Skeleton v-for="i in 40" :key="i" h="64" r="11" />
        </div>
      </section>
    </template>
    <div v-else-if="store.detailError" class="error-box derr" role="alert">
      <span>{{ store.detailCard ? `${cardSourceName(store.detailCard)}：` : '' }}{{ store.detailError }}</span>
      <span class="derr-a">
        <button v-if="store.detailCard" type="button" class="btn sm" @click="openCard(store.detailCard, store.detailAlternates)"><Icon name="retry" :size="14" />重试</button>
        <button v-for="a in store.detailAlternates" :key="a.provider + a.id" type="button" class="btn sm" @click="openCard(a, [store.detailCard!, ...store.detailAlternates.filter((x) => x !== a)].filter(Boolean))">
          <PlatformLogo :provider="a.provider" :size="14" />改用{{ cardSourceName(a) }}
        </button>
        <button v-if="store.detailCard?.title" type="button" class="btn sm" @click="runSearch(store.detailCard.title)"><Icon name="search" :size="14" />在各平台搜索</button>
      </span>
    </div>
    <template v-else-if="d">
      <div class="hero">
        <div class="wrap"><Poster class="poster hero-target" :url="d.poster" :provider="d.provider" :title="d.title" :title-size="22" /></div>
        <div class="info">
          <div class="src"><PlatformLogo :provider="d.provider" :size="18" /><span>{{ cardSourceName(d) }}</span><span v-if="d.vip" class="chip warn">VIP</span></div>
          <h1 class="title" :title="d.title">{{ d.title }}</h1>
          <div class="facts">
            <span v-if="d.year" class="fact mono">{{ d.year }}</span>
            <span class="fact">{{ kindLabel }}</span>
            <span v-if="!isMovie && d.episodeCount" class="fact">{{ d.episodeCount }} {{ collections.length ? '条' : '集' }}</span>
            <span v-if="d.score" class="fact score mono"><Icon name="star" :size="13" />{{ d.score }}</span>
            <span v-for="t in d.tags.slice(0, 5)" :key="t" class="tag">{{ t }}</span>
          </div>
          <div v-if="badges.length || d.drm" class="qbadges" aria-label="最佳画质">
            <span v-for="b in badges" :key="b" class="qb" :class="b.toLowerCase()">{{ BADGE_LABEL[b] }}</span>
            <span v-if="d.drm" class="qb drm">DRM · {{ d.drm }}</span>
          </div>
          <div v-if="alternates.length" class="alts" role="group" aria-label="切换平台">
            <span class="muted small">也在</span>
            <span class="alt on"><PlatformLogo :provider="d.provider" :size="16" />{{ cardSourceName(d) }}</span>
            <button v-for="a in alternates" :key="a.provider + a.id" type="button" class="alt" :title="`切换到 ${cardSourceName(a)} 的版本`" @click="switchSource(a)">
              <PlatformLogo :provider="a.provider" :size="16" />{{ cardSourceName(a) }}<span v-if="a.vip" class="vip">VIP</span>
            </button>
          </div>
          <p v-if="d.desc" class="desc" :class="{ open: descOpen }">{{ d.desc }}</p>
          <button v-if="descLong" type="button" class="linkish more" :aria-expanded="descOpen" @click="descOpen = !descOpen">{{ descOpen ? '收起' : '展开' }}</button>
          <div class="actions">
            <button type="button" class="btn primary big" :disabled="!store.picked.length || store.probing" @click="openQuality">
              <Icon name="download" />{{ store.picked.length ? `下载所选 ${store.picked.length} ${collection ? '条' : d.pickNoun}` : `先选${isMovie ? '版本' : '集数'}` }}
            </button>
            <button v-if="!isMovie && !sub" type="button" class="btn big subscribe" :disabled="subBusy" @click="subscribe"><Icon name="star" :size="16" />订阅追更</button>
            <button v-else-if="sub" type="button" class="btn big outline subscribe" title="打开订阅" @click="store.subFocus = sub.id; go('subscriptions')"><Icon name="check" :size="16" />已订阅 · {{ sub.autoDownload ? '自动下载' : '仅通知' }}</button>
          </div>
        </div>
      </div>

      <section class="card eps">
        <div class="eps-h">
          <h2 class="h2s">{{ isMovie ? '版本' : `${collection || '选集'}` }}<span class="count mono">{{ eps.length }}</span></h2>
          <span v-if="doneCount" class="chip ok">已下载 {{ doneCount }}</span>
          <span v-if="!isMovie" class="muted small">{{ collection ? '仅选择当前栏目 · 按住 Shift 可连选' : '按标题和时长区分正片与片段 · 按住 Shift 可连选' }}</span>
          <div v-if="!isMovie && eps.length > 1" class="tools">
            <form class="range" @submit.prevent="applyRange">
              <label for="range" class="small dim">范围</label>
              <input id="range" v-model="range" class="mono" placeholder="1-12" :aria-invalid="!!rangeError" @input="rangeError = ''" />
              <button type="submit" class="btn sm">应用范围</button>
            </form>
            <button type="button" class="btn sm" @click="all">全选</button>
            <button type="button" class="btn sm" @click="invert">反选</button>
            <button type="button" class="btn sm" @click="clear">清空</button>
          </div>
        </div>

        <p v-if="rangeError" class="error-box" role="alert">{{ rangeError }}</p>
        <div v-if="collections.length > 1 || seasons.length" class="tabrow">
          <div v-if="collections.length > 1" class="collection-tabs" role="tablist" aria-label="节目栏目">
            <button v-for="name in collections" :key="name" type="button" role="tab"
              class="pill" :class="{ on: collection === name }" :aria-selected="collection === name"
              @click="switchCollection(name)">{{ name }}</button>
          </div>
          <div v-if="seasons.length" class="collection-tabs" role="tablist" aria-label="季">
            <button v-for="n in seasons" :key="n" type="button" role="tab" class="pill" :class="{ on: season === n }" :aria-selected="season === n" @click="switchSeason(n)">{{ n ? `第 ${n} 季` : '未分季' }}</button>
          </div>
        </div>
        <div v-if="!eps.length" class="empty">当前栏目没有返回可下载的视频</div>
        <p v-if="duplicateNumbers && !isMovie" class="muted small">同集号有多个条目，请按标题和时长确认。</p>
        <div v-if="eps.length && isMovie" class="editions">
          <button
            v-for="(e, i) in eps"
            :key="e.vid"
            type="button"
            class="edition"
            :class="{ on: picked.has(e.vid) }"
            :aria-pressed="picked.has(e.vid)"
            :title="`${e.title || '正片'} · ${duration(e.duration)}`"
            @click="toggle(i, $event)"
          >
            <span class="box"><Icon v-if="picked.has(e.vid)" name="check" :size="14" :stroke="3" /></span>
            <span class="et">{{ e.title || '正片' }}</span>
            <span v-if="epState(e)" class="est" :class="epState(e)">{{ STATE_LABEL[epState(e)!] }}</span>
            <span class="muted mono">{{ duration(e.duration) }}</span>
          </button>
        </div>
        <div v-if="eps.length && !isMovie" class="grid stagger">
          <button
            v-for="(e, i) in headEps"
            :key="e.vid"
            type="button"
            class="ep"
            :class="[{ on: picked.has(e.vid) }, epState(e) ? `st-${epState(e)}` : '']"
            :aria-pressed="picked.has(e.vid)"
            :aria-label="`第 ${e.number} 集，${e.title || '标题未提供'}，${duration(e.duration)}${e.collection ? `，栏目：${e.collection}` : ''}${epState(e) ? `，${STATE_LABEL[epState(e)!]}` : ''}`"
            :title="`${e.title || '标题未提供'} · ${duration(e.duration)}`"
            @click="toggle(i, $event)"
          >
            <span class="episode-number mono">{{ label(e.number) }}</span>
            <span class="episode-info"><span class="episode-title">{{ e.title || '标题未提供' }}</span><span class="episode-meta mono">{{ duration(e.duration) }}<span v-if="epState(e)" class="est" :class="epState(e)">{{ STATE_LABEL[epState(e)!] }}</span></span></span>
            <Icon v-if="picked.has(e.vid)" class="episode-check" name="check" :size="14" :stroke="3" />
          </button>
        </div>
        <button v-if="!isMovie && tailCount" type="button" class="more-eps" :aria-expanded="showAll" @click="showAll = !showAll">
          <Icon :name="showAll ? 'up' : 'down'" :size="15" />{{ showAll ? '收起' : `展开其余 ${tailCount} 集` }}
        </button>

        <div class="foot" :class="{ static: store.qualityInline }">
          <span><b class="mono n">{{ store.picked.length }}</b> {{ collection ? '条' : d.pickNoun }}已选</span>
          <button type="button" class="btn primary" :disabled="!store.picked.length || store.probing" @click="openQuality">
            {{ store.qualityInline ? '重新取画质' : '选画质' }}<Icon :name="store.qualityInline ? 'refresh' : 'down'" />
          </button>
        </div>
      </section>
      <Transition name="rise">
        <Quality v-if="store.qualityInline" embedded />
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.detail-page { position: relative; isolation: isolate; }
.detail-page > :not(.backdrop-clip) { position: relative; z-index: 1; }
/* 模糊海报做背景：外层裁切 + contain，避免 filter 图层溢出到整个窗口 */
.backdrop-clip { position: absolute; inset: -22px -28px auto; height: 500px; z-index: 0; overflow: hidden; contain: paint; pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 70%) 45%, transparent 100%); mask-image: linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 70%) 45%, transparent 100%); }
.backdrop { position: absolute; inset: -60px; background-size: cover; background-position: center 30%; filter: blur(42px) saturate(1.3); opacity: var(--detail-backdrop-opacity, .5); }
/* 注意：scoped 里写 :global(html.light) .x 会编译成 html.light{…}，只能用变量 */
:global(html.light) { --detail-backdrop-opacity: .32; }
.back-chip { margin-bottom: -8px; height: 30px; padding: 0 12px 0 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink); background: color-mix(in srgb, var(--card) 72%, transparent); backdrop-filter: blur(8px); transition: border-color var(--ui-duration-fast, .12s), color var(--ui-duration-fast, .12s); }
.back-chip:hover { border-color: var(--orange); color: var(--orange-text); }
.back-chip:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
.derr { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.derr > span:first-child { flex: 1; min-width: 220px; }
.derr-a { display: flex; gap: 8px; flex-wrap: wrap; }
.hero { display: flex; gap: 32px; position: relative; padding: 8px 0 4px; }
.wrap { flex-shrink: 0; }
.poster { width: 190px; height: 270px; border-radius: var(--ui-radius-lg, 16px); box-shadow: 0 24px 48px -18px rgb(0 0 0 / 60%), 0 0 0 1px rgb(255 255 255 / 6%); }
.poster-sk { width: 190px; height: 270px; }
.info { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding-top: 6px; }
.src { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--ink-2); }
.title { font-family: var(--font-display); font-size: 38px; font-weight: 900; letter-spacing: -.8px; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.facts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; color: var(--ink-2); }
.fact { font-weight: 700; color: var(--ink); }
.fact + .fact::before { content: '·'; margin-right: 8px; color: var(--ink-3); font-weight: 400; }
.score { display: inline-flex; align-items: center; gap: 3px; color: var(--orange-text); }
.tag { height: 24px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--line); background: color-mix(in srgb, var(--card) 72%, transparent); font-size: 12px; display: inline-flex; align-items: center; }
.qbadges { display: flex; gap: 6px; flex-wrap: wrap; }
.qb { height: 24px; padding: 0 9px; border-radius: 7px; font-size: 12px; font-weight: 850; letter-spacing: .02em; display: inline-flex; align-items: center; color: var(--on-orange); background: var(--orange); box-shadow: var(--ui-glow); }
.qb.dv, .qb.hdr { color: #fff; background: linear-gradient(135deg, #7c3aed, #a78bfa); box-shadow: 0 6px 18px -8px #8b5cf6; }
.qb.dolby, .qb.atmos, .qb.dts { color: var(--ink); background: var(--raised); border: 1px solid var(--line-2); box-shadow: none; }
.qb.drm, .qb[class~="60fps"], .qb.imax { color: var(--ink-2); background: transparent; border: 1px solid var(--line); box-shadow: none; }
.alts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.alt { height: 28px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.alt:hover { border-color: var(--line-2); }
.alt.on { background: var(--orange); color: var(--on-orange); border-color: var(--orange); box-shadow: var(--ui-glow); cursor: default; }
.alt .vip { font-size: 10px; color: var(--orange-text); font-weight: 700; }
.desc { font-size: 14px; line-height: 1.75; color: var(--ink-2); max-width: 760px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.desc.open { -webkit-line-clamp: unset; }
.more { margin-top: -6px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.actions .btn.big { height: 44px; padding: 0 20px; border-radius: 11px; font-size: 14.5px; }
.eps { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; position: relative; z-index: 1; background: var(--card); }
.eps-h { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.h2s { font-size: 18px; font-weight: 900; display: inline-flex; align-items: baseline; gap: 8px; }
.h2s .count { font-size: 13px; color: var(--ink-3); font-weight: 700; }
.small { font-size: 13px; }
.tools { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.range { height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; display: flex; align-items: center; gap: 8px; background: var(--ui-input, var(--card)); }
.range:focus-within { border-color: var(--orange); }
.range input { width: 80px; border: 0; outline: 0; font-size: 14px; background: transparent; color: var(--ink); }
.tabrow { display: flex; flex-direction: column; gap: 10px; }
.collection-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.episode-number { font-size: 17px; font-weight: 850; flex-shrink: 0; min-width: 26px; color: var(--ink-2); }
.episode-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.episode-title { font-size: 13px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.episode-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-3); font-weight: 400; }
.ep.on .episode-meta { color: var(--ink-2); }
.episode-check { flex-shrink: 0; color: var(--orange-text); }
.est { font-family: var(--font-sans, inherit); font-size: 11px; font-weight: 800; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 16px; }
.est.done { color: var(--ok); }
.est.running { color: var(--orange-text); }
.est.queued, .est.paused { color: var(--ink-3); }
.est.failed { color: var(--err); }
/* 和整页一起滚：内层再套一个滚动区会让 sticky 底栏压住最后几行 */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 8px; padding: 2px; }
.ep {
  min-height: 64px; padding: 8px 12px; display: flex; gap: 12px; align-items: center; text-align: left; border-radius: 11px; border: 1.5px solid var(--line); background: var(--raised); cursor: pointer; min-width: 0; color: var(--ink);
  transition: border-color var(--ui-duration-fast, .12s), background var(--ui-duration-fast, .12s), transform var(--ui-duration-fast, .12s);
}
.ep:hover { border-color: var(--line-2); transform: translateY(-1px); }
.ep.on { background: var(--orange-soft); border-color: var(--orange); font-weight: 650; }
.ep.on .episode-number { color: var(--orange-text); }
.ep.st-done:not(.on) { border-color: color-mix(in srgb, var(--ok) 34%, var(--line)); }
.ep.st-done:not(.on) .episode-number { color: var(--ok); }
.more-eps { align-self: center; height: 34px; padding: 0 16px; border-radius: 999px; border: 1px dashed var(--line-2); background: transparent; color: var(--ink-2); display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; cursor: pointer; }
.more-eps:hover { color: var(--orange-text); border-color: var(--orange); }
.editions { display: flex; flex-direction: column; gap: 8px; }
.edition { height: 52px; padding: 0 16px; border-radius: 11px; border: 1.5px solid var(--line); background: var(--raised); color: var(--ink); display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 15px; text-align: left; }
.edition.on { border-color: var(--orange); background: var(--orange-soft); }
.box { width: 20px; height: 20px; border-radius: 6px; border: 2px solid var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--on-orange); }
.edition.on .box { background: var(--orange); border-color: var(--orange); }
.et { font-weight: 600; flex-grow: 1; }
/* Align the sticky action row with the page's bottom padding. */
.foot {
  position: sticky; bottom: -32px; margin: 0 -20px -18px; padding: 14px 20px 18px; background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: blur(10px);
  border-top: 1px solid var(--line); border-radius: 0 0 var(--ui-radius-lg, 16px) var(--ui-radius-lg, 16px); display: flex; align-items: center; gap: 16px;
}
.foot.static { position: relative; bottom: auto; }
.foot .n { font-size: 18px; color: var(--orange-text); }
.foot .btn { margin-left: auto; }
.sk-tools { margin-left: auto; display: flex; gap: 8px; }
.sk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.rise-enter-active { transition: opacity var(--ui-duration-base, .2s) var(--ui-ease-out, ease), transform var(--ui-duration-base, .2s) var(--ui-ease-out, ease); }
.rise-enter-from { opacity: 0; transform: translateY(10px); }
@media (max-width: 1100px) {
  .hero { gap: 22px; }
  .poster, .poster-sk { width: 150px; height: 214px; }
  .title { font-size: 30px; }
}
</style>
