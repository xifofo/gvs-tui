<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { SessionCommand, ProviderSessionView } from '@shared/api'
import { gvs, store, toast, errText } from '../store'
const allowed = (p: string) => (store.state?.providers || []).some(v => v === p)
const busy = ref(false)
const views = reactive<Record<string, ProviderSessionView>>({})
const cookie = ref(''), phone = ref(''), code = ref(''), profile = ref(''), pin = ref('')
const mode = computed(() => store.state?.settings.hamiClient || 'tv')
const hami = computed(() => views['hamivideo:' + mode.value])
async function command(c: SessionCommand) {
  busy.value = true
  try {
    const v = await gvs('providerSession', c)
    views[c.provider + (c.provider === 'hamivideo' ? ':' + (c.op.startsWith('web_') ? 'web' : 'tv') : '')] = v
    toast(v.summary, v.authenticated ? 'ok' : 'muted')
  } catch (e) { toast(errText(e), 'err') }
  finally { busy.value = false; cookie.value = ''; code.value = ''; pin.value = ''; if (c.op === 'web_send_code') phone.value = '' }
}
async function setMode(event: Event) {
  const hamiClient = (event.target as HTMLSelectElement).value as 'tv' | 'web'
  try { await gvs('saveSettings', { hamiClient }) } catch (e) { toast(errText(e), 'err') }
}
watch(() => store.state?.accountScope || ((store.state?.settings.host || '') + ':' + (store.state?.settings.keyMasked || '')), () => {
  for (const key of Object.keys(views)) delete views[key]
  cookie.value = ''; phone.value = ''; code.value = ''; pin.value = ''
})
</script>

<template>
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
