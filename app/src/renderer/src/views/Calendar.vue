<script setup lang="ts">
/**
 * 追剧日历 v3（Hdhive 风格）：
 * - 我的追剧：日期条 + 按天日程（行内展开详情）+ 右栏（下一个更新倒计时 / 今日概览 / 今日待更新）
 * - 发现新剧：芒果 TV 排播（平台 / 类型筛选、只看未订阅、一键订阅）
 * - 月历：整月格子，每格海报缩略 + 剧名
 * - 空状态：还没订阅时引导搜索或去发现
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { PROVIDER_NAME, type CalendarDay, type CalendarItem, type Provider, type Subscription } from '@shared/api'
import { dateKey, subscriptionItems } from '@shared/calendar'
import { windowText } from '@shared/subscription'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import { errText, go, gvs, openDetail, store, subscriptionOf, toast } from '../store'

const DAY = 86_400_000
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const platform = ref<CalendarDay[]>([])
const loading = ref(false)
const error = ref('')
const tab = ref<'mine' | 'discover'>('mine')
const mode = ref<'agenda' | 'month'>('agenda')
const weekOffset = ref(0)
const monthOffset = ref(0)
const selected = ref(dateKey(Date.now()))
const expanded = ref('')
const foldOpen = ref(false)
const pf = ref<string>('all')
const pfMenu = ref(false)
const dType = ref('all')
const onlyUnsub = ref(false)
const now = ref(Date.now())
let timer = 0

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
onMounted(() => {
  void load()
  timer = window.setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const today = computed(() => dayStart(now.value))
const todayKey = computed(() => dateKey(today.value))
const subs = computed<Subscription[]>(() => store.subs?.subs ?? [])
const subCount = computed(() => subs.value.length)

/* ---------- 数据：订阅条目 + 芒果排播里已订阅的剧（给出确切时间） ---------- */
type Row = CalendarItem & { key: string; sub: Subscription | null; est: boolean }
const platByDay = computed(() => new Map(platform.value.map((d) => [d.date, d.items])))
function mineItems(from: number, to: number): Row[] {
  const out: Row[] = []
  for (const i of subscriptionItems(subs.value, from, to, now.value)) {
    const sub = subscriptionOf(i.provider, i.id)
    let it: CalendarItem = i
    let est = i.status === 'pending'
    if (est) {
      const p = (platByDay.value.get(dateKey(i.onlineAt)) ?? []).find((x) => x.provider === i.provider && x.id === i.id)
      if (p) { it = { ...i, time: p.time || i.time, episodes: p.episodes || i.episodes, onlineAt: p.onlineAt || i.onlineAt }; est = false }
    }
    out.push({ ...it, key: `${i.provider}:${i.id}:${i.onlineAt}`, sub, est })
  }
  // 芒果排播有、但订阅推算没有的（例如订阅没写更新规律）
  for (const [k, items] of platByDay.value) {
    const t = new Date(`${k}T00:00:00`).getTime()
    if (t < from || t >= to) continue
    for (const p of items) {
      const sub = subscriptionOf(p.provider, p.id)
      if (!sub || out.some((r) => r.provider === p.provider && r.id === p.id && dateKey(r.onlineAt) === k)) continue
      out.push({ ...p, source: 'subscription', status: 'pending', key: `${p.provider}:${p.id}:${p.onlineAt}`, sub, est: false })
    }
  }
  return out
    .filter((r) => pf.value === 'all' || r.provider === pf.value)
    .sort((a, b) => a.onlineAt - b.onlineAt || a.time.localeCompare(b.time))
}

/* ---------- 日期条（一周） ---------- */
const stripStart = computed(() => {
  const d = new Date(today.value)
  d.setDate(d.getDate() + weekOffset.value * 7)
  return d.getTime()
})
const stripItems = computed(() => mineItems(stripStart.value, stripStart.value + 7 * DAY))
const strip = computed(() => Array.from({ length: 7 }, (_, n) => {
  const t = stripStart.value + n * DAY
  const d = new Date(t)
  const k = dateKey(t)
  const items = stripItems.value.filter((i) => dateKey(i.onlineAt) === k)
  const diff = Math.round((t - today.value) / DAY)
  return {
    key: k, t, items,
    label: diff === 0 ? '今天' : diff === 1 ? '明天' : `${d.getMonth() + 1}月${d.getDate()}日`,
    wd: WD[d.getDay()]!,
    dots: items.slice(0, 5).map((i) => (i.status === 'downloaded' ? 'g' : i.status === 'new' ? '' : 'x')),
  }
}))
const agendaDays = computed(() => strip.value.map((d) => {
  const dt = new Date(d.t)
  const diff = Math.round((d.t - today.value) / DAY)
  return { ...d, title: `${diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '后天' : ''}${diff >= 0 && diff <= 2 ? ' · ' : ''}${dt.getMonth() + 1}月${dt.getDate()}日 ${WD[dt.getDay()]}`, isToday: diff === 0 }
}))
const foldDays = computed(() => {
  const from = stripStart.value - 7 * DAY
  const items = mineItems(from, stripStart.value).filter((i) => i.status !== 'pending')
  const a = new Date(from), b = new Date(stripStart.value - DAY)
  const pending = items.filter((i) => i.status === 'new').length
  const days = Array.from({ length: 7 }, (_, n) => {
    const t = from + n * DAY
    const k = dateKey(t)
    const dt = new Date(t)
    return { key: k, title: `${dt.getMonth() + 1}月${dt.getDate()}日 ${WD[dt.getDay()]}`, items: items.filter((i) => dateKey(i.onlineAt) === k) }
  }).filter((d) => d.items.length)
  return { label: `${weekOffset.value === 0 ? '前 7 天' : '上一段'} ${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`, count: items.length, pending, days }
})

function pick(k: string) {
  selected.value = k
  void nextTick(() => document.getElementById(`cal-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

/* ---------- 今天 / 右栏 ---------- */
const todayItems = computed(() => mineItems(today.value, today.value + DAY))
const todayStats = computed(() => ({
  done: todayItems.value.filter((i) => i.status === 'downloaded').length,
  todo: todayItems.value.filter((i) => i.status === 'new').length,
  wait: todayItems.value.filter((i) => i.status === 'pending').length,
}))
const upcoming = computed(() => mineItems(today.value, today.value + 8 * DAY).filter((i) => i.status === 'pending' && i.onlineAt > now.value))
const next = computed(() => upcoming.value[0] ?? null)
const countdown = computed(() => {
  if (!next.value) return ''
  const s = Math.max(0, Math.floor((next.value.onlineAt - now.value) / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return s >= 86400 ? `${Math.floor(s / 86400)} 天 ${p(Math.floor((s % 86400) / 3600))} 时` : `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
})
const nextWhen = computed(() => {
  if (!next.value) return ''
  const diff = Math.round((dayStart(next.value.onlineAt) - today.value) / DAY)
  return `${diff === 0 ? '今天' : diff === 1 ? '明天' : WD[new Date(next.value.onlineAt).getDay()]} ${next.value.est ? '~' : ''}${next.value.time}`
})
const relTime = (i: Row) => {
  if (i.est && i.onlineAt <= now.value) return '预计'
  const m = Math.round((i.onlineAt - now.value) / 60000)
  if (i.est) return '预计'
  return m <= 0 ? '已到点' : m < 60 ? `${m} 分钟后` : `${Math.round(m / 60)} 小时后`
}
const todayPending = computed(() => todayItems.value.filter((i) => i.status === 'pending'))

/* ---------- 动作 ---------- */
const providers = computed(() => [...new Set(subs.value.map((s) => s.provider))])
const pname = (p: string) => PROVIDER_NAME[p as Provider] ?? p
const statusOf = (i: Row) => i.status === 'downloaded' ? { cls: 'ok', icon: 'check', text: '已下载' }
  : i.status === 'new' ? { cls: 'new', icon: '', text: '已更新 · 未下载' }
  : i.status === 'failed' ? { cls: 'err', icon: 'alert', text: '下载失败' }
  : i.est ? { cls: 'est', icon: 'wave', text: '预计更新' }
  : i.onlineAt <= now.value ? { cls: 'wait', icon: 'refresh', text: '到点 · 检测中' }
  : { cls: 'wait', icon: 'clock', text: i.onlineAt > now.value && i.onlineAt - now.value < DAY ? `待更新 · 剩 ${short(i.onlineAt - now.value)}` : '待更新' }
function short(ms: number) {
  const m = Math.floor(ms / 60000)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
async function download(r: Row) {
  if (!r.sub) return
  try { await gvs('checkSubscriptions', r.sub.id); toast(`《${r.title}》已开始检查并下载新集`, 'ok') } catch (e) { toast(errText(e), 'err') }
}
async function downloadAllToday() {
  const ids = [...new Set(todayItems.value.filter((i) => i.status === 'new' && i.sub).map((i) => i.sub!.id))]
  try { for (const id of ids) await gvs('checkSubscriptions', id); toast(`已开始下载 ${todayStats.value.todo} 集`, 'ok') } catch (e) { toast(errText(e), 'err') }
}
function editSub(r: Row) {
  store.subFocus = r.sub?.id ?? ''
  go('subscriptions')
}
function open(i: CalendarItem) {
  if (!i.id) return
  void openDetail(i.provider as Provider, i.id, { title: i.title, poster: i.poster, mediaKind: 'show' })
}
const progress = (s: Subscription | null) => {
  if (!s) return '—'
  const got = s.episodes.filter((e) => e.downloaded).length
  return `已下载 ${got} / 共 ${s.total || s.episodes.length} 集`
}
const rulesText = (s: Subscription | null) => (s?.rules || '默认').replace(/\s*>\s*/g, ' › ').replace(/\s*&\s*/g, '&')
const estSource = (r: Row) => r.sub?.updateText ? `按「${r.sub.updateText}」推算` : r.sub?.window ? `按检查时间窗推算` : '按以往更新时间推算'

/* ---------- 发现新剧（芒果排播） ---------- */
const kindOf = (i: CalendarItem) => (i.info || '').split('/')[0]!.trim()
const discoverDays = computed(() => {
  const types = new Set<string>()
  const days = platform.value
    .filter((d) => new Date(`${d.date}T00:00:00`).getTime() >= today.value)
    .map((d) => {
      d.items.forEach((i) => i.info && types.add(kindOf(i)))
      const items = d.items.filter((i) => (dType.value === 'all' || kindOf(i) === dType.value) && (!onlyUnsub.value || !subscriptionOf(i.provider, i.id)))
      const dt = new Date(`${d.date}T00:00:00`)
      const diff = Math.round((dt.getTime() - today.value) / DAY)
      return { key: d.date, items, title: `${diff === 0 ? '今天 · ' : diff === 1 ? '明天 · ' : ''}${dt.getMonth() + 1}月${dt.getDate()}日 ${WD[dt.getDay()]}`, isToday: diff === 0 }
    })
    .filter((d) => d.items.length)
  return { days, types: [...types].slice(0, 6) }
})
const suggestions = computed(() => (platform.value.find((d) => d.date === todayKey.value)?.items ?? platform.value[0]?.items ?? []).slice(0, 6))
async function subscribe(i: CalendarItem) {
  try {
    await gvs('subscribe', { provider: i.provider, showId: i.id, title: i.title, poster: i.poster, kind: 'show', updateText: [i.episodes, i.time && `每周${'日一二三四五六'[new Date(i.onlineAt || Date.now()).getDay()]} ${i.time}更新`].filter(Boolean).join(' ') })
    toast(`已订阅《${i.title}》，之后会出现在「我的追剧」`, 'ok')
  } catch (e) { toast(errText(e), 'err') }
}

/* ---------- 月历 ---------- */
const monthBase = computed(() => { const d = new Date(today.value); d.setDate(1); d.setMonth(d.getMonth() + monthOffset.value); return d })
const monthCells = computed(() => {
  const first = monthBase.value
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7))
  const rows = Math.ceil((((first.getDay() + 6) % 7) + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7)
  const from = start.getTime(), to = from + rows * 7 * DAY
  const items = mineItems(from, to)
  return Array.from({ length: rows * 7 }, (_, n) => {
    const t = dayStart(from + n * DAY + 3_600_000)
    const k = dateKey(t)
    const its = items.filter((i) => dateKey(i.onlineAt) === k)
    const uniq = [...new Map(its.map((i) => [i.provider + i.id, i])).values()]
    return { key: k, t, day: new Date(t).getDate(), out: new Date(t).getMonth() !== first.getMonth(), past: t < today.value, today: k === todayKey.value, items: uniq }
  })
})
const monthTitle = computed(() => `${monthBase.value.getFullYear()}年${monthBase.value.getMonth() + 1}月`)
const monthCount = computed(() => monthCells.value.filter((c) => !c.out && c.items.length).length)
function openDay(c: { t: number; key: string }) {
  weekOffset.value = Math.floor((dayStart(c.t) - today.value) / (7 * DAY))
  mode.value = 'agenda'
  pick(c.key)
}

const eyebrow = computed(() => {
  if (tab.value === 'discover') return '发现新剧 · 平台排期'
  if (mode.value === 'month') return '追剧日历 · 月历'
  if (!subCount.value) return '追剧日历'
  const a = new Date(stripStart.value), b = new Date(stripStart.value + 6 * DAY)
  return `追剧日历 · ${weekOffset.value === 0 ? '未来 7 天' : '所选一周'} ${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`
})
const subline = computed(() => {
  if (tab.value === 'discover') return '各平台近期上新与更新排期，订阅后进入「我的追剧」'
  if (mode.value === 'month') return `已订阅 ${subCount.value} 部 · 本月 ${monthCount.value} 天有更新`
  if (!subCount.value) return '订阅后，更新会按天排在这里'
  return `已订阅 ${subCount.value} 部 · 今天 ${todayItems.value.length} 部更新，${todayStats.value.todo} 集待下载`
})
</script>

<template>
  <div class="page cal">
    <header class="top">
      <div class="ttl">
        <span class="eyebrow">{{ eyebrow }}</span>
        <h1 class="h1">{{ tab === 'discover' ? '发现新剧' : mode === 'month' ? monthTitle : '我的追剧' }}</h1>
        <p class="sub">{{ subline }}</p>
      </div>
      <div class="seg acc" role="tablist" aria-label="日历内容">
        <button type="button" role="tab" :aria-selected="tab === 'mine'" :class="{ on: tab === 'mine' }" @click="tab = 'mine'"><Icon name="star" :size="15" />我的追剧<em>{{ subCount }}</em></button>
        <button type="button" role="tab" :aria-selected="tab === 'discover'" :class="{ on: tab === 'discover' }" @click="tab = 'discover'"><Icon name="tv" :size="15" />发现新剧</button>
      </div>
      <div v-if="tab === 'mine'" class="seg" role="radiogroup" aria-label="视图">
        <button type="button" role="radio" :aria-checked="mode === 'agenda'" :class="{ on: mode === 'agenda' }" @click="mode = 'agenda'">日程</button>
        <button type="button" role="radio" :aria-checked="mode === 'month'" :class="{ on: mode === 'month' }" @click="mode = 'month'">月历</button>
      </div>
      <template v-if="tab === 'mine' && mode === 'month'">
        <button type="button" class="btn icon" aria-label="上个月" @click="monthOffset--"><Icon name="left" :size="16" /></button>
        <button type="button" class="btn" @click="monthOffset = 0">今天</button>
        <button type="button" class="btn icon" aria-label="下个月" @click="monthOffset++"><Icon name="right" :size="16" /></button>
      </template>
      <div v-else-if="tab === 'mine' && subCount" class="pfw">
        <button type="button" class="btn" :aria-expanded="pfMenu" @click="pfMenu = !pfMenu"><Icon name="filter" :size="15" />{{ pf === 'all' ? '全部平台' : pname(pf) }}</button>
        <Transition name="pop">
          <div v-if="pfMenu" class="menu card" role="menu" @click="pfMenu = false">
            <button type="button" role="menuitemradio" :aria-checked="pf === 'all'" :class="{ on: pf === 'all' }" @click="pf = 'all'">全部平台</button>
            <button v-for="p in providers" :key="p" type="button" role="menuitemradio" :aria-checked="pf === p" :class="{ on: pf === p }" @click="pf = p"><PlatformLogo :provider="p" :size="15" />{{ pname(p) }}</button>
          </div>
        </Transition>
      </div>
      <button v-else-if="tab === 'discover'" type="button" class="btn" @click="go('search')"><Icon name="search" :size="15" />搜索节目</button>
    </header>

    <p v-if="error && tab === 'discover'" class="warn-box">芒果 TV 排播暂时取不到：{{ error }}</p>

    <!-- ===== 空状态 ===== -->
    <section v-if="tab === 'mine' && !subCount" class="emp">
      <div class="empty-ill"><Icon name="calendar" :size="40" :stroke="1.6" /></div>
      <h3>还没有追的剧</h3>
      <p class="sub">订阅后，每部剧的更新时间会按天排在这里；有新集时按画质规则自动下载。</p>
      <div class="emp-a">
        <button type="button" class="btn primary" @click="go('search')"><Icon name="search" :size="16" />搜索并订阅</button>
        <button type="button" class="btn" @click="tab = 'discover'">浏览发现新剧<Icon name="right" :size="14" /></button>
      </div>
      <template v-if="suggestions.length">
        <span class="muted small">今天芒果TV上新</span>
        <div class="sugg stagger">
          <div v-for="(i, n) in suggestions" :key="i.id + n" class="mc" data-card :style="{ '--i': n }">
            <button type="button" class="pst lift" @click="open(i)"><Poster :url="i.poster" :provider="i.provider" :title="i.title" :title-size="14" loading="lazy" /><span v-if="i.time" class="bdg l">{{ i.time }}</span></button>
            <b class="t">{{ i.title }}</b>
            <span class="m"><span>{{ [kindOf(i), i.episodes].filter(Boolean).join(' · ') }}</span><button type="button" class="subb" @click="subscribe(i)">+ 订阅</button></span>
          </div>
        </div>
      </template>
    </section>

    <!-- ===== 我的追剧 · 日程 ===== -->
    <div v-else-if="tab === 'mine' && mode === 'agenda'" class="body">
      <div class="col">
        <div class="rail">
          <button type="button" class="arr" aria-label="上一周" @click="weekOffset--"><Icon name="left" :size="16" /></button>
          <button v-for="d in strip" :key="d.key" type="button" class="date" :class="{ on: selected === d.key, none: !d.items.length }" :aria-pressed="selected === d.key" @click="pick(d.key)">
            <span class="p">{{ d.label }}</span>
            <span class="s">{{ d.wd }} · {{ d.items.length ? `${d.items.length} 部` : '无更新' }}</span>
            <span class="dots"><i v-for="(c, n) in d.dots" :key="n" class="dt" :class="c" /></span>
          </button>
          <button type="button" class="arr" aria-label="下一周" @click="weekOffset++"><Icon name="right" :size="16" /></button>
        </div>

        <div v-if="foldDays.count" class="fold-w">
          <button type="button" class="fold" :aria-expanded="foldOpen" @click="foldOpen = !foldOpen">
            <span>{{ foldDays.label }} · {{ foldDays.count }} 集已更新，<b>{{ foldDays.pending ? `${foldDays.pending} 集未下载` : '全部已下载' }}</b></span>
            <span class="muted">{{ foldOpen ? '收起' : '展开' }}<Icon :name="foldOpen ? 'up' : 'down'" :size="14" /></span>
          </button>
          <Transition name="expand">
            <div v-if="foldOpen" class="collapse"><div>
              <div v-for="d in foldDays.days" :key="d.key" class="pastd">
                <span class="pd">{{ d.title }}</span>
                <span v-for="i in d.items" :key="i.key" class="pi"><PlatformLogo :provider="i.provider" :size="13" />{{ i.title }} <em>{{ i.episodes }}</em><i class="tg" :class="statusOf(i).cls">{{ statusOf(i).text }}</i></span>
              </div>
            </div></div>
          </Transition>
        </div>

        <section v-for="d in agendaDays" :id="`cal-${d.key}`" :key="d.key" class="day">
          <h2 class="dh" :class="{ today: d.isToday }"><span>{{ d.title }}</span><small>{{ d.items.length ? `${d.items.length} 部更新` : '无更新' }}</small><i class="line" /></h2>
          <p v-if="!d.items.length" class="none">这天没有订阅的剧更新</p>
          <div class="rows stagger">
            <article v-for="(r, n) in d.items" :key="r.key" class="row" :class="{ open: expanded === r.key }" :style="{ '--i': n }" data-card>
              <div class="rm" @click="expanded = expanded === r.key ? '' : r.key">
                <span class="time num" :class="{ est: r.est }">{{ r.est ? '~' : '' }}{{ r.time || '--:--' }}</span>
                <Poster class="ps" :url="r.poster" :provider="r.provider" :title="r.title" :title-size="8" loading="lazy" />
                <div class="info">
                  <b class="t">{{ r.title }}</b>
                  <span class="m"><span class="pf"><PlatformLogo :provider="r.provider" :size="15" />{{ pname(r.provider) }}</span><span class="kind">{{ r.sub?.kind === 'movie' ? '电影' : '剧集' }}</span></span>
                </div>
                <span class="ep">{{ r.episodes }}</span>
                <span class="stc">
                  <span class="tag" :class="statusOf(r).cls" tabindex="0">
                    <Icon v-if="statusOf(r).icon" :name="statusOf(r).icon" :size="13" /><i v-else class="pip" />{{ statusOf(r).text }}
                    <span v-if="r.est" class="tip" role="tooltip"><strong>预计时间，尚未确认</strong>来源：<b>{{ estSource(r) }}</b><br />到点后每 {{ store.subs?.intervalMinutes ?? 5 }} 分钟检查，确认后自动下载</span>
                  </span>
                </span>
                <span class="act" @click.stop>
                  <button v-if="r.status === 'new'" type="button" class="btn primary sm" @click="download(r)"><Icon name="download" :size="15" />下载</button>
                  <button v-else-if="r.status === 'downloaded'" type="button" class="btn sm" @click="go('downloads')"><Icon name="folder-open" :size="15" />打开</button>
                  <button type="button" class="btn ghost sm icon" :aria-label="expanded === r.key ? '收起' : '展开详情'" :aria-expanded="expanded === r.key" @click="expanded = expanded === r.key ? '' : r.key"><Icon name="more" :size="16" /></button>
                </span>
              </div>
              <Transition name="expand">
                <div v-if="expanded === r.key" class="collapse"><div>
                  <div class="xp">
                    <div><b>画质规则</b>{{ rulesText(r.sub) }}</div>
                    <div><b>检查时间</b>{{ r.sub ? windowText(r.sub.window, store.subs?.intervalMinutes) : '—' }}</div>
                    <div><b>进度</b>{{ progress(r.sub) }}</div>
                    <span class="grow" />
                    <button type="button" class="btn sm" @click="open(r)">详情</button>
                    <button type="button" class="btn sm" @click="editSub(r)">编辑订阅</button>
                    <button v-if="r.status !== 'downloaded'" type="button" class="btn primary sm" @click="download(r)"><Icon name="download" :size="15" />下载</button>
                  </div>
                </div></div>
              </Transition>
            </article>
          </div>
        </section>
      </div>

      <aside class="rr">
        <section class="card rc">
          <h3 class="card-h">下一个更新<small v-if="next">{{ nextWhen }}</small></h3>
          <template v-if="next">
            <div class="big num">{{ countdown }}</div>
            <button type="button" class="nx" @click="open(next)"><Poster class="ps" :url="next.poster" :provider="next.provider" :title="next.title" :title-size="8" /><span><b>{{ next.title }}</b><span class="m"><PlatformLogo :provider="next.provider" :size="14" />{{ pname(next.provider) }} · {{ next.episodes }}</span></span></button>
          </template>
          <p v-else class="muted small">未来一周没有待更新的剧</p>
        </section>
        <section class="card rc">
          <h3 class="card-h">今日概览<small>{{ todayItems.length }} 部</small></h3>
          <div class="stats">
            <div><b class="ok">{{ todayStats.done }}</b><small>已下载</small></div>
            <div><b class="acc">{{ todayStats.todo }}</b><small>待下载</small></div>
            <div><b>{{ todayStats.wait }}</b><small>待更新</small></div>
          </div>
          <button type="button" class="btn primary full" :disabled="!todayStats.todo" @click="downloadAllToday"><Icon name="download" :size="16" />一键下载 {{ todayStats.todo }} 集</button>
        </section>
        <section class="card rc">
          <h3 class="card-h">今日待更新<small>{{ todayPending.length }} 部</small></h3>
          <div v-for="i in todayPending" :key="i.key" class="li"><span>{{ i.est ? '~' : '' }}{{ i.time }} {{ i.title }}</span><span>{{ relTime(i) }}</span></div>
          <p v-if="!todayPending.length" class="muted small">今天的都更新完了</p>
        </section>
      </aside>
    </div>

    <!-- ===== 我的追剧 · 月历 ===== -->
    <div v-else-if="tab === 'mine'" class="month">
      <div class="wk"><span v-for="w in ['周一', '周二', '周三', '周四', '周五', '周六', '周日']" :key="w">{{ w }}</span></div>
      <div class="mg" :style="{ gridTemplateRows: `repeat(${monthCells.length / 7}, minmax(96px, 1fr))` }">
        <button v-for="c in monthCells" :key="c.key" type="button" class="mcell" :class="{ out: c.out, past: c.past && !c.today, today: c.today }" @click="openDay(c)">
          <span class="n"><span>{{ c.day }}</span><small v-if="c.items.length">{{ c.items.length }} 部</small></span>
          <span v-if="c.items.length" class="thumbs"><Poster v-for="i in c.items.slice(0, 4)" :key="i.key" class="th" :url="i.poster" :provider="i.provider" :title="i.title" :title-size="0" loading="lazy" /></span>
          <span v-if="c.items.length" class="l">{{ c.items.slice(0, 2).map((i) => i.title).join('、') }}{{ c.items.length > 2 ? ' 等' : '' }}</span>
        </button>
      </div>
    </div>

    <!-- ===== 发现新剧 ===== -->
    <section v-else class="disc">
      <div class="filters">
        <div class="fl"><b>平台</b><span class="on">芒果TV</span><span class="dis" title="该平台暂未提供排播接口">腾讯视频</span><span class="dis" title="该平台暂未提供排播接口">爱奇艺</span><span class="dis" title="该平台暂未提供排播接口">优酷</span></div>
        <div class="fl"><b>类型</b>
          <button type="button" :class="{ on: dType === 'all' }" @click="dType = 'all'">全部</button>
          <button v-for="t in discoverDays.types" :key="t" type="button" :class="{ on: dType === t }" @click="dType = t">{{ t }}</button>
          <label class="ou"><input v-model="onlyUnsub" type="checkbox" />只看未订阅</label>
        </div>
      </div>
      <template v-if="loading && !platform.length">
        <div class="grid"><span v-for="n in 12" :key="n" class="sk" style="aspect-ratio: 2/3" /></div>
      </template>
      <div v-for="d in discoverDays.days" :key="d.key">
        <h2 class="dh" :class="{ today: d.isToday }"><span>{{ d.title }}</span><small>{{ d.items.length }} 部</small><i class="line" /></h2>
        <div class="grid stagger">
          <div v-for="(i, n) in d.items" :key="i.id + n" class="mc" data-card :style="{ '--i': n }">
            <button type="button" class="pst lift" :aria-label="`打开《${i.title}》`" @click="open(i)">
              <Poster :url="i.poster" :provider="i.provider" :title="i.title" :title-size="14" loading="lazy" />
              <span v-if="i.time" class="bdg l">{{ i.time }}</span>
              <span v-if="subscriptionOf(i.provider, i.id)" class="bdg r ok">已订阅</span>
            </button>
            <b class="t" :title="i.title">{{ i.title }}</b>
            <span class="m"><span>{{ [kindOf(i), i.episodes].filter(Boolean).join(' · ') }}</span>
              <span v-if="subscriptionOf(i.provider, i.id)" class="subb done">已订阅</span>
              <button v-else type="button" class="subb" @click="subscribe(i)">+ 订阅</button></span>
          </div>
        </div>
      </div>
      <div v-if="!loading && !discoverDays.days.length" class="empty"><Icon name="tv" :size="32" />暂时没有排播数据<button type="button" class="btn sm" @click="load"><Icon name="refresh" :size="14" />重试</button></div>
    </section>
  </div>
</template>

<style scoped>
.cal { gap: 14px; }
.top { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.ttl { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
.ttl .sub { margin-top: 2px; }
.small { font-size: 12px; }
.pfw { position: relative; }
.menu { position: absolute; right: 0; top: 44px; z-index: 20; width: 180px; padding: 6px; display: flex; flex-direction: column; gap: 2px; box-shadow: var(--ui-shadow-float); background: var(--ui-glass-strong); backdrop-filter: blur(14px); }
.menu button { height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--ink-2); cursor: pointer; text-align: left; }
.menu button:hover { background: var(--paper-2); color: var(--ink); }
.menu button.on { color: var(--orange-text); }

.body { display: flex; gap: 20px; align-items: flex-start; }
.col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
/* 日期条（Hdhive CalendarDateRail） */
.rail { display: flex; gap: 8px; align-items: stretch; }
.arr { width: 34px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); display: grid; place-items: center; color: var(--ink-2); cursor: pointer; transition: border-color var(--ui-duration-fast), color var(--ui-duration-fast); }
.arr:hover { border-color: var(--line-2); color: var(--ink); }
.date { flex: 1; min-width: 0; min-height: 60px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); display: grid; place-content: center; text-align: center; gap: 3px; cursor: pointer; color: var(--ink);
  transition: background var(--ui-duration-base) var(--ui-ease-out), border-color var(--ui-duration-fast), box-shadow var(--ui-duration-base), transform var(--ui-duration-fast); }
.date:hover:not(.on) { border-color: var(--line-2); transform: translateY(-1px); }
.date .p { font-size: 13px; font-weight: 800; }
.date .s { font-size: 11px; font-weight: 650; color: var(--ink-2); white-space: nowrap; }
.date .dots { display: flex; gap: 3px; justify-content: center; height: 6px; }
.dt { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.dt.g { background: var(--ok); } .dt.x { background: var(--line-2); }
.date.on { background: var(--orange); border-color: var(--orange); color: var(--on-orange); box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%), 0 9px 24px rgb(var(--ui-accent-channel) / 19%); }
.date.on .s { color: inherit; opacity: .82; }
.date.on .dt { background: var(--on-orange) !important; opacity: .7; }
.date.on .dt.x { opacity: .3; }
.date.none:not(.on) { background: color-mix(in srgb, var(--card) 50%, transparent); }
.date.none:not(.on) .s { color: var(--ink-3); }

.fold-w { display: flex; flex-direction: column; }
.fold { border: 1px dashed var(--line-2); border-radius: var(--ui-radius-md); padding: 10px 14px; color: var(--ink-2); display: flex; justify-content: space-between; align-items: center; font-weight: 650; font-size: 13px; background: transparent; cursor: pointer; text-align: left; }
.fold b { color: var(--orange-text); font-weight: 800; }
.fold .muted { display: inline-flex; gap: 4px; align-items: center; }
.pastd { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 8px 14px 0; font-size: 12.5px; color: var(--ink-2); }
.pd { font-weight: 800; color: var(--ink); width: 96px; }
.pi { display: inline-flex; gap: 5px; align-items: center; }
.pi em { font-style: normal; color: var(--ink-3); }
.tg { font-style: normal; font-size: 11px; font-weight: 750; color: var(--ink-3); }
.tg.ok { color: var(--ok); } .tg.new { color: var(--orange-2); }

.day { scroll-margin-top: 4px; }
.dh { display: flex; align-items: baseline; gap: 10px; padding: 10px 2px 8px; font-size: 15px; font-weight: 850; position: sticky; top: -22px; z-index: 3;
  background: linear-gradient(var(--paper) 75%, transparent); }
.dh small { color: var(--ink-2); font-size: 12px; font-weight: 600; }
.dh.today span { color: var(--orange-text); }
.dh .line { flex: 1; height: 1px; background: var(--line); align-self: center; }
.none { color: var(--ink-3); font-size: 12px; padding: 0 2px 6px; }
.rows { display: flex; flex-direction: column; gap: 8px; }
.row { background: var(--card); border: 1px solid var(--line); border-radius: 14px; position: relative; box-shadow: var(--ui-inset);
  transition: border-color var(--ui-duration-base) var(--ui-ease-out), background var(--ui-duration-base), box-shadow var(--ui-duration-base), transform var(--ui-duration-base) var(--ui-ease-out); }
.row:hover, .row.open { border-color: color-mix(in srgb, var(--orange) 70%, var(--line)); background: var(--raised); box-shadow: var(--ui-shadow-surface); }
.row:hover { transform: translateY(-1px); }
.row:hover, .row:focus-within { z-index: 5; }
.rm { display: flex; align-items: center; gap: 14px; padding: 10px 14px; cursor: pointer; }
.time { width: 56px; font-size: 16px; font-weight: 850; flex-shrink: 0; }
.time.est { color: var(--ink-3); }
.ps { width: 36px; height: 54px; padding: 3px; border-radius: 4px; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.info .t { font-size: 14.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m { color: var(--ink-2); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.pf { display: inline-flex; align-items: center; gap: 5px; }
.kind { font-size: 10.5px; font-weight: 750; padding: 1px 6px; border-radius: 4px; background: var(--paper-2); color: var(--ink-2); border: 1px solid var(--line); }
.ep { width: 110px; font-weight: 750; font-size: 13px; flex-shrink: 0; }
.stc { width: 170px; flex-shrink: 0; }
.tag { --t: var(--ink-2); position: relative; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 750; white-space: nowrap; outline: none;
  border: 1px solid color-mix(in srgb, var(--t) 32%, var(--line)); color: var(--t); background: color-mix(in srgb, var(--t) 11%, var(--card)); box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%); }
.tag.ok { --t: var(--ok); } .tag.new { --t: var(--orange-2); } .tag.err { --t: var(--err); } .tag.wait { --t: var(--ink-2); }
.tag.est { --t: var(--ink-3); border-style: dashed; background: transparent; cursor: help; }
.pip { width: 9px; height: 9px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.tip { position: absolute; left: -40px; top: 34px; width: 272px; background: var(--ui-glass-strong); border: 1px solid var(--ui-glass-border); border-radius: 12px; padding: 11px 13px; font-size: 12px; line-height: 1.7; color: var(--ink-2); z-index: 6; box-shadow: var(--ui-shadow-float); white-space: normal; font-weight: 500;
  opacity: 0; transform: translateY(-4px); pointer-events: none; transition: opacity var(--ui-duration-fast), transform var(--ui-duration-fast) var(--ui-ease-out); backdrop-filter: blur(14px); }
.tip b { color: var(--orange-text); font-weight: 700; }
.tip strong { color: var(--ink); display: block; font-size: 12.5px; margin-bottom: 2px; }
.tag:hover .tip, .tag:focus-visible .tip { opacity: 1; transform: none; }
.act { width: 132px; display: flex; justify-content: flex-end; gap: 6px; align-items: center; flex-shrink: 0; }
.xp { display: flex; gap: 22px; align-items: center; padding: 12px 14px 12px 70px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--raised) 70%, var(--card)); border-radius: 0 0 14px 14px; font-size: 12px; color: var(--ink-2); flex-wrap: wrap; }
.xp > div { white-space: nowrap; }
.xp b { display: block; color: var(--ink); font-size: 12.5px; font-weight: 750; margin-bottom: 2px; }
.grow { flex: 1; }

.rr { width: 262px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
.rc { padding: 15px; display: flex; flex-direction: column; gap: 10px; }
.big { font-size: 30px; font-weight: 900; color: var(--orange-2); letter-spacing: .01em; }
.nx { display: flex; gap: 10px; align-items: center; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; color: inherit; }
.nx b { display: block; font-size: 13px; font-weight: 800; }
.nx .m { margin-top: 4px; gap: 5px; }
.stats { display: flex; gap: 6px; }
.stats div { flex: 1; border: 1px solid var(--line); background: var(--raised); border-radius: var(--ui-radius-md); padding: 8px 4px; text-align: center; }
.stats b { display: block; font-size: 19px; font-weight: 900; }
.stats b.ok { color: var(--ok); } .stats b.acc { color: var(--orange-2); }
.stats small { color: var(--ink-2); font-size: 11px; font-weight: 600; }
.full { width: 100%; }
.li { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0 0; border-top: 1px solid var(--line); font-size: 12px; font-weight: 700; }
.li span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.li span:last-child { color: var(--ink-2); font-weight: 500; flex-shrink: 0; }

/* 月历 */
.month { display: flex; flex-direction: column; flex: 1; }
.wk { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; color: var(--ink-3); font-size: 12px; font-weight: 750; padding: 0 4px 8px; }
.mg { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.mcell { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 7px 8px; display: flex; flex-direction: column; gap: 5px; overflow: hidden; min-height: 0; text-align: left; cursor: pointer; color: var(--ink);
  transition: border-color var(--ui-duration-fast), transform var(--ui-duration-base) var(--ui-ease-out), box-shadow var(--ui-duration-base); }
.mcell:hover { border-color: var(--line-2); transform: translateY(-2px); box-shadow: var(--ui-shadow-surface); }
.mcell .n { display: flex; justify-content: space-between; font-weight: 850; font-size: 13px; }
.mcell .n small { color: var(--orange-text); font-size: 11px; font-weight: 750; }
.mcell.out { opacity: .3; }
.mcell.past { background: color-mix(in srgb, var(--card) 50%, var(--paper)); }
.mcell.past .thumbs { opacity: .55; }
.mcell.today { border-color: var(--orange); box-shadow: 0 0 0 1px var(--orange), 0 9px 24px rgb(var(--ui-accent-channel) / 16%); }
.mcell.today .n span { color: var(--orange-text); }
.thumbs { display: flex; gap: 4px; }
.th { width: 24px; height: 36px; padding: 0; border-radius: 3px; box-shadow: none; }
.mcell .l { font-size: 11px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 发现 / 空状态卡片 */
.filters { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
.fl { display: flex; gap: 16px; align-items: center; color: var(--ink-2); font-weight: 700; font-size: 12.5px; padding: 5px 0; }
.fl b { color: var(--ink-3); font-weight: 700; width: 34px; }
.fl button { border: 0; background: none; padding: 0; color: inherit; font-weight: 700; cursor: pointer; }
.fl button:hover { color: var(--ink); }
.fl .on { color: var(--orange-text); }
.fl .dis { color: var(--ink-3); cursor: not-allowed; }
.ou { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.ou input { accent-color: var(--orange); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 16px 14px; }
.mc { min-width: 0; display: flex; flex-direction: column; }
.pst { position: relative; padding: 0; border: 0; background: none; cursor: pointer; border-radius: var(--ui-radius-sm); }
.pst :deep(.poster) { width: 100%; aspect-ratio: 2 / 3; border-radius: 4px; font-size: 14px; }
.pst:hover :deep(.poster) { border-color: color-mix(in srgb, var(--orange) 60%, var(--line)); box-shadow: var(--ui-shadow-float); }
.bdg { position: absolute; top: 7px; z-index: 2; padding: 4px 7px; border-radius: 3px; font-size: 10px; font-weight: 800; line-height: 1; border: 1px solid rgb(255 255 255 / 12%); background: rgb(4 5 10 / 88%); color: #fff; }
.bdg.l { left: 7px; } .bdg.r { right: 7px; }
.bdg.ok { background: var(--ok); color: #06130e; border-color: transparent; }
.mc .t { font-weight: 800; font-size: 13px; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc .m { gap: 6px; justify-content: space-between; margin-top: 4px; font-size: 11.5px; }
.mc .m > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.subb { flex: none; white-space: nowrap; height: 24px; padding: 0 9px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--orange) 60%, var(--line)); color: var(--orange-text); font-weight: 800; font-size: 11.5px; display: inline-flex; align-items: center; background: rgb(var(--ui-accent-channel) / 10%); cursor: pointer; transition: background var(--ui-duration-fast), box-shadow var(--ui-duration-fast); }
button.subb:hover { background: var(--orange); color: var(--on-orange); box-shadow: var(--ui-glow); }
.subb.done { border-color: var(--line); color: var(--ink-3); background: transparent; }
.emp { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 40px 0 30px; }
.emp h3 { font-size: 19px; font-weight: 900; margin-top: 8px; }
.emp .sub { max-width: 330px; line-height: 1.7; }
.emp-a { display: flex; gap: 10px; margin: 6px 0 22px; }
.sugg { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.sugg .mc { width: 132px; text-align: left; }
@media (max-width: 1180px) { .rr { display: none; } .ep { width: 84px; } .stc { width: 150px; } }
</style>
