<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PROVIDER_NAME, type Provider, type Subscription, type SubscriptionPatch } from '@shared/api'
import { SUB_STATE_LABEL, windowText } from '@shared/subscription'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SubscriptionEditor from '../components/SubscriptionEditor.vue'
import { ago, errText, gvs, openDetail, store, toast } from '../store'

const view = computed(() => store.subs)
const subs = computed(() => view.value?.subs ?? [])
type F = 'all' | 'new' | 'failed' | 'paused'
const filter = ref<F>('all')
const failed = (s: Subscription) => !!s.lastCheck && !s.lastCheck.ok
const shown = computed(() => subs.value.filter((s) => filter.value === 'all' || (filter.value === 'new' ? s.newCount > 0 : filter.value === 'failed' ? failed(s) : s.paused)))
const counts = computed(() => ({
  all: subs.value.length,
  new: subs.value.filter((s) => s.newCount > 0).length,
  failed: subs.value.filter(failed).length,
  paused: subs.value.filter((s) => s.paused).length,
}))
const weekDownloads = computed(() => subs.value.reduce((n, s) => n + s.episodes.filter((e) => e.downloaded && Date.now() - e.downloaded.at < 7 * 86400e3).length, 0))
const editing = ref<Subscription | null>(null)
const removing = ref<Subscription | null>(null)
const saving = ref(false)
const now = ref(Date.now())
let t: ReturnType<typeof setInterval> | undefined
onMounted(() => { t = setInterval(() => (now.value = Date.now()), 1000) })
onUnmounted(() => clearInterval(t))

async function act(fn: () => Promise<unknown>, ok?: string) {
  try { await fn(); if (ok) toast(ok, 'ok') } catch (e) { toast(errText(e), 'err') }
}
const checkAll = () => act(() => gvs('checkSubscriptions'), '检查完成')
const togglePause = () => act(async () => { store.subs = await gvs('setSubscriptionsPaused', !view.value?.paused) })
const setInterval_ = (m: number) => act(async () => { store.subs = await gvs('setSubscriptionInterval', m) })
async function save(patch: SubscriptionPatch) {
  if (!editing.value) return
  saving.value = true
  await act(() => gvs('updateSubscription', editing.value!.id, patch), '已保存')
  saving.value = false
  editing.value = null
}
function open(s: Subscription) {
  if (s.newCount) void gvs('markSubscriptionsSeen', s.id)
  void openDetail(s.provider as Provider, s.showId, { title: s.title, poster: s.poster, mediaKind: s.kind })
}
const latest = (s: Subscription) => {
  const nums = s.episodes.map((e) => e.number).filter((n) => n > 0)
  if (!nums.length) return s.state === 'N' ? '等待首次检查' : '—'
  const max = Math.max(...nums)
  return `第 ${max} 集${s.total && max >= s.total ? '（全）' : s.total ? ` / 共 ${s.total} 集` : ''}`
}
const downloadedLabel = (s: Subscription) => [...s.episodes].reverse().find((e) => e.downloaded)?.downloaded?.label ?? ''
function countdown(s: Subscription): { text: string; pct: number } {
  if (s.paused || view.value?.paused) return { text: '已暂停', pct: 0 }
  if (!Number.isFinite(s.nextCheckAt) || !s.nextCheckAt) return { text: '—', pct: 0 }
  const left = Math.max(0, s.nextCheckAt - now.value)
  const span = Math.max(1, s.nextCheckAt - (s.lastCheck?.at ?? s.createdAt))
  if (left > 86400e3) { const d = new Date(s.nextCheckAt); return { text: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, pct: 0 } }
  const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3), sec = Math.floor((left % 60e3) / 1000)
  return { text: left < 1000 ? '即将检查' : h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`, pct: Math.round(100 - (left / span) * 100) }
}
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const stateTone = (s: Subscription) => (failed(s) ? 'err' : s.newCount ? 'warn' : s.state === 'R' ? 'ok' : '')
const stateText = (s: Subscription) => (failed(s) ? '检查失败' : s.newCount ? `有更新 · ${s.newCount} 集` : SUB_STATE_LABEL[s.state])
</script>

<template>
  <div class="page">
    <div class="h1-row top">
      <h1 class="h1">订阅</h1>
      <span class="stat"><b class="mono">{{ counts.all }}</b> 订阅中</span>
      <span class="stat o"><b class="mono">{{ counts.new }}</b> 有更新</span>
      <span class="stat e"><b class="mono">{{ counts.failed }}</b> 需处理</span>
      <span class="stat g"><b class="mono">{{ weekDownloads }}</b> 本周自动下载</span>
      <div class="tb">
        <button type="button" class="btn sm" :disabled="view?.running || !subs.length" @click="checkAll"><Icon name="refresh" :size="15" />{{ view?.running ? '检查中…' : '立即全部检查' }}</button>
        <button type="button" class="btn sm" :class="{ outline: view?.paused }" @click="togglePause"><Icon :name="view?.paused ? 'play' : 'pause'" :size="15" />{{ view?.paused ? '恢复检查' : '暂停检查' }}</button>
      </div>
    </div>

    <div v-if="view?.paused" class="warn-box">订阅检查已暂停：不会自动查新集，手动「立即检查」仍然可用。也可以在托盘图标右键菜单里恢复。</div>

    <div class="bar">
      <button v-for="f in (['all', 'new', 'failed', 'paused'] as F[])" :key="f" type="button" class="pill" :class="{ on: filter === f }" @click="filter = f">
        {{ { all: '全部', new: '有更新', failed: '失败', paused: '已暂停' }[f] }}<span class="count">{{ counts[f] }}</span>
      </button>
      <span class="muted small gl">全局检查间隔
        <select class="sel mono" :value="view?.intervalMinutes ?? 5" aria-label="全局检查间隔" @change="setInterval_(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="m in [5, 10, 15, 30, 60, 180]" :key="m" :value="m">{{ m }} 分钟</option>
        </select>
        · ±20% 随机抖动 · 关闭窗口后在托盘继续运行</span>
    </div>

    <div v-if="!subs.length" class="card empty-s">
      <Icon name="star" :size="34" />
      <b>还没有订阅</b>
      <p class="muted">在剧集详情页点「订阅」，GVS 会按播出时间自动检查新集，按画质规则组挑最好的版本下载。</p>
      <button type="button" class="btn primary" @click="store.paletteOpen = true"><Icon name="search" :size="15" />搜索一部在追的剧</button>
    </div>

    <div v-for="s in shown" :key="s.id" class="card row" :class="{ hot: s.newCount > 0, focus: store.subFocus === s.id, off: s.paused }">
      <button type="button" class="pst" :aria-label="`打开 ${s.title}`" @click="open(s)"><Poster class="pp" :url="s.poster" :provider="s.provider" :title="s.title" :title-size="10" /></button>
      <div class="c1">
        <button type="button" class="t" @click="open(s)"><PlatformLogo :provider="s.provider" :size="16" /><b>《{{ s.title }}》</b></button>
        <div class="chips">
          <span class="chip" :class="stateTone(s)"><span class="dot" />{{ stateText(s) }}</span>
          <span class="chip mono" :title="s.rules">{{ s.rules.length > 26 ? s.rules.slice(0, 26) + '…' : s.rules }}</span>
          <span v-if="s.autoDownload" class="chip">自动下载</span><span v-else class="chip">仅通知</span>
          <span v-if="s.upgrade" class="chip dv">洗版</span>
        </div>
      </div>
      <div class="c2"><span class="muted small">最新一集</span><span>{{ latest(s) }}</span><span class="muted small">{{ windowText(s.window, view?.intervalMinutes) }}</span></div>
      <div class="c3">
        <span class="muted small">上次检查</span>
        <span class="mono">{{ s.lastCheck ? hhmm(s.lastCheck.at) : '—' }}</span>
        <span class="small clamp" :class="s.lastCheck && !s.lastCheck.ok ? 'err' : 'muted'" :title="s.lastCheck?.message">{{ s.lastCheck ? `${s.lastCheck.ok ? '成功' : '失败'} · ${s.lastCheck.message}` : '' }}</span>
        <span v-if="downloadedLabel(s)" class="muted small">已下载 {{ downloadedLabel(s) }}</span>
      </div>
      <div class="c4">
        <span class="muted small">下次检查</span>
        <b class="mono">{{ countdown(s).text }}</b>
        <div class="progress"><div :style="{ width: countdown(s).pct + '%' }" /></div>
      </div>
      <label class="toggle" :title="s.paused ? '恢复这个订阅' : '暂停这个订阅'">
        <input type="checkbox" :checked="!s.paused" :aria-label="`启用订阅 ${s.title}`" @change="act(() => gvs('updateSubscription', s.id, { paused: !s.paused }))" />
        <span class="track"><span class="knob" /></span>
      </label>
      <div class="acts">
        <button type="button" class="btn sm icon" :disabled="view?.running" title="立即检查" aria-label="立即检查" @click="act(() => gvs('checkSubscriptions', s.id))"><Icon name="refresh" :size="14" /></button>
        <button type="button" class="btn sm icon" title="编辑规则与时间" aria-label="编辑" @click="editing = s"><Icon name="gear" :size="14" /></button>
        <button type="button" class="btn sm icon" title="取消订阅" aria-label="取消订阅" @click="removing = s"><Icon name="trash" :size="14" /></button>
      </div>
    </div>

    <div v-if="editing" class="drawer-bg" @click.self="editing = null">
      <aside class="drawer card" role="dialog" aria-label="编辑订阅">
        <div class="dh"><PlatformLogo :provider="editing.provider" :size="20" /><b>《{{ editing.title }}》</b><span class="muted small">{{ PROVIDER_NAME[editing.provider as Provider] }}</span></div>
        <SubscriptionEditor :sub="editing" :global-minutes="view?.intervalMinutes ?? 5" :saving="saving" @save="save" @cancel="editing = null" />
        <p class="muted small">订阅于 {{ ago(editing.createdAt) }} · 已记录 {{ editing.episodes.length }} 集</p>
      </aside>
    </div>
    <ConfirmDialog v-if="removing" title="取消订阅" :message="`不再检查《${removing.title}》的新集？已下载的文件不会删除。`" confirm-text="取消订阅" danger
      @confirm="act(() => gvs('unsubscribe', removing!.id)); removing = null" @cancel="removing = null" />
  </div>
</template>

<style scoped>
.top { align-items: center; }
.stat { font-size: 13px; color: var(--ink-3); }
.stat b { font-size: 18px; color: var(--ink); margin-right: 4px; }
.stat.o b { color: var(--orange-text); } .stat.e b { color: var(--err); } .stat.g b { color: var(--ok); }
.tb { margin-left: auto; display: flex; gap: 8px; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.gl { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.sel { height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); padding: 0 6px; font-size: 12px; }
.small { font-size: 12px; }
.empty-s { padding: 44px 32px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; border-style: dashed; }
.empty-s b { font-size: 18px; }
.empty-s p { max-width: 520px; line-height: 1.7; }
.row { display: grid; grid-template-columns: 56px minmax(0, 2.2fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 110px 44px auto; gap: 16px; align-items: center; padding: 12px 16px; }
.row.hot { border-color: var(--orange); box-shadow: var(--shadow-orange); }
.row.focus { outline: 2px solid var(--orange); }
.row.off { opacity: .66; }
.pst { border: 0; padding: 0; background: none; cursor: pointer; }
.pp { width: 56px; height: 78px; padding: 4px; }
.c1, .c2, .c3, .c4 { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: 13px; }
.t { border: 0; background: none; padding: 0; display: flex; gap: 6px; align-items: center; cursor: pointer; font-size: 15px; text-align: left; }
.t:hover b { text-decoration: underline; }
.chip .dot { width: 7px; height: 7px; margin-right: 4px; background: currentColor; }
.clamp { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.err { color: var(--err); }
.c4 .progress { height: 4px; flex-grow: 0; }
.acts { display: flex; gap: 6px; }
.drawer-bg { position: fixed; inset: 0; background: var(--ui-overlay); backdrop-filter: blur(6px); z-index: 40; display: flex; justify-content: flex-end; }
.drawer { width: min(560px, 92vw); height: 100%; border-radius: 0; padding: 20px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.dh { display: flex; align-items: center; gap: 8px; font-size: 16px; }
</style>
