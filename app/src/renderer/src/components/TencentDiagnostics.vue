<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TencentDiagnostic } from '@shared/api'
import { gvs, store, errText } from '../store'
const props = defineProps<{ jobId?: number }>()
defineEmits<{ close: [] }>()
const rows = ref<TencentDiagnostic[]>([]), loading = ref(false), error = ref('')
const labels: Record<string,string> = {
  request_completed:'请求完成（不代表风控通过）', request_error:'请求失败', risk_rejected:'风险拒绝',
  binding_invalid:'绑定失效', rate_limited:'请求限频', rejected:'请求被拒绝', stopped_locally:'已在本机停止',
  observed_locally:'网关已记录本地观测', local_only_gateway_source_unsupported:'Electron 本地观测（网关尚未支持该来源）',
  unverified_response:'收到响应，尚未证实接受', delivery_unknown:'送达情况不确定', preview:'仅预览，未发送', disabled:'上报关闭', incomplete:'字段不足，未发送',
  stop_flow:'停止当前流程', reauth_required:'检查登录后重新操作', no_automatic_resend:'不自动重发',
  inspect_error:'检查错误', local_observation:'仅观测记录', local_only:'仅本地记录', not_acceptance_proof:'不能据此认定接受', continue:'继续当前流程',
}
let generation = 0
async function refresh() {
  const g = ++generation; loading.value = true; error.value = ''; rows.value = []
  try { const result = await (props.jobId == null ? gvs('tencentDiagnostics') : gvs('tencentDiagnostics', props.jobId)); if (g === generation) rows.value = result }
  catch (e) { if (g === generation) error.value = errText(e) }
  finally { if (g === generation) loading.value = false }
}
watch(() => String(props.jobId ?? '') + ':' + (store.state?.accountScope || ((store.state?.settings.host || '') + ':' + (store.state?.settings.keyMasked || ''))), () => void refresh(), { immediate: true })
</script>

<template>
  <section class="diagnostics card" aria-label="腾讯风控处理日志">
    <div class="heading"><h3>腾讯诊断{{ jobId === undefined ? ' · 当前账号' : ' · 任务 ' + jobId }}</h3><button class="btn sm" :disabled="loading" @click="refresh">刷新</button><button class="btn sm" @click="$emit('close')">关闭</button></div>
    <p>本地观测 ≠ 已向腾讯发送；HTTP 200 ≠ 风控接受。不包含 Cookie、绑定令牌、设备凭据、媒体地址或内容密钥。</p>
    <p>操作观测：{{ store.state?.settings.tencentObservations ? '已开启，支持此来源的网关会接收真实桌面进程指标' : '未开启，可在账号设置中开启' }}。腾讯事件自动发送尚未接入。</p>
    <p v-if="error" class="error-box">{{ error }}</p>
    <p v-else-if="loading" aria-live="polite">正在读取当前账号诊断…</p>
    <p v-else-if="!rows.length">暂无诊断记录。不会为了生成日志自动发送取流或上报请求。</p>
    <div v-else class="events">
      <article v-for="(r,i) in rows" :key="r.operation + r.at + i" :class="{ stopped: ['stop_flow','reauth_required'].includes(r.decision) }">
        <div><time>{{ r.at }}</time> · {{ r.action }}/{{ r.phase }} <span v-if="r.job">· 任务 {{ r.job }}</span></div>
        <strong>{{ labels[r.status] || r.status }}</strong> → {{ labels[r.decision] || r.decision }}
        <span v-if="r.code"> · code={{ r.code }}</span><span v-if="r.httpStatus"> · HTTP {{ r.httpStatus }}</span>
        <small>flow={{ r.flow || '未启用绑定' }} · operation={{ r.operation }}</small>
      </article>
    </div>
  </section>
</template>

<style scoped>
.diagnostics{padding:18px;margin:16px 0}.heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.heading h3{flex:1;margin:0;font-size:16px}
p{font-size:12px;line-height:1.7;opacity:.8}.events{max-height:420px;overflow:auto}article{padding:12px 8px;border-bottom:1px solid var(--line,#ddd);font-size:12px;line-height:1.7;overflow-wrap:anywhere}small{display:block;opacity:.65}.stopped{border-left:3px solid var(--err,#b64332)}
</style>
