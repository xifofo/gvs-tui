<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { CheckWindow, Subscription, SubscriptionPatch } from '@shared/api'
import { formatRules, parseRules } from '@shared/rule-groups'
import { windowText } from '@shared/subscription'
import Icon from './Icon.vue'
import AccountPicker from './AccountPicker.vue'
import { accountsOf } from '../store'

const props = defineProps<{ sub: Pick<Subscription, 'title' | 'rules' | 'autoDownload' | 'upgrade' | 'window' | 'provider' | 'accountId'>; globalMinutes: number; saving?: boolean }>()
const emit = defineEmits<{ save: [patch: SubscriptionPatch]; cancel: [] }>()

const PRESETS = [
  { label: '最高画质 + 杜比', rules: '4K & Dolby > 4K > 1080P & Dolby > 1080P > any' },
  { label: '1080P 优先', rules: '1080P & HEVC > 1080P > 720P > any' },
  { label: '省空间', rules: '720P > 540P > any' },
  { label: '杜比视界 / HDR', rules: 'DV > HDR > 4K > any' },
]
const DAYS = ['一', '二', '三', '四', '五', '六', '日'].map((n, i) => ({ n, d: (i + 1) % 7 }))

const w = props.sub.window
const form = reactive({
  rules: props.sub.rules,
  accountId: props.sub.accountId ?? '',
  autoDownload: props.sub.autoDownload,
  upgrade: props.sub.upgrade,
  kind: (w?.kind ?? 'global') as 'global' | CheckWindow['kind'],
  minutes: w && 'minutes' in w ? w.minutes : props.globalMinutes,
  days: w?.kind === 'weekly' ? [...w.days] : [1, 2, 3, 4, 5, 6, 0],
  start: w?.kind === 'weekly' ? w.start : '19:00',
  end: w?.kind === 'weekly' ? w.end : '23:00',
  times: w?.kind === 'episodes' ? w.times.map(toLocal).join('\n') : '',
  grace: w?.kind === 'episodes' ? w.graceMinutes : 120,
})
function toLocal(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const parsed = computed(() => parseRules(form.rules))
const times = computed(() => form.times.split(/\n|,|，/).map((s) => s.trim()).filter(Boolean).map((s) => ({ s, t: new Date(s.replace(' ', 'T')).getTime() })))
const badTimes = computed(() => times.value.filter((x) => !Number.isFinite(x.t)).map((x) => x.s))
const win = computed<CheckWindow | null>(() => {
  const minutes = Math.max(1, Number(form.minutes) || props.globalMinutes)
  if (form.kind === 'interval') return { kind: 'interval', minutes }
  if (form.kind === 'weekly') return { kind: 'weekly', days: [...form.days], start: form.start, end: form.end, minutes }
  if (form.kind === 'episodes') return { kind: 'episodes', times: times.value.filter((x) => Number.isFinite(x.t)).map((x) => x.t), graceMinutes: Math.max(10, Number(form.grace) || 120), minutes }
  return null
})
const invalid = computed(() => !!parsed.value.errors.length || !parsed.value.tiers.length || (form.kind === 'weekly' && !form.days.length) || (form.kind === 'episodes' && (!!badTimes.value.length || !times.value.length)))
function toggleDay(d: number) {
  form.days = form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d]
}
function submit() {
  if (invalid.value) return
  emit('save', { accountId: form.accountId || undefined, rules: formatRules(parsed.value), autoDownload: form.autoDownload, upgrade: form.upgrade, window: win.value })
}
</script>

<template>
  <form class="ed" @submit.prevent="submit">
    <section class="blk">
      <div class="bh"><b>画质 / 音轨规则组</b><span class="muted small">用 &gt; 分档（越前越好），&amp; 表示同时满足，! 取反</span></div>
      <input v-model="form.rules" class="input mono" spellcheck="false" aria-label="规则组" placeholder="4K & Dolby > 1080P & AAC > any" />
      <div class="presets">
        <button v-for="p in PRESETS" :key="p.label" type="button" class="pill" :class="{ on: formatRules(parseRules(p.rules)) === formatRules(parsed) }" @click="form.rules = p.rules">{{ p.label }}</button>
      </div>
      <ol v-if="parsed.tiers.length" class="tiers">
        <li v-for="(t, i) in parsed.tiers" :key="i"><span class="mono n">{{ i + 1 }}</span><span v-for="x in t" :key="x.key" class="chip mono" :class="{ err: x.neg }">{{ x.neg ? '非 ' : '' }}{{ x.key.toUpperCase() }}</span></li>
      </ol>
      <p v-if="parsed.errors.length" class="error-box">{{ parsed.errors.join('；') }}。可用：4K 2160P 1080P 720P HEVC H264 AV1 HDR DV 60FPS Dolby Atmos DTS AAC any</p>
      <label class="toggle"><span>有新集时自动按规则下载<small class="muted">关闭后只通知</small></span><input v-model="form.autoDownload" type="checkbox" /><span class="track"><span class="knob" /></span></label>
      <label class="toggle"><span>洗版<small class="muted">已下载的不是第 1 档时，出现更好的版本自动重下</small></span><input v-model="form.upgrade" type="checkbox" /><span class="track"><span class="knob" /></span></label>
    </section>

    <section class="blk">
      <div class="bh"><b>检查时间</b><span class="muted small">{{ windowText(win, globalMinutes) }}</span></div>
      <div class="seg">
        <button type="button" :class="{ on: form.kind === 'global' }" @click="form.kind = 'global'">跟随全局</button>
        <button type="button" :class="{ on: form.kind === 'interval' }" @click="form.kind = 'interval'">固定间隔</button>
        <button type="button" :class="{ on: form.kind === 'weekly' }" @click="form.kind = 'weekly'">每周播出</button>
        <button type="button" :class="{ on: form.kind === 'episodes' }" @click="form.kind = 'episodes'">按集时间</button>
      </div>
      <div v-if="form.kind === 'weekly'" class="row">
        <div class="days" role="group" aria-label="播出日">
          <button v-for="x in DAYS" :key="x.d" type="button" class="pill" :class="{ on: form.days.includes(x.d) }" @click="toggleDay(x.d)">周{{ x.n }}</button>
        </div>
        <label class="field">从<input v-model="form.start" type="time" class="input mono" /></label>
        <label class="field">到<input v-model="form.end" type="time" class="input mono" /></label>
      </div>
      <label v-if="form.kind === 'episodes'" class="field">每集预计上线时间（每行一个，例如 2026-10-14 20:00）
        <textarea v-model="form.times" class="input mono ta" rows="4" />
        <span v-if="badTimes.length" class="error-box">无法识别：{{ badTimes.join('、') }}</span>
      </label>
      <div v-if="form.kind !== 'global'" class="row">
        <label class="field">{{ form.kind === 'interval' ? '每隔（分钟）' : '窗口内每隔（分钟）' }}<input v-model.number="form.minutes" type="number" min="1" max="1440" class="input mono" /></label>
        <label v-if="form.kind === 'episodes'" class="field">上线后持续检查（分钟）<input v-model.number="form.grace" type="number" min="10" class="input mono" /></label>
      </div>
    </section>

    <section v-if="accountsOf(sub.provider).length > 1" class="blk">
      <div class="bh"><b>账号</b><span class="muted small">检查和下载用这个账号；会员受限时自动换号</span></div>
      <AccountPicker v-model="form.accountId" :provider="sub.provider" label="订阅账号" />
    </section>

    <div class="acts">
      <button type="button" class="btn" @click="emit('cancel')">取消</button>
      <button type="submit" class="btn primary" :disabled="invalid || saving"><Icon name="check" :size="15" />保存</button>
    </div>
  </form>
</template>

<style scoped>
.ed { display: flex; flex-direction: column; gap: 16px; }
.blk { display: flex; flex-direction: column; gap: 10px; }
.bh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.small { font-size: 12px; }
.presets, .days { display: flex; flex-wrap: wrap; gap: 6px; }
.tiers { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.tiers li { display: flex; gap: 6px; align-items: center; }
.tiers .n { width: 20px; height: 20px; border-radius: 50%; background: var(--ink); color: var(--paper); font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.toggle span:first-child { display: flex; flex-direction: column; gap: 2px; }
.toggle small { font-size: 12px; }
.row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.row .field { width: 160px; }
.ta { height: auto; padding: 8px 12px; resize: vertical; }
.acts { display: flex; justify-content: flex-end; gap: 10px; }
</style>
