<script setup lang="ts">
import { computed } from 'vue'
import { deviceBadge, platformMeta, platformMetaStatus } from '../platform-meta'
import Icon from './Icon.vue'

/** 网关下发的平台账号说明；compact 用于账号卡片，否则用于抽屉。纯文本渲染。 */
const props = defineProps<{ provider: string; compact?: boolean }>()
const meta = computed(() => platformMeta(props.provider))
const badge = computed(() => (meta.value ? deviceBadge(meta.value) : null))
const sysName = (s: string) => (s === 'playready' ? 'PlayReady' : 'Widevine')
const strong = (lv: string) => lv === 'L1' || /^SL3000$/.test(lv)
</script>

<template>
  <template v-if="compact">
    <div v-if="meta" class="chips pm-chips">
      <span v-for="m in meta.methods.filter((m) => m.id !== 'none')" :key="m.id" class="chip" :title="m.note">{{ m.label }}</span>
      <span v-if="badge" class="chip" :class="{ l1: badge.strong }" :title="meta.device.summary">{{ badge.text }}</span>
    </div>
    <span v-if="meta?.region" class="region"><Icon name="globe" :size="13" />{{ meta.region }}</span>
    <span v-else-if="!meta && platformMetaStatus() === 'old'" class="muted small">网关未提供平台说明，请更新网关</span>
  </template>
  <div v-else class="pm">
    <p v-if="!meta && platformMetaStatus() === 'old'" class="pm-old">当前网关版本未提供平台账号说明（登录方式、官网、设备文件要求）。请更新网关后重新打开。</p>
    <p v-else-if="!meta && platformMetaStatus() === 'error'" class="pm-old">平台说明暂时读取失败，稍后重试。</p>
    <div v-if="meta" class="kv">
      <span>登录方式</span>
      <span class="col">
        <span v-for="m in meta.methods" :key="m.id" class="mline"><span class="chip">{{ m.label }}</span><span v-if="m.note" class="note">{{ m.note }}</span></span>
      </span>
      <template v-if="meta.loginUrl">
        <span>官网</span>
        <span class="row"><span class="mono url" :title="meta.loginUrl">{{ meta.loginUrl }}</span><a class="btn sm" :href="meta.loginUrl" target="_blank" rel="noopener noreferrer"><Icon name="globe" :size="14" />打开官网</a></span>
      </template>
      <template v-if="meta.cookieNote || meta.cookieKeys?.length">
        <span>Cookie</span>
        <span class="col"><span v-if="meta.cookieNote">{{ meta.cookieNote }}</span><span v-if="meta.cookieKeys?.length" class="chips"><span v-for="k in meta.cookieKeys" :key="k" class="chip mono">{{ k }}</span></span></span>
      </template>
      <span>设备文件</span>
      <span class="col">
        <span v-if="!meta.device.required" class="muted">{{ meta.device.summary }}<template v-if="meta.device.note">；{{ meta.device.note }}</template></span>
        <template v-else>
          <span class="chips"><span v-for="f in meta.device.files" :key="f" class="chip mono">{{ f }}</span></span>
          <span v-for="(l, i) in meta.device.levels" :key="i" class="mline"><span class="chip" :class="{ l1: strong(l.level) }">{{ sysName(l.system) }} {{ l.level }}</span><span class="note">{{ l.when }}</span></span>
          <span v-if="meta.device.note" class="note">{{ meta.device.note }}</span>
          <span class="note">在 设置 › 设备文件 上传</span>
        </template>
      </span>
      <template v-if="meta.region"><span>地区</span><span class="region"><Icon name="globe" :size="13" />{{ meta.region }}</span></template>
      <template v-if="meta.description"><span>说明</span><span>{{ meta.description }}</span></template>
      <template v-if="meta.unknown?.length"><span>未知</span><span class="muted">{{ meta.unknown.join('；') }}</span></template>
    </div>
  </div>
</template>

<style scoped>
.pm-chips { flex-wrap: wrap; min-width: 0; }
.pm-chips .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-old { margin: 0; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px; font-size: 12.5px; color: var(--ink-3); }
.kv { display: grid; grid-template-columns: 64px 1fr; gap: 8px 12px; font-size: 13px; }
.kv > span:nth-child(odd) { color: var(--ink-3); }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.row .btn { height: var(--ui-control-h); flex: none; }
.url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--ink-2); }
.mline { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.note { font-size: 12px; color: var(--ink-3); line-height: 1.5; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.region { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--orange-text); }
.small { font-size: 12px; }
</style>
