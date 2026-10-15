<script setup lang="ts">
// 原「设置 → 平台账号」里优酷 / 腾讯 / 抖音 / IQ Cookie 的操作，按平台拆出来放进账号抽屉。
import { computed, ref, watch } from 'vue'
import type { SettingsPatch } from '@shared/api'
import TencentDiagnostics from './TencentDiagnostics.vue'
import Icon from './Icon.vue'
import { errText, gvs, store, toast } from '../store'

const props = defineProps<{ provider: string }>()
const s = computed(() => store.state!.settings)
const saving = ref('')
const diagnosticsOpen = ref(false)
const form = ref({ tencentCookie: '', douyinCookie: '', iqCookie: '', iqProfile: '' })
watch(() => [props.provider, s.value.iqProfile] as const, () => {
  form.value = { tencentCookie: '', douyinCookie: '', iqCookie: '', iqProfile: s.value.iqProfile }
}, { immediate: true })

async function save(patch: SettingsPatch, what: string) {
  saving.value = what
  try {
    store.state = await gvs('saveSettings', patch)
    toast('已保存', 'ok')
    if ('tencentCookie' in patch) form.value.tencentCookie = ''
    if ('douyinCookie' in patch) form.value.douyinCookie = ''
    if ('iqCookie' in patch) form.value.iqCookie = ''
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    saving.value = ''
  }
}
async function renew() {
  saving.value = 'renew'
  try { toast(await gvs('youkuRenew'), 'ok') } catch (e) { toast(errText(e), 'err') } finally { saving.value = '' }
}
</script>

<template>
  <div v-if="provider === 'youku'" class="blk">
    <p>用优酷 App 扫码登录；登录态由网关按 Key 保存，过期前可续期。</p>
    <div class="controls">
      <button type="button" class="btn sm" @click="store.qr = 'youku'"><Icon name="qr" :size="15" />扫码登录</button>
      <button type="button" class="btn sm" :disabled="saving === 'renew'" @click="renew"><span v-if="saving === 'renew'" class="spin" />续期</button>
    </div>
  </div>

  <div v-else-if="provider === 'tencent'" class="blk">
    <p>推荐双扫码（微信 + QQ 任一）登录；也可粘贴网页 Cookie，推送到网关托管，本机不保存。</p>
    <div class="controls">
      <button type="button" class="btn sm" @click="store.qr = 'tencent'"><Icon name="qr" :size="15" />双扫码</button>
      <button type="button" class="btn sm" @click="diagnosticsOpen = true">风控处理日志</button>
      <button type="button" class="btn sm" title="向支持的网关记录真实进程指标；不代表已向腾讯发送事件" @click="save({ tencentObservations: !s.tencentObservations }, 'tx-observe')">操作观测：{{ s.tencentObservations ? '开' : '关' }}</button>
    </div>
    <details>
      <summary>真实原生事件接入</summary>
      <p>读取实际采集器追加的 JSONL，跟随当前 TV 账号的操作流程处理。手机已发送的镜像只预览；下载进度不会作为观看进度上报。</p>
      <input class="input" :value="s.tencentNativeEventFile" placeholder="实际事件 JSONL 的本机绝对路径" @change="save({ tencentNativeEventFile: ($event.target as HTMLInputElement).value }, 'tx-native-file')" />
      <select class="input" :value="s.tencentNativeEventMode" @change="save({ tencentNativeEventMode: ($event.target as HTMLSelectElement).value as 'off' | 'preview' | 'send' }, 'tx-native-mode')">
        <option value="off">关闭</option><option value="preview">仅预览</option><option value="send">发送生产者标记为尚未投递的事件</option>
      </select>
    </details>
    <details>
      <summary>粘贴网页 Cookie</summary>
      <textarea v-model="form.tencentCookie" class="input" spellcheck="false" placeholder="粘贴腾讯视频网页 Cookie" />
      <button type="button" class="btn sm" :disabled="!form.tencentCookie.trim() || saving === 'tx'" @click="save({ tencentCookie: form.tencentCookie }, 'tx')">保存 Cookie</button>
    </details>
    <TencentDiagnostics v-if="diagnosticsOpen" @close="diagnosticsOpen = false" />
  </div>

  <div v-else-if="provider === 'douyin'" class="blk">
    <p>网页登录 Cookie（需含 sessionid），推送到网关号池托管。</p>
    <textarea v-model="form.douyinCookie" class="input" spellcheck="false" placeholder="网页登录 Cookie（需含 sessionid）" />
    <button type="button" class="btn sm" :disabled="!form.douyinCookie.trim() || saving === 'dy'" @click="save({ douyinCookie: form.douyinCookie }, 'dy')">保存 Cookie</button>
  </div>

  <div v-else-if="provider === 'iq'" class="blk">
    <details>
      <summary>直接保存 IQ Cookie 会话 / 高级设备资料</summary>
      <textarea v-model="form.iqCookie" class="input" spellcheck="false" placeholder="IQ Cookie Header" />
      <button type="button" class="btn sm" :disabled="!form.iqCookie.trim() || saving === 'iq'" @click="save({ iqCookie: form.iqCookie }, 'iq')">保存会话</button>
      <textarea v-model="form.iqProfile" class="input" spellcheck="false" placeholder="设备资料 JSON：deviceId、ccsn（网关已配置设备证书时可留空）" />
      <button type="button" class="btn sm" :disabled="saving === 'iq-profile'" @click="save({ iqProfile: form.iqProfile }, 'iq-profile')">保存设备资料</button>
    </details>
  </div>

  <div v-else-if="provider === 'hongguo' || provider === 'huangguo'" class="blk">
    <p>公开接口，不需要账号。</p>
  </div>
</template>

<style scoped>
.blk { display: flex; flex-direction: column; gap: 10px; padding-bottom: 6px; }
p { font-size: 12px; line-height: 1.65; color: var(--ink-2); margin: 0; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }
details { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
details > * + * { margin-top: 8px; }
summary { cursor: pointer; color: var(--ink-2); }
textarea { min-height: 80px; width: 100%; }
</style>
