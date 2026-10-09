<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { SessionCommand, ProviderSessionView } from '@shared/api'
import { gvs, store, toast, errText } from '../store'
const allowed = (p: string) => (store.state?.providers || []).some(v => v === p)
const busy = ref(false)
const views = reactive<Record<string, ProviderSessionView>>({})
const cookie = ref(''), phone = ref(''), code = ref(''), profile = ref(''), pin = ref('')
const iqUsername = ref(''), iqPassword = ref(''), iqAreaCode = ref('')
const iqStatusError = ref('')
const accountScope = computed(() => store.state?.accountScope || ((store.state?.settings.host || '') + ':' + (store.state?.settings.keyMasked || '')))
const iqSummary = computed(() => iqStatusError.value || views.iq?.summary || store.state?.accounts.find(a => a.provider === 'iq')?.summary)
let revision = 0
const mode = computed(() => store.state?.settings.hamiClient || 'tv')
const hami = computed(() => views['hamivideo:' + mode.value])
async function command(c: SessionCommand) {
  const current = revision
  busy.value = true
  try {
    const v = await gvs('providerSession', c)
    if (current !== revision) return
    views[c.provider + (c.provider === 'hamivideo' ? ':' + (c.op.startsWith('web_') ? 'web' : 'tv') : '')] = v
    if (c.provider === 'iq') iqStatusError.value = ''
    toast(v.summary, v.authenticated ? 'ok' : 'muted')
  } catch (e) { if (current === revision) toast(errText(e), 'err') }
  finally {
    if (current === revision) {
      busy.value = false
      // Read-only status queries must not erase inputs the user is preparing.
      if (!['status', 'web_status'].includes(c.op)) { cookie.value = ''; code.value = ''; pin.value = ''; iqPassword.value = ''; if (c.op === 'web_send_code') phone.value = '' }
    }
  }
}
async function checkIQStatus() {
  if (busy.value) return
  const current = revision
  busy.value = true
  iqStatusError.value = ''
  try {
    const v = await gvs('providerSession', { provider: 'iq', op: 'status' })
    if (current === revision) views.iq = v
  } catch (e) {
    if (current === revision) iqStatusError.value = '未能检查 IQ 会话：' + errText(e)
  } finally { if (current === revision) busy.value = false }
}
async function setMode(event: Event) {
  const hamiClient = (event.target as HTMLSelectElement).value as 'tv' | 'web'
  try { await gvs('saveSettings', { hamiClient }) } catch (e) { toast(errText(e), 'err') }
}
watch(accountScope, () => {
  revision++
  busy.value = false
  iqStatusError.value = ''
  for (const key of Object.keys(views)) delete views[key]
  cookie.value = ''; phone.value = ''; code.value = ''; pin.value = ''
  iqUsername.value = ''; iqPassword.value = ''; iqAreaCode.value = ''
})
watch(() => store.state?.configured && !store.state.connecting && allowed('iq') && (!store.state.tunnel.enabled || store.state.tunnel.ok) ? accountScope.value : '', scope => {
  if (scope) void checkIQStatus()
}, { immediate: true })
onBeforeUnmount(() => { revision++ })
</script>

<template>
  <div v-if="allowed('iqcn')" class="provider-account">
    <h3>爱奇艺国内版 · 扫码登录</h3>
    <p>用爱奇艺 App 扫码确认，账号会话由网关按当前 Key 保存。</p>
    <div class="controls">
      <button class="btn sm" :disabled="busy" @click="store.qr = 'iqcn'">扫码登录</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'iqcn',op:'status'})">账号状态</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'iqcn',op:'logout'})">退出</button>
    </div>
    <p v-if="views.iqcn" aria-live="polite">{{ views.iqcn.summary }}</p>
  </div>
  <div v-if="allowed('iq')" class="provider-account">
    <h3>IQ 海外版 · 账号登录</h3>
    <p>账号密码登录后自动取得 Web 会话，再换取 TV 下载会话。密码仅本次提交；遇到人工验证时按源站要求完成。</p>
    <div class="controls">
      <input v-model="iqUsername" class="input" autocomplete="username" placeholder="邮箱或手机号" aria-label="本人 IQ 邮箱或手机号" />
      <input v-model="iqAreaCode" class="input" inputmode="numeric" autocomplete="off" placeholder="手机区号（邮箱留空）" aria-label="手机号国家区号" />
      <input v-model="iqPassword" class="input" type="password" autocomplete="off" placeholder="密码（提交后清空）" aria-label="IQ 登录密码" />
      <button class="btn sm" :disabled="busy || !iqUsername.trim() || !iqPassword" @click="command({provider:'iq',op:'password',username:iqUsername,password:iqPassword,areaCode:iqAreaCode})">登录并换取 TV 会话</button>
    </div>
    <div class="controls">
      <button class="btn sm" :disabled="busy" @click="command({provider:'iq',op:'status'})">账号状态</button>
      <button class="btn sm" :disabled="busy || !views.iq?.webAuthenticated" @click="command({provider:'iq',op:'exchange_tv'})">重新换取 TV 会话</button>
      <button class="btn sm" :disabled="busy || !views.iq?.userCode" @click="command({provider:'iq',op:'poll'})">检查授权</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'iq',op:'logout'})">退出</button>
    </div>
    <p v-if="iqSummary" aria-live="polite">{{ iqSummary }}</p>
    <p v-if="views.iq?.userCode">TV 激活码：{{ views.iq.userCode }}</p>
    <input v-if="views.iq?.url" class="input" :value="views.iq.url" readonly aria-label="IQ 官方验证页面" />
    <details><summary>使用已有 Web Cookie</summary>
      <textarea v-model="cookie" class="input" autocomplete="off" spellcheck="false" placeholder="本人 Web Cookie Header 或 Netscape 文本，仅本次提交" aria-label="本人 IQ Web Cookie" />
      <button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'iq',op:'web_import',cookie})">验证 Web Cookie 并换取 TV 会话</button>
    </details>
  </div>
  <div v-if="allowed('mewatch')" class="provider-account">
    <h3>mewatch · 官方设备激活</h3>
    <p>网关按当前 Key 保存会话。激活页登录后，按返回间隔检查；不会自动反复发起登录。</p>
    <div class="controls">
      <button class="btn sm" :disabled="busy" @click="command({provider:'mewatch',op:'start'})">获取激活码</button>
      <button class="btn sm" :disabled="busy || !views.mewatch?.userCode" @click="command({provider:'mewatch',op:'poll'})">检查授权</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'mewatch',op:'status'})">账号状态</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'mewatch',op:'profiles'})">读取 profiles</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'mewatch',op:'logout'})">退出</button>
    </div>
    <div v-if="views.mewatch" aria-live="polite">
      <p>{{ views.mewatch.summary }} <span v-if="views.mewatch.interval">· 至少间隔 {{ views.mewatch.interval }} 秒</span></p>
      <strong v-if="views.mewatch.userCode">激活码：{{ views.mewatch.userCode }}</strong>
      <input v-if="views.mewatch.url" class="input" :value="views.mewatch.url" readonly aria-label="复制到浏览器打开的官方激活地址" />
      <div v-if="views.mewatch.profiles?.length" class="controls">
        <select v-model="profile" class="input" aria-label="选择 profile"><option value="">选择 profile</option><option v-for="p in views.mewatch.profiles" :key="p.id" :value="p.id">{{ p.name || p.id }}</option></select>
        <input v-model="pin" class="input" type="password" autocomplete="off" placeholder="PIN（若需要）" />
        <button class="btn sm" :disabled="busy || !profile" @click="command({provider:'mewatch',op:'profile',profileId:profile,pin})">切换 profile</button>
      </div>
    </div>
  </div>
  <div v-if="allowed('hamivideo')" class="provider-account">
    <h3>HamiVideo · 独立 Web / TV 会话</h3>
    <p>通过产品链接打开详情。短信登录不等于 TV 登录；当前网关尚未开放二维码配对。</p>
    <label><span>取流会话</span> <select class="input" :value="mode" :disabled="busy" @change="setMode"><option value="tv">TV</option><option value="web">Web</option></select></label>
    <template v-if="mode === 'tv'">
      <textarea v-model="cookie" class="input" spellcheck="false" autocomplete="off" aria-label="本人 Hami TV Cookie，仅本次提交" placeholder="本人 TV Cookie Header 或 Netscape 文件文本；不会保存到客户端配置" />
      <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'hamivideo',op:'import',cookie})">导入 TV Cookie</button><button class="btn sm" :disabled="busy" @click="command({provider:'hamivideo',op:'refresh'})">续期 TV 会话</button></div>
    </template>
    <template v-else>
      <div class="controls"><button class="btn sm" :disabled="busy" @click="command({provider:'hamivideo',op:'web_start'})">准备短信登录（不发码）</button></div>
      <div class="controls"><input v-model="phone" class="input" inputmode="tel" autocomplete="off" placeholder="台湾门号 09xxxxxxxx" aria-label="本人台湾手机号" /><button class="btn sm" :disabled="busy || !phone" @click="command({provider:'hamivideo',op:'web_send_code',phone,confirm:true})">确认发送验证码</button></div>
      <div class="controls"><input v-model="code" class="input" type="password" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="六位短信码" aria-label="六位短信验证码" /><button class="btn sm" :disabled="busy || code.length !== 6" @click="command({provider:'hamivideo',op:'web_verify',code})">验证并登录</button></div>
    </template>
    <div class="controls"><button class="btn sm" :disabled="busy" @click="command({provider:'hamivideo',op:mode === 'web' ? 'web_status' : 'status'})">检查当前会话</button><button class="btn sm" :disabled="busy" @click="command({provider:'hamivideo',op:mode === 'web' ? 'web_logout' : 'logout'})">退出当前会话</button></div>
    <p v-if="hami" aria-live="polite">{{ hami.summary }} <span v-if="hami.resendAfterSeconds">· 发码冷却 {{ hami.resendAfterSeconds }} 秒</span></p>
    <p>媒体由本机直连 CDN。受保护媒体需要相应授权处理能力；不会把设备认证文件下载到本机。</p>
  </div>
</template>

<style scoped>
.provider-account{padding:18px 22px;border-bottom:1px solid var(--line,#333)}
h3{font-size:14px;margin:0 0 10px} p{font-size:12px;line-height:1.65;opacity:.8;overflow-wrap:anywhere}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.controls .input{width:auto;min-width:150px;flex:1}
textarea{min-height:80px;margin:10px 0} strong{display:block;margin:10px 0}label{display:flex;align-items:center;gap:12px}label span{white-space:nowrap;flex-shrink:0}label select{min-width:0;flex:1}
</style>
