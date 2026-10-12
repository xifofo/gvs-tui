<script setup lang="ts">
import { computed, ref } from 'vue'
import { PROVIDER_NAME } from '@shared/api'
import { needsAttention } from '@shared/provider-registry'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import { go, gvs, prefs, runSearch, savePrefs, shownProviders, store, toast, errText } from '../store'

const text = ref('')
const recent = computed(() => prefs().recentSearches.slice(0, 10))
const visible = computed(() => new Set<string>(shownProviders()))
const accounts = computed(() => (store.state?.accounts ?? []).filter((a) => visible.value.has(a.provider)))
const attention = computed(() => accounts.value.filter(needsAttention))
const ready = computed(() => accounts.value.filter((a) => a.tone === 'ok').length)
const jobs = computed(() => {
  const order = { running: 0, queued: 1, paused: 2, failed: 3, done: 4 } as const
  return store.jobs.filter((j) => j.state !== 'done').slice().sort((a, b) => order[a.state] - order[b.state] || b.createdAt - a.createdAt).slice(0, 4)
})
const doneToday = computed(() => store.jobs.filter((j) => j.state === 'done' && Date.now() - j.finishedAt < 86400e3).length)
const isEmpty = computed(() => !store.jobs.length && !recent.value.length)
const hello = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'
})
const stateText: Record<string, string> = { running: '下载中', queued: '排队中', paused: '已暂停', failed: '失败' }
async function act(fn: () => Promise<unknown>) {
  try { await fn() } catch (e) { toast(errText(e), 'err') }
}
function login(p: string) {
  go('accounts')
  store.accountDrawer = p as never
}
const clearRecent = () => void savePrefs({ recentSearches: [] })
</script>

<template>
  <div class="page">
    <template v-if="isEmpty">
      <div class="empty-home">
        <div class="logo">G</div>
        <h1 class="h1">准备好了，开始找第一部剧吧</h1>
        <p class="dim">已连接网关 · 已登录 {{ ready }} / {{ accounts.length }} 个平台 · 下载到 <span class="mono">{{ store.state?.settings.outDir }}</span></p>
        <form class="big" role="search" @submit.prevent="runSearch(text)">
          <Icon name="search" :size="20" />
          <input v-model="text" placeholder="输入剧名，一次搜遍已启用的平台；也可以粘贴播放页链接" autocomplete="off" aria-label="搜索剧名或粘贴链接" />
          <button type="submit" class="btn primary" :disabled="!text.trim()">搜索</button>
        </form>
        <div class="tips">
          <button type="button" class="card tip" @click="store.paletteOpen = true"><Icon name="link" :size="20" /><b>粘贴链接直接下载</b><span class="muted">支持各平台播放页链接</span></button>
          <button type="button" class="card tip" @click="go('discover')"><Icon name="compass" :size="20" /><b>按平台浏览</b><span class="muted">看看各平台正在热播什么</span></button>
          <button type="button" class="card tip" @click="go('accounts')"><Icon name="user" :size="20" /><b>{{ attention.length ? `${attention.length} 个平台需要登录` : '管理平台账号' }}</b><span class="muted">登录后可下载会员画质</span></button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="h1-row">
        <h1 class="h1">{{ hello }}</h1>
        <span class="muted">{{ jobs.filter((j) => j.state === 'running').length }} 个下载进行中 · 今天完成 {{ doneToday }} 个</span>
        <button type="button" class="btn sm browse" @click="go('discover')"><Icon name="compass" :size="15" />按平台浏览</button>
      </div>

      <div class="grid">
        <div class="col">
          <section class="card box">
            <div class="bh"><h2 class="h2s">继续下载</h2><button type="button" class="linkish" @click="go('downloads')">全部下载 ›</button></div>
            <div v-if="!jobs.length" class="muted small pad">没有未完成的下载。</div>
            <div v-for="j in jobs" :key="j.id" class="job">
              <Poster class="jp" :url="j.poster" :provider="j.provider" :title="j.groupTitle" :title-size="10" />
              <div class="jm">
                <div class="jt"><b class="clamp2">{{ j.groupTitle }} {{ j.label }}</b><span class="muted small mono">{{ stateText[j.state] }}<template v-if="j.state === 'running'"> · {{ j.pct }}%</template></span></div>
                <span class="muted small">{{ j.quality }}</span>
                <div class="progress" :class="{ fail: j.state === 'failed' }"><div :style="{ width: j.pct + '%' }" /></div>
              </div>
              <button v-if="j.state === 'running' || j.state === 'queued'" type="button" class="btn sm icon" :disabled="j.busy" aria-label="暂停" @click="act(() => gvs('pauseJob', j.id))"><Icon name="pause" :size="14" /></button>
              <button v-else-if="j.state === 'paused'" type="button" class="btn sm icon" :disabled="j.busy" aria-label="继续" @click="act(() => gvs('resumeJob', j.id))"><Icon name="play" :size="14" /></button>
              <button v-else-if="j.state === 'failed'" type="button" class="btn sm icon" aria-label="重试" @click="act(() => gvs('retryJob', j.id))"><Icon name="retry" :size="14" /></button>
            </div>
          </section>
          <section class="card box soon">
            <div class="bh"><h2 class="h2s">今日更新</h2><button type="button" class="linkish" @click="go('calendar')">追剧日历 ›</button></div>
            <p class="muted small">订阅在追的剧后，这里会显示今天更新的集数和下载状态。</p>
          </section>
        </div>
        <div class="col">
          <section class="card box">
            <div class="bh"><h2 class="h2s">最近搜索</h2><button v-if="recent.length" type="button" class="linkish" @click="clearRecent">清空</button></div>
            <div class="chips">
              <button v-for="r in recent" :key="r" type="button" class="pill" @click="runSearch(r)">{{ r }}</button>
              <span v-if="!recent.length" class="muted small">还没有搜索过。</span>
            </div>
          </section>
          <section class="card box">
            <div class="bh"><h2 class="h2s">需要处理</h2><span class="muted small">{{ ready }} / {{ accounts.length }} 已登录</span></div>
            <div v-if="!attention.length" class="muted small ok-line"><Icon name="check" :size="15" />所有平台状态正常</div>
            <div v-for="a in attention" :key="a.provider" class="att">
              <PlatformLogo :provider="a.provider" :size="24" />
              <div class="am"><b>{{ PROVIDER_NAME[a.provider] }} · {{ a.short }}</b><span class="muted small clamp2">{{ a.summary }}</span></div>
              <button type="button" class="btn sm" :class="{ outline: a.tone === 'err' || a.tone === 'warn' }" @click="login(a.provider)">去处理</button>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty-home { margin: auto; width: min(760px, 100%); display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; padding: 40px 0; }
.logo { width: 64px; height: 64px; border-radius: 16px; background: var(--orange); color: var(--ink); font: 800 30px var(--font-display); display: flex; align-items: center; justify-content: center; }
.big { width: 100%; height: 54px; padding: 0 8px 0 16px; border: 1.5px solid var(--ink); border-radius: 12px; background: var(--card); display: flex; align-items: center; gap: 12px; }
.big input { flex: 1; border: 0; outline: 0; font-size: 15px; background: transparent; min-width: 0; }
.big .btn { height: 40px; }
.tips { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.tip { padding: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; cursor: pointer; font-size: 14px; }
.tip span { font-size: 12px; }
.tip:hover { border-color: var(--ink); }
.browse { margin-left: auto; }
.grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.box { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.bh { display: flex; align-items: center; justify-content: space-between; }
.h2s { font-size: 16px; font-weight: 700; }
.small { font-size: 12px; }
.pad { padding: 4px 0; }
.job { display: flex; align-items: center; gap: 12px; }
.jp { width: 40px; height: 56px; padding: 4px; flex-shrink: 0; }
.jm { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.jt { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.jt b { font-size: 14px; }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.att { display: flex; align-items: center; gap: 10px; }
.am { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.ok-line { display: flex; align-items: center; gap: 6px; color: var(--ok); }
.soon { border-style: dashed; }
</style>
