<script setup lang="ts">
import { publisherSources } from '../../../../../../src/integrations/plutofish/sources'
import { computed } from 'vue'
import type { PlutoFishView } from '@shared/api'
import Icon from '../../components/Icon.vue'

const props = defineProps<{ connection?: PlutoFishView; compact?: boolean; collapsed?: boolean; active?: boolean }>()
const emit = defineEmits<{ open: [] }>()
const identity = computed(() => props.connection?.status === 'verified' ? props.connection.identity : null)
const status = computed(() => {
  switch (props.connection?.status) {
    case 'verified': return { text: '已连接', tone: 'ok' }
    case 'checking': return { text: '验证中', tone: 'warn' }
    case 'error': return { text: '连接失败', tone: 'err' }
    default: return { text: '未连接', tone: '' }
  }
})
const name = computed(() => identity.value?.name || '尚未验证身份')
const initial = computed(() => identity.value ? Array.from(identity.value.name)[0] : '')
const source = computed(() => identity.value?.sourceAccount)
const sources = computed(() => publisherSources(identity.value))
const sourceText = computed(() => source.value ? `${sources.value.length} 个可用账号 · 默认 ${source.value.name}` : identity.value ? '未绑定源账号' : status.value.text)
const summary = computed(() => `PlutoFish · ${name.value} · ${status.value.text}${source.value ? ` · ${sourceText.value}` : ''}`)
</script>

<template>
  <button v-if="compact" type="button" class="identity-summary" :class="{ collapsed, active }" :title="summary" :aria-label="summary" :aria-current="active ? 'page' : undefined" @click="emit('open')">
    <span v-if="!collapsed" class="summary-heading"><strong>PlutoFish</strong><span class="connection-dot" :class="status.tone" aria-hidden="true" /></span>
    <span class="summary-profile">
      <span class="avatar" aria-hidden="true"><template v-if="initial">{{ initial }}</template><Icon v-else name="user" :size="18" /><span v-if="collapsed" class="connection-dot" :class="status.tone" /></span>
      <span v-if="!collapsed" class="summary-text"><strong>{{ name }}</strong><small>{{ sourceText }}</small></span>
    </span>
  </button>

  <section v-else class="card identity-details" aria-label="PlutoFish 账号信息">
    <header class="details-heading"><h2 class="h2s">PlutoFish</h2><span class="chip" :class="status.tone" role="status">{{ status.text }}</span></header>
    <div class="srow profile">
      <span class="avatar" aria-hidden="true"><template v-if="initial">{{ initial }}</template><Icon v-else name="user" :size="22" /></span>
      <div class="sl"><span class="profile-name">{{ name }}</span><span class="sd">{{ identity ? '发布端账号' : '验证通过后显示账号信息' }}</span></div>
    </div>
    <dl class="details-fields">
      <div class="srow"><div class="sl"><dt class="st">服务地址</dt><dd class="sd mono">{{ connection?.url || '未设置' }}</dd></div></div>
      <div class="srow"><div class="sl"><dt class="st">默认网盘账号</dt><dd class="sd">{{ source?.name || (identity ? '未绑定' : '尚未验证') }}</dd><dd v-if="source" class="sd mono">{{ source.alias }}</dd></div></div>
      <div v-if="sources.length > 1" class="srow"><div class="sl"><dt class="st">可用网盘账号</dt><dd v-for="account in sources" :key="account.id" class="sd">{{ account.provider ?? '115' }} · {{ account.name }} · {{ account.alias }}</dd></div></div>
    </dl>
    <div v-if="connection?.error" class="srow"><p class="connection-error" role="alert">{{ connection.error }}</p></div>
  </section>
</template>

<style scoped>
.identity-summary { width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: var(--ui-radius-md); background: var(--card); color: var(--ink); display: flex; flex-direction: column; gap: 9px; text-align: left; cursor: pointer; transition: border-color var(--ui-duration-fast), background var(--ui-duration-fast); }
.identity-summary:hover, .identity-summary.active { border-color: var(--line-2); background: var(--paper-2); }
.summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; }
.summary-profile { display: flex; align-items: center; gap: 9px; min-width: 0; }
.avatar { position: relative; width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px; background: var(--orange-soft); color: var(--orange-text); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 750; }
.summary-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.summary-text strong, .summary-text small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.summary-text strong { font-size: 12px; font-weight: 650; }
.summary-text small { font-size: 10.5px; color: var(--ink-2); }
.connection-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--ink-3); }
.connection-dot.ok { background: var(--ok); }
.connection-dot.warn { background: var(--warn); }
.connection-dot.err { background: var(--err); }
.collapsed { padding: 8px 0; align-items: center; }
.collapsed .connection-dot { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border: 2px solid var(--card); }
.identity-details { overflow: hidden; }
.details-heading { padding: 18px 20px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); }
.profile { border-top: 0; }
.profile .avatar { width: 44px; height: 44px; border-radius: 12px; font-size: 20px; }
.profile-name { font-size: 17px; font-weight: 750; overflow-wrap: anywhere; }
.details-fields { margin: 0; }
.details-fields .srow { border-top: 1px solid var(--line); }
.details-fields dd { margin: 0; overflow-wrap: anywhere; }
.connection-error { color: var(--err); font-size: 12.5px; line-height: 1.6; overflow-wrap: anywhere; }
</style>
