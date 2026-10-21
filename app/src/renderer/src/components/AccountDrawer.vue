<script setup lang="ts">
import { computed, ref } from 'vue'
import { PROVIDER_NAME, type Provider } from '@shared/api'
import { providerMeta } from '@shared/provider-registry'
import PlatformMetaInfo from './PlatformMetaInfo.vue'
import { loadPlatformMeta } from '../platform-meta'
import AccountExtras from './AccountExtras.vue'
import Icon from './Icon.vue'
import PlatformLogo from './PlatformLogo.vue'
import ProviderAccounts from './ProviderAccounts.vue'
import AccountSlots from './AccountSlots.vue'
import { accountsOf, prefs, savePrefs, store } from '../store'
import { useDialogFocus } from '../dialog-focus'

const props = defineProps<{ provider: Provider }>()
const meta = computed(() => providerMeta(props.provider))
const account = computed(() => store.state?.accounts.find((a) => a.provider === props.provider))
const slotCount = computed(() => accountsOf(props.provider).length)
const hidden = computed(() => prefs().hiddenProviders.includes(props.provider))
const drawer = ref<HTMLElement | null>(null)
void loadPlatformMeta()
const close = () => { if (!store.qr) store.accountDrawer = null }
useDialogFocus(drawer, close, () => !store.qr && store.dialogCount === 0)
const toneClass: Record<string, string> = { ok: 'ok', warn: 'warn', err: 'err', muted: '' }
function hide() {
  void savePrefs({ hiddenProviders: [...new Set([...prefs().hiddenProviders, props.provider])] })
  store.accountDrawer = null
}
</script>

<template>
  <div class="scrim" @mousedown.self="close">
    <aside ref="drawer" class="drawer" role="dialog" aria-modal="true" :aria-label="`${PROVIDER_NAME[provider]} 账号`">
      <header class="dh">
        <PlatformLogo :provider="provider" :size="32" />
        <div class="dt">
          <b>{{ PROVIDER_NAME[provider] }}</b>
          <span class="chip" :class="toneClass[account?.tone ?? 'muted']">● {{ account?.short ?? (meta.methods.includes('none') ? '无需登录' : '未登录') }}</span>
        </div>
        <button type="button" class="btn sm icon" aria-label="关闭" data-dialog-cancel @click="close"><Icon name="x" :size="16" /></button>
      </header>
      <div class="db">
        <p v-if="account?.summary" class="sum">{{ account.summary }}</p>
        <PlatformMetaInfo :provider="provider" />

        <section class="sec">
          <AccountExtras :provider="provider" />
          <ProviderAccounts :only="provider" />
        </section>

        <section class="sec">
          <h3>账号 <span class="muted">· {{ slotCount }} 个</span></h3>
          <AccountSlots v-if="!meta.methods.includes('none') || slotCount" :provider="provider" />
          <span v-else class="muted small">这个平台无需登录。</span>
        </section>
      </div>
      <footer class="df">
        <button v-if="!hidden" type="button" class="btn sm" @click="hide"><Icon name="eyeoff" :size="15" />隐藏此平台</button>
        <span class="muted small">凭证由网关加密托管；多账号的 Cookie 用系统密钥环加密存本机。</span>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--ui-overlay); backdrop-filter: blur(6px); z-index: 35; display: flex; justify-content: flex-end; }
.drawer { width: min(460px, 94vw); height: 100%; background: var(--card); border-left: 1px solid var(--line); box-shadow: var(--ui-shadow-dialog); display: flex; flex-direction: column; }
.dh { padding: 18px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
.dt { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.dt b { font-size: 17px; }
.db { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
.sum { font-size: 13px; color: var(--ink-2); line-height: 1.6; margin: 0; }
.kv { display: grid; grid-template-columns: 64px 1fr; gap: 6px 12px; font-size: 13px; }
.kv > span:nth-child(odd) { color: var(--ink-3); }
.region { display: flex; align-items: center; gap: 5px; color: var(--orange-text); }
.sec { border-top: 1px solid var(--line); padding-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.sec :deep(h3) { font-size: 13px; color: var(--ink-3); margin: 0; }
.acct-row { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
.av { width: 30px; height: 30px; border-radius: 50%; background: var(--paper-2); display: flex; align-items: center; justify-content: center; }
.am { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; gap: 2px; }
.am .muted { font-size: 12px; }
.sec > .btn { align-self: flex-start; }
.df { padding: 12px 20px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 12px; background: var(--paper); }
.small { font-size: 12px; }
.drm { line-height: 1.6; }
.drm .chip { margin-right: 6px; vertical-align: 1px; }
</style>
