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
  return b === 'ok' ? 'var(--side-ok)' : b === 'attention' ? (a.tone === 'err' ? 'var(--err)' : 'var(--side-warn)') : 'var(--side-muted)'
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
      <span v-if="!collapsed" class="name">GVS<small>视频下载与追剧</small></span>
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
          <span v-if="badge(n.view)" class="badge mono" :class="{ warn: n.view === 'accounts', hot: n.view === 'downloads' }">{{ badge(n.view) }}</span>
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
  border-right: 1px solid color-mix(in srgb, var(--line-2) 54%, transparent);
  padding: 16px 12px 12px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; transition: width var(--ui-duration-base) var(--ui-ease-out);
}
.side.c { width: 64px; padding: 16px 10px 12px; align-items: stretch; }
.brand { display: flex; align-items: center; gap: 10px; padding: 2px 6px 6px; }
.brand img { border-radius: 10px; box-shadow: 0 7px 18px rgb(var(--ui-accent-channel) / 30%); }
.side.c .brand { justify-content: center; padding: 0; }
.name { font-size: 17px; font-weight: 900; letter-spacing: .06em; color: var(--orange-2); display: flex; flex-direction: column; line-height: 1.1; }
.name small { font-size: 10.5px; font-weight: 650; letter-spacing: 0; color: var(--ink-2); margin-top: 2px; }
.nav { display: flex; flex-direction: column; gap: 2px; }
.sep { height: 1px; background: var(--line); margin: 8px 8px; }
.nav-i {
  position: relative; min-height: 38px; padding: 0 10px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--ink-2);
  display: flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 700; cursor: pointer; text-align: left;
  transition: background var(--ui-duration-fast) var(--ui-ease-out), color var(--ui-duration-fast), border-color var(--ui-duration-fast);
}
.side.c .nav-i { justify-content: center; padding: 0; }
.nav-i:hover { background: color-mix(in srgb, var(--paper-2) 60%, transparent); color: var(--ink); }
.nav-i.on { background: var(--paper-2); color: var(--ink); border-color: var(--line); box-shadow: var(--ui-inset); }
.nav-i.on :deep(svg) { color: var(--orange-2); }
.nav-i.on::before { content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--orange); box-shadow: 0 0 12px rgb(var(--ui-accent-channel) / 60%); }
.side.c .nav-i.on::before { left: -10px; }
.badge {
  margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--paper-2); border: 1px solid var(--line);
  color: var(--ink-2); font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; font-family: var(--font-body);
}
.badge.warn, .badge.hot { background: var(--orange); border-color: var(--orange); color: var(--on-orange); }
.side.c .badge { position: absolute; top: 1px; right: 1px; min-width: 16px; height: 16px; padding: 0 4px; font-size: 10px; background: var(--orange); border-color: var(--orange); color: var(--on-orange); }
.upd {
  margin-top: auto; padding: 10px 12px; border-radius: var(--ui-radius-md); border: 1px solid color-mix(in srgb, var(--orange) 55%, var(--line)); background: var(--orange-soft);
  color: var(--ink); display: flex; align-items: center; gap: 10px; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer;
}
.side.c .upd { justify-content: center; padding: 10px 0; }
.upd.ready { background: var(--orange); color: var(--on-orange); box-shadow: var(--ui-glow); }
.pst {
  margin-top: auto; padding: 10px; border-radius: var(--ui-radius-md); border: 1px solid var(--line); background: var(--card); color: var(--ink-2);
  display: flex; flex-direction: column; gap: 8px; font-size: 11.5px; text-align: left; cursor: pointer; transition: border-color var(--ui-duration-fast);
}
.upd + .pst { margin-top: 0; }
.pst:hover { border-color: var(--line-2); }
.pst-h { display: flex; justify-content: space-between; color: var(--ink); font-weight: 700; }
.muted-s { color: var(--ink-2); font-weight: 500; }
.dots { display: flex; flex-wrap: wrap; gap: 7px; }
.side.c .dots { flex-direction: column; align-items: center; }
.pd { position: relative; display: inline-flex; }
.pd i { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--card); }
.gw-row { display: flex; align-items: center; gap: 7px; }
.side.c .gw-row { justify-content: center; }
.gw-host { font-size: 11px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.coll { height: 30px; border: 0; background: transparent; color: var(--ink-3); display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; cursor: pointer; border-radius: 8px; }
.side.c .coll { justify-content: center; padding: 0; }
.coll:hover { color: var(--ink); background: var(--paper-2); }
</style>
