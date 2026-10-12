<script setup lang="ts">
import { computed, ref } from 'vue'
import { PROVIDER_NAME, type Provider } from '@shared/api'
import { accountBucket, METHOD_LABEL, moveProvider, orderProviders, providerMeta } from '@shared/provider-registry'
import AccountDrawer from '../components/AccountDrawer.vue'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import { prefs, savePrefs, store } from '../store'

type Filter = 'all' | 'attention' | 'ok' | 'hidden'
const filter = ref<Filter>('all')
const reorder = ref(false)

const available = computed(() => store.state?.providers ?? [])
const ordered = computed(() => orderProviders(available.value, prefs().providerOrder))
const hidden = computed(() => new Set(prefs().hiddenProviders))
const account = (p: Provider) => store.state?.accounts.find((a) => a.provider === p)
const bucket = (p: Provider) => { const a = account(p); return a ? accountBucket(a) : 'idle' }
const counts = computed(() => {
  const vis = ordered.value.filter((p) => !hidden.value.has(p))
  return {
    all: vis.length,
    attention: vis.filter((p) => bucket(p) === 'attention').length,
    ok: vis.filter((p) => bucket(p) === 'ok').length,
    hidden: ordered.value.length - vis.length,
  }
})
const list = computed(() => ordered.value.filter((p) => {
  if (filter.value === 'hidden') return hidden.value.has(p)
  if (hidden.value.has(p)) return false
  return filter.value === 'all' || bucket(p) === filter.value
}))
const TABS: Array<{ key: Filter; label: string }> = [{ key: 'all', label: '全部' }, { key: 'attention', label: '需处理' }, { key: 'ok', label: '已登录' }, { key: 'hidden', label: '已隐藏' }]
const toneClass: Record<string, string> = { ok: 'ok', warn: 'warn', err: 'err', muted: '' }

function setHidden(p: Provider, on: boolean) {
  const set = new Set(prefs().hiddenProviders)
  on ? set.add(p) : set.delete(p)
  void savePrefs({ hiddenProviders: [...set] })
}
function move(p: Provider, d: -1 | 1) {
  void savePrefs({ providerOrder: moveProvider(available.value, prefs().providerOrder, p, d) })
}
const open = (p: Provider) => { store.accountDrawer = p }
</script>

<template>
  <div class="page">
    <div class="h1-row">
      <h1 class="h1">账号</h1>
      <span class="muted">{{ counts.ok }} 个已登录 · {{ counts.attention }} 个需处理<template v-if="counts.hidden"> · {{ counts.hidden }} 个已隐藏</template></span>
      <div class="acts">
        <button type="button" class="btn sm" :class="{ outline: reorder }" @click="reorder = !reorder"><Icon name="grid" :size="15" />{{ reorder ? '完成排序' : '排序' }}</button>
      </div>
    </div>
    <p class="muted intro">隐藏不用的平台后，它不会出现在搜索、浏览和侧栏里；排序决定搜索结果里平台芯片的先后。</p>

    <div class="seg tabs" role="tablist" aria-label="按状态筛选">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="filter === t.key" :class="{ on: filter === t.key }" @click="filter = t.key">
        {{ t.label }} {{ counts[t.key] }}
      </button>
    </div>

    <div class="grid">
      <div v-for="p in list" :key="p" class="card acc" :class="{ off: hidden.has(p), sel: store.accountDrawer === p }">
        <div class="ah">
          <PlatformLogo :provider="p" :size="28" />
          <b class="an">{{ PROVIDER_NAME[p] }}</b>
          <template v-if="reorder">
            <button type="button" class="btn sm icon" :aria-label="`上移 ${PROVIDER_NAME[p]}`" @click="move(p, -1)"><Icon name="up" :size="15" /></button>
            <button type="button" class="btn sm icon" :aria-label="`下移 ${PROVIDER_NAME[p]}`" @click="move(p, 1)"><Icon name="down" :size="15" /></button>
          </template>
          <button v-else type="button" class="btn sm icon" :title="hidden.has(p) ? '取消隐藏' : '隐藏此平台'" :aria-label="hidden.has(p) ? `取消隐藏 ${PROVIDER_NAME[p]}` : `隐藏 ${PROVIDER_NAME[p]}`" @click="setHidden(p, !hidden.has(p))">
            <Icon :name="hidden.has(p) ? 'eye' : 'eyeoff'" :size="15" />
          </button>
        </div>
        <div class="chips">
          <span class="chip" :class="toneClass[account(p)?.tone ?? 'muted']">● {{ account(p)?.short ?? (providerMeta(p).methods.includes('none') ? '无需登录' : '未登录') }}</span>
          <span v-for="m in providerMeta(p).methods.filter((m) => m !== 'none')" :key="m" class="chip">{{ METHOD_LABEL[m] }}</span>
        </div>
        <span class="sum clamp2">{{ account(p)?.summary || providerMeta(p).benefit }}</span>
        <span v-if="providerMeta(p).region" class="region"><Icon name="globe" :size="13" />{{ providerMeta(p).region }}</span>
        <div class="af">
          <button v-if="!hidden.has(p)" type="button" class="btn sm" :class="{ outline: bucket(p) === 'attention' }" @click="open(p)">
            {{ bucket(p) === 'ok' ? '管理' : providerMeta(p).methods.includes('none') ? '查看' : '登录 / 管理' }}
          </button>
          <button v-else type="button" class="btn sm" @click="setHidden(p, false)">重新启用</button>
        </div>
      </div>
      <div v-if="!list.length" class="empty">{{ filter === 'attention' ? '没有需要处理的平台' : filter === 'hidden' ? '没有隐藏的平台' : '没有平台' }}</div>
    </div>

    <AccountDrawer v-if="store.accountDrawer" :key="store.accountDrawer" :provider="store.accountDrawer" />
  </div>
</template>

<style scoped>
.acts { margin-left: auto; display: flex; gap: 8px; }
.intro { font-size: 13px; margin-top: -10px; }
.tabs { width: 420px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.acc { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.acc.sel { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.acc.off { opacity: .6; }
.ah { display: flex; align-items: center; gap: 10px; }
.an { flex: 1; font-size: 15px; }
.sum { font-size: 12px; color: var(--ink-2); line-height: 1.5; min-height: 36px; }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.region { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--orange-text); }
.af { display: flex; gap: 8px; margin-top: auto; }
</style>
