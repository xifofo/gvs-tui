<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { back, modalOpen, prefs, store } from './store'
import { applyMotion, applyTheme, vtActive } from './motion'
import Ambient from './components/Ambient.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import Toasts from './components/Toasts.vue'
import QrDialog from './components/QrDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import Setup from './views/Setup.vue'
import Home from './views/Home.vue'
import Accounts from './views/Accounts.vue'
import Calendar from './views/Calendar.vue'
import Subscriptions from './views/Subscriptions.vue'
import Discover from './views/Discover.vue'
import Search from './views/Search.vue'
import Detail from './views/Detail.vue'
import Quality from './views/Quality.vue'
import Downloads from './views/Downloads.vue'
import Settings from './views/Settings.vue'

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return
  if (store.view !== 'detail' && store.view !== 'quality') return
  if (modalOpen()) return
  if (e.key === 'Escape' && (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); back(store.search ? 'search' : 'home') }
}
let themed = false
watch(() => (store.state ? prefs().theme : null), (t) => { if (!t) return; applyTheme(t, themed); themed = true }, { immediate: true })
watch(() => (store.state ? prefs().motion : null), (m) => { if (m !== null) applyMotion(m) }, { immediate: true })
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Ambient :enabled="store.state ? prefs().motion : true" />
  <div v-if="!store.state" class="boot"><span class="spin" /></div>
  <Setup v-else-if="!store.state.configured || store.onboarding" />
  <div v-else class="shell">
    <Sidebar />
    <main class="main">
      <TopBar />
      <div class="body">
        <Transition :name="vtActive ? 'vt' : 'page'" mode="out-in" :duration="vtActive ? 0 : undefined">
          <KeepAlive :include="['DiscoverView', 'QualityView']">
            <Home v-if="store.view === 'home'" key="home" />
            <Discover v-else-if="store.view === 'discover'" key="discover" />
            <Search v-else-if="store.view === 'search'" key="search" />
            <Detail v-else-if="store.view === 'detail'" key="detail" />
            <Quality v-else-if="store.view === 'quality'" key="quality" />
            <Downloads v-else-if="store.view === 'downloads'" key="downloads" />
            <Accounts v-else-if="store.view === 'accounts'" key="accounts" />
            <Calendar v-else-if="store.view === 'calendar'" key="calendar" />
            <Subscriptions v-else-if="store.view === 'subscriptions'" key="subscriptions" />
            <Settings v-else-if="store.view === 'settings'" key="settings" />
          </KeepAlive>
        </Transition>
      </div>
    </main>
  </div>
  <CommandPalette v-if="store.paletteOpen && store.state?.configured && !store.onboarding" />
  <QrDialog v-if="store.qr" />
  <Toasts />
</template>

<style scoped>
.boot { height: 100%; display: flex; align-items: center; justify-content: center; }
.shell { position: relative; z-index: 1; height: 100%; display: flex; }
.boot { position: relative; z-index: 1; }
.main { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; }
.body { flex-grow: 1; min-height: 0; }
</style>
