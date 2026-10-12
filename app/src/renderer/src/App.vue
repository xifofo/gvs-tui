<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { back, modalOpen, store } from './store'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import Toasts from './components/Toasts.vue'
import QrDialog from './components/QrDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import Setup from './views/Setup.vue'
import Home from './views/Home.vue'
import Accounts from './views/Accounts.vue'
import ComingSoon from './views/ComingSoon.vue'
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
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="!store.state" class="boot"><span class="spin" /></div>
  <Setup v-else-if="!store.state.configured || store.onboarding" />
  <div v-else class="shell">
    <Sidebar />
    <main class="main">
      <TopBar />
      <div class="body">
        <Transition name="page" mode="out-in" :duration="140">
          <KeepAlive :include="['DiscoverView', 'QualityView']">
            <Home v-if="store.view === 'home'" key="home" />
            <Discover v-else-if="store.view === 'discover'" key="discover" />
            <Search v-else-if="store.view === 'search'" key="search" />
            <Detail v-else-if="store.view === 'detail'" key="detail" />
            <Quality v-else-if="store.view === 'quality'" key="quality" />
            <Downloads v-else-if="store.view === 'downloads'" key="downloads" />
            <Accounts v-else-if="store.view === 'accounts'" key="accounts" />
            <ComingSoon v-else-if="store.view === 'calendar' || store.view === 'subscriptions'" :key="store.view" />
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
.shell { height: 100%; display: flex; }
.main { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; }
.body { flex-grow: 1; min-height: 0; }
</style>
