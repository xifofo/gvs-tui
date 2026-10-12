<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PROVIDER_NAME, type CalendarDay, type CalendarItem, type Provider } from '@shared/api'
import { dateKey, subscriptionItems } from '@shared/calendar'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import { errText, go, gvs, openDetail, store, subscriptionOf, toast } from '../store'

const DAY = 86_400_000
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const platform = ref<CalendarDay[]>([])
const loading = ref(false)
const error = ref('')
const mode = ref<'week' | 'list'>('week')
const source = ref<'all' | 'subs' | 'mgtv'>('all')
const offset = ref(0)

async function load() {
  loading.value = true
  try {
    const r = await gvs('calendar')
    platform.value = r.days
    error.value = r.error
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const weekStart = computed(() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset.value * 7)
  return d.getTime()
})
const range = computed<[number, number]>(() => (mode.value === 'week' ? [weekStart.value, weekStart.value + 7 * DAY] : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return [d.getTime() - DAY, d.getTime() + 14 * DAY] as [number, number] })()))
const subItems = computed(() => subscriptionItems(store.subs?.subs ?? [], range.value[0], range.value[1]))
const days = computed(() => {
  const [from, to] = range.value
  const out: Array<{ key: string; day: number; wd: string; today: boolean; items: CalendarItem[] }> = []
  const plat = new Map(platform.value.map((d) => [d.date, d.items]))
  const today = dateKey(Date.now())
  for (let t = from; t < to; t += DAY) {
    const d = new Date(t)
    const key = dateKey(t)
    const items = [
      ...(source.value !== 'mgtv' ? subItems.value.filter((i) => dateKey(i.onlineAt) === key) : []),
      ...(source.value !== 'subs' ? (plat.get(key) ?? []) : []),
    ]
    out.push({ key, day: d.getDate(), wd: WD[d.getDay()]!, today: key === today, items })
  }
  return out
})
const title = computed(() => {
  const [from, to] = range.value
  const a = new Date(from), b = new Date(to - DAY)
  return `${a.getFullYear()} 年 ${a.getMonth() + 1} 月 ${a.getDate()} 日 – ${b.getMonth() + 1} 月 ${b.getDate()} 日`
})
const counts = computed(() => ({ subs: subItems.value.length, mgtv: platform.value.reduce((n, d) => n + d.items.length, 0) }))
const nowLine = computed(() => { const d = new Date(); return (d.getHours() * 60 + d.getMinutes()) / 1440 })

const picked = ref<CalendarItem | null>(null)
const subscribed = (i: CalendarItem) => !!subscriptionOf(i.provider, i.id)
async function subscribe(i: CalendarItem) {
  try {
    await gvs('subscribe', { provider: i.provider, showId: i.id, title: i.title, poster: i.poster, kind: 'show', updateText: [i.episodes, i.time && `每周${'日一二三四五六'[new Date(i.onlineAt || Date.now()).getDay()]} ${i.time}更新`].filter(Boolean).join(' ') })
    toast(`已订阅《${i.title}》`, 'ok')
  } catch (e) { toast(errText(e), 'err') }
}
function open(i: CalendarItem) {
  if (!i.id) return
  void openDetail(i.provider as Provider, i.id, { title: i.title, poster: i.poster, mediaKind: 'show' })
}
const statusText: Record<string, string> = { downloaded: '已下载', pending: '待更新', new: '已更新未下载', failed: '失败' }
</script>

<template>
  <div class="page">
    <div class="h1-row top">
      <h1 class="h1">追剧日历</h1>
      <div class="seg mode"><button type="button" :class="{ on: mode === 'week' }" @click="mode = 'week'">周</button><button type="button" :class="{ on: mode === 'list' }" @click="mode = 'list'; offset = 0">15 天</button></div>
    </div>
    <div class="bar">
      <template v-if="mode === 'week'">
        <button type="button" class="btn sm icon" aria-label="上一周" @click="offset--"><Icon name="back" :size="14" /></button>
        <button type="button" class="btn sm" @click="offset = 0">今天</button>
        <button type="button" class="btn sm icon" aria-label="下一周" @click="offset++"><Icon name="arrow" :size="14" /></button>
      </template>
      <b class="rt">{{ title }}</b>
      <span class="lg"><i class="sw downloaded" />已下载</span><span class="lg"><i class="sw pending" />待更新</span><span class="lg"><i class="sw new" />已更新未下载</span><span class="lg"><i class="sw platform" />平台排播</span>
      <button type="button" class="btn sm icon rl" :disabled="loading" title="刷新" aria-label="刷新" @click="load"><Icon name="refresh" :size="14" /></button>
    </div>
    <div class="bar">
      <button type="button" class="pill" :class="{ on: source === 'all' }" @click="source = 'all'">全部<span class="count">{{ counts.subs + counts.mgtv }}</span></button>
      <button type="button" class="pill" :class="{ on: source === 'subs' }" @click="source = 'subs'"><Icon name="star" :size="13" />我的订阅<span class="count">{{ counts.subs }}</span></button>
      <button type="button" class="pill" :class="{ on: source === 'mgtv' }" @click="source = 'mgtv'"><PlatformLogo provider="mgtv" :size="14" />芒果 TV 排播<span class="count">{{ counts.mgtv }}</span></button>
      <span class="muted small note">其它平台按订阅检测到的更新和更新规律（例如「每日19:30更新」）推算 · 时间为本机时间</span>
    </div>
    <p v-if="error" class="warn-box">芒果 TV 排播暂时取不到：{{ error }}</p>

    <div class="cal" :class="mode">
      <section v-for="d in days" :key="d.key" class="col card" :class="{ today: d.today }">
        <header class="ch"><b class="mono">{{ d.day }}</b><span>{{ d.wd }}<template v-if="d.today"> · 今天</template></span><span class="muted small cnt">{{ d.items.length || '' }}</span></header>
        <div class="items">
          <div v-if="d.today && mode === 'week'" class="now" :style="{ order: Math.round(nowLine * 100) }"><span class="mono">{{ new Date().toTimeString().slice(0, 5) }}</span></div>
          <button v-for="(i, k) in d.items" :key="i.source + i.id + k" type="button" class="it" :class="[i.source === 'platform' ? 'platform' : i.status]"
            :style="{ order: Math.round(((Number(i.time.slice(0, 2)) * 60 + Number(i.time.slice(3, 5))) / 1440) * 100) || 0 }" @click="picked = i">
            <Poster class="ip" :url="i.poster" :provider="i.provider" :title="i.title" :title-size="8" loading="lazy" />
            <span class="im"><span class="in"><PlatformLogo :provider="i.provider" :size="13" /><b>{{ i.title }}</b></span><span class="muted small">{{ i.episodes }}<template v-if="i.time"> · {{ i.time }}</template></span>
              <span class="tag">{{ i.source === 'platform' ? '平台预告' : statusText[i.status ?? 'pending'] }}</span></span>
          </button>
          <span v-if="!d.items.length" class="muted small none">—</span>
        </div>
      </section>
    </div>

    <div v-if="picked" class="pop-bg" @click.self="picked = null">
      <div class="pop card" role="dialog" :aria-label="picked.title">
        <div class="ph"><PlatformLogo :provider="picked.provider" :size="18" /><b>{{ picked.title }}</b><span class="chip" :class="{ warn: picked.status === 'new', ok: picked.status === 'downloaded' }">{{ picked.source === 'platform' ? '平台预告' : statusText[picked.status ?? 'pending'] }}</span></div>
        <dl>
          <dt>平台</dt><dd>{{ PROVIDER_NAME[picked.provider as Provider] ?? picked.provider }}</dd>
          <dt>集数</dt><dd>{{ picked.episodes || '—' }}</dd>
          <dt>时间</dt><dd class="mono">{{ picked.onlineText || (picked.onlineAt ? new Date(picked.onlineAt).toLocaleString() : picked.time) }}</dd>
          <dt v-if="picked.info">类型</dt><dd v-if="picked.info">{{ picked.info }}</dd>
          <dt>来源</dt><dd>{{ picked.source === 'platform' ? '芒果 TV 排播接口' : '订阅检测 / 更新规律推算' }}</dd>
        </dl>
        <div class="pa">
          <button v-if="picked.source === 'platform' && !subscribed(picked)" type="button" class="btn sm primary" @click="subscribe(picked); picked = null"><Icon name="star" :size="14" />订阅</button>
          <span v-else-if="picked.source === 'platform'" class="chip ok">已订阅</span>
          <button v-if="picked.source === 'subscription'" type="button" class="btn sm" @click="store.subFocus = subscriptionOf(picked.provider, picked.id)?.id ?? ''; picked = null; go('subscriptions')">打开订阅</button>
          <button type="button" class="btn sm" @click="open(picked); picked = null">打开详情</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top { align-items: center; }
.mode { margin-left: auto; width: 160px; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rt { margin: 0 8px; font-size: 15px; }
.lg { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-2); }
.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.downloaded { background: var(--ok); } .sw.pending { background: #b9b5aa; } .sw.new { background: var(--orange); } .sw.platform { background: #f2a33a; }
.rl { margin-left: auto; }
.note { margin-left: auto; }
.small { font-size: 12px; }
.cal { display: grid; gap: 10px; align-items: stretch; }
.cal.week { grid-template-columns: repeat(7, minmax(0, 1fr)); min-height: 480px; }
.cal.list { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.col { padding: 0; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.col.today { border-color: var(--orange); background: var(--orange-soft); }
.ch { display: flex; align-items: baseline; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
.ch b { font-size: 18px; }
.col.today .ch { background: var(--orange); color: var(--ink); border-color: var(--orange); }
.cnt { margin-left: auto; }
.items { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; max-height: 640px; }
.it { display: flex; gap: 8px; padding: 6px; border: 1px solid var(--line); border-left: 3px solid #b9b5aa; border-radius: 6px; background: var(--card); text-align: left; cursor: pointer; min-width: 0; }
.it:hover { border-color: var(--ink); }
.it.downloaded { border-left-color: var(--ok); background: #f3faf5; }
.it.new { border-left-color: var(--orange); background: #fff7f1; }
.it.platform { border-left-color: #f2a33a; }
.ip { width: 34px; height: 48px; padding: 2px; flex-shrink: 0; }
.im { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12px; }
.in { display: flex; gap: 4px; align-items: center; min-width: 0; }
.in b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { align-self: flex-start; font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--paper-2); color: var(--ink-2); }
.now { height: 0; border-top: 2px solid var(--err); position: relative; margin: 4px 0; }
.now span { position: absolute; top: -9px; left: -4px; background: var(--err); color: #fff; font-size: 10px; padding: 0 4px; border-radius: 3px; }
.none { padding: 8px 4px; }
.pop-bg { position: fixed; inset: 0; z-index: 40; background: rgba(23, 24, 28, .25); display: flex; align-items: center; justify-content: center; }
.pop { width: 400px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, .15); }
.ph { display: flex; align-items: center; gap: 8px; }
.ph .chip { margin-left: auto; }
dl { display: grid; grid-template-columns: 56px 1fr; gap: 6px 10px; margin: 0; font-size: 13px; }
dt { color: var(--ink-3); } dd { margin: 0; }
.pa { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
</style>
