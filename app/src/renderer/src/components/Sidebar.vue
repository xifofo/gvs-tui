<script setup lang="ts">
import { computed } from 'vue'
import { PROVIDER_NAME } from '@shared/api'
import { accountBucket } from '@shared/provider-registry'
import mark from '../assets/gvs-mark.svg'
import { go, gvs, openSettings, prefs, savePrefs, section, shownProviders, store, type View } from '../store'
import Icon from './Icon.vue'
import PlatformLogo from './PlatformLogo.vue'

type NavItem = { view: View; label: string; icon: string }
const groups: NavItem[][] = [
  [{ view: 'home', label: '首页', icon: 'home' }, { view: 'search', label: '搜索', icon: 'search' }],
  [{ view: 'calendar', label: '追剧日历', icon: 'calendar' }, { view: 'subscriptions', label: '订阅', icon: 'star' }, { view: 'downloads', label: '下载', icon: 'download' }],
  [{ view: 'accounts', label: '账号', icon: 'user' }, { view: 'settings', label: '设置', icon: 'gear' }],
]

const collapsed = computed(() => prefs().sidebarCollapsed)
const toggle = () => void savePrefs({ sidebarCollapsed: !collapsed.value })

const active = (n: NavItem) => section() === n.view
const activeJobs = computed(() => store.jobs.filter((j) => j.state === 'running' || j.state === 'queued').length)
const accounts = computed(() => {
  const all = store.state?.accounts ?? []
  return shownProviders().map((p) => all.find((a) => a.provider === p)).filter((a): a is NonNullable<typeof a> => !!a)
})
const freshSubs = computed(() => (store.subs?.subs ?? []).filter((s) => s.newCount > 0).length)
const attention = computed(() => accounts.value.filter((a) => accountBucket(a) === 'attention').length)
const readyCount = computed(() => accounts.value.filter((a) => a.tone === 'ok').length)
const badge = (v: View) => (v === 'downloads' ? activeJobs.value : v === 'accounts' ? attention.value : v === 'subscriptions' ? freshSubs.value : 0)
const dotColor = (a: (typeof accounts.value)[number]) => {
  const b = accountBucket(a)
  return b === 'ok' ? 'var(--side-ok)' : b === 'attention' ? (a.tone === 'err' ? '#ff8a7a' : 'var(--side-warn)') : 'var(--side-muted)'
}
function onNav(v: View) {
  // 「搜索」入口：没有搜过时先打开命令面板
  if (v === 'search' && !store.search) { store.paletteOpen = true; return }
  go(v)
}

const tunnel = computed(() => {
  const t = store.state?.tunnel
  if (!t?.enabled) return { color: 'var(--side-ok)', text: '网关已连接' }
  if (t.ok) return { color: 'var(--side-ok)', text: '隧道已连接' }
  return { color: 'var(--side-warn)', text: '隧道重连中…' }
})
const host = computed(() => {
  try { return new URL(store.state?.settings.host ?? '').host } catch { return store.state?.settings.host ?? '' }
})
</script>

<template>
  <aside class="side" :class="{ c: collapsed }">
    <div class="brand">
      <img :src="mark" alt="" width="30" height="30" />
      <span v-if="!collapsed" class="name">GVS</span>
    </div>

    <nav aria-label="主导航" class="nav">
      <template v-for="(g, gi) in groups" :key="gi">
        <div v-if="gi" class="sep" />
        <button
          v-for="n in g" :key="n.view" type="button" class="nav-i" :class="{ on: active(n) }"
          :title="collapsed ? n.label : undefined" :aria-label="n.label" :aria-current="active(n) ? 'page' : undefined" @click="onNav(n.view)"
        >
          <Icon :name="n.icon" :size="18" />
          <span v-if="!collapsed" class="lb">{{ n.label }}</span>
          <span v-if="badge(n.view)" class="badge mono" :class="{ warn: n.view === 'accounts' }">{{ badge(n.view) }}</span>
        </button>
      </template>
    </nav>

    <button v-if="store.update?.status === 'ready'" type="button" class="upd ready" :title="`新版本 ${store.update.version} 已就绪`" @click="gvs('installUpdate')">
      <Icon name="refresh" :size="16" /><span v-if="!collapsed">新版本 {{ store.update.version }}<br /><b>重启安装</b></span>
    </button>
    <button v-else-if="store.update?.status === 'downloading' || store.update?.status === 'available'" type="button" class="upd" :title="`新版本 ${store.update.version}`" @click="openSettings('about')">
      <Icon name="download" :size="16" /><span v-if="!collapsed">{{ store.update.status === 'downloading' ? `下载新版本 ${store.update.percent}%` : `有新版本 ${store.update.version}` }}</span>
    </button>

    <button type="button" class="pst" :title="`平台：${readyCount}/${accounts.length} 已登录 · ${tunnel.text}`" @click="go('accounts')">
      <span v-if="!collapsed" class="pst-h"><span>平台</span><span class="muted-s">{{ readyCount }}/{{ accounts.length }} 已登录</span></span>
      <span class="dots">
        <span v-for="a in accounts" :key="a.provider" class="pd" :title="`${PROVIDER_NAME[a.provider]} · ${a.short}`">
          <PlatformLogo :provider="a.provider" :size="18" />
          <i :style="{ background: dotColor(a) }" />
        </span>
      </span>
      <span class="gw-row"><span class="dot" :style="{ background: tunnel.color }" /><span v-if="!collapsed">{{ tunnel.text }}</span></span>
      <span v-if="!collapsed && host" class="gw-host mono">{{ host }}</span>
    </button>

    <button type="button" class="coll" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggle">
      <Icon name="sidebar" :size="16" /><span v-if="!collapsed">收起侧栏</span>
    </button>
  </aside>
</template>

<style scoped>
.side {
  width: 196px; height: 100%; flex-shrink: 0; background: var(--side); color: var(--side-fg);
  padding: 18px 12px 12px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; transition: width .15s ease;
}
.side.c { width: 64px; padding: 18px 10px 12px; align-items: stretch; }
.brand { display: flex; align-items: center; gap: 10px; padding: 0 6px; height: 32px; }
.side.c .brand { justify-content: center; padding: 0; }
.name { font-family: var(--font-display); font-size: 21px; font-weight: 800; letter-spacing: .5px; }
.nav { display: flex; flex-direction: column; gap: 2px; }
.sep { height: 1px; background: var(--side-2); margin: 6px 8px; }
.nav-i {
  position: relative; height: 40px; padding: 0 12px; border-radius: 8px; border: 0; background: transparent; color: #dcdad3;
  display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; cursor: pointer; text-align: left;
}
.side.c .nav-i { justify-content: center; padding: 0; }
.nav-i:hover { background: var(--side-2); color: var(--side-fg); }
.nav-i.on { background: var(--orange); color: var(--ink); font-weight: 700; }
.badge {
  margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--side-2);
  color: var(--side-fg); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.badge.warn { background: var(--side-warn); color: var(--ink); }
.nav-i.on .badge { background: var(--ink); color: var(--paper); }
.side.c .badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; font-size: 10px; background: var(--orange); color: var(--ink); }
.upd {
  margin-top: auto; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--orange); background: transparent;
  color: var(--side-fg); display: flex; align-items: center; gap: 10px; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer;
}
.side.c .upd { justify-content: center; padding: 10px 0; }
.upd.ready { background: var(--orange); color: var(--ink); }
.pst {
  margin-top: auto; padding: 10px; border-radius: 8px; border: 0; background: var(--side-2); color: var(--side-fg);
  display: flex; flex-direction: column; gap: 8px; font-size: 12px; text-align: left; cursor: pointer;
}
.upd + .pst { margin-top: 0; }
.pst:hover { filter: brightness(1.12); }
.pst-h { display: flex; justify-content: space-between; }
.muted-s { color: var(--side-muted); }
.dots { display: flex; flex-wrap: wrap; gap: 7px; }
.side.c .dots { flex-direction: column; align-items: center; }
.pd { position: relative; display: inline-flex; }
.pd i { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--side-2); }
.gw-row { display: flex; align-items: center; gap: 7px; }
.side.c .gw-row { justify-content: center; }
.gw-host { font-size: 11px; color: var(--side-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.coll { height: 30px; border: 0; background: transparent; color: var(--side-muted); display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; cursor: pointer; border-radius: 6px; }
.side.c .coll { justify-content: center; padding: 0; }
.coll:hover { color: var(--side-fg); background: var(--side-2); }
</style>
