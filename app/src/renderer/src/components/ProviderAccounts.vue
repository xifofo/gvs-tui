<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { SessionCommand, ProviderSessionView } from '@shared/api'
import { gvs, store, toast, errText } from '../store'
import UiSelect from './UiSelect.vue'
const props = defineProps<{ only?: string }>()
const allowed = (p: string) => (store.state?.providers || []).some(v => v === p) && (!props.only || props.only === p)
const busy = ref(false)
const views = reactive<Record<string, ProviderSessionView>>({})
const cookie = ref(''), phone = ref(''), code = ref(''), profile = ref(''), pin = ref('')
const iqUsername = ref(''), iqPassword = ref(''), iqAreaCode = ref('')
const iqStatusError = ref('')
const crMessage = ref('')
const appleVerifyID = ref('')
const dsnpEmail = ref(''), dsnpPassword = ref(''), dsnpSeat = ref('')
const dsnpSeats = computed(() => [{ value: '', label: '选择席位', disabled: true }, ...(views.dsnp?.profiles ?? []).map((p: { id: string; name?: string }, i: number) => ({ value: String(i + 1), label: p.name || p.id }))])
const appleCountry = ref('hk')
const APPLE_COUNTRIES = [['hk', '香港'], ['tw', '台湾'], ['jp', '日本'], ['us', '美国'], ['gb', '英国'], ['au', '澳大利亚'], ['ca', '加拿大'], ['tr', '土耳其']].map(([value, label]) => ({ value, label }))
const HAMI_MODES = [{ value: 'tv' as const, label: 'TV' }, { value: 'web' as const, label: 'Web' }]
const mewatchProfiles = computed(() => [{ value: '', label: '选择 profile', disabled: true }, ...(views.mewatch?.profiles ?? []).map((p: { id: string; name?: string }) => ({ value: p.id, label: p.name || p.id }))])
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
    views[c.provider + (c.provider === 'migu' ? ':' + v.terminal : c.provider === 'hamivideo' ? ':' + (c.op.startsWith('web_') ? 'web' : 'tv') : '')] = v
    if (c.provider === 'iq') iqStatusError.value = ''
    toast(v.summary, v.authenticated ? 'ok' : 'muted')
  } catch (e) { if (current === revision) toast(errText(e), 'err') }
  finally {
    if (current === revision) {
      busy.value = false
      // Read-only status queries must not erase inputs the user is preparing.
      if (!['status', 'web_status'].includes(c.op)) { cookie.value = ''; code.value = ''; pin.value = ''; iqPassword.value = ''; dsnpPassword.value = ''; if (c.op === 'web_send_code') phone.value = '' }
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
async function setMode(hamiClient: 'tv' | 'web') {
  try { await gvs('saveSettings', { hamiClient }) } catch (e) { toast(errText(e), 'err') }
}
/** Crunchyroll 一键登录：主进程开授权窗并在回跳时截获 code，令牌直接存本机。 */
async function crSsoLogin() {
  if (busy.value) return
  const current = revision
  busy.value = true
  crMessage.value = ''
  try {
    const r = await gvs('crunchyrollSsoLogin')
    if (current !== revision) return
    crMessage.value = r.country ? `${r.message}（地区 ${r.country}）` : r.message
    toast(crMessage.value, 'ok')
  } catch (e) {
    if (current === revision) {
      crMessage.value = '自动登录未完成：' + errText(e)
      toast(crMessage.value, 'err')
    }
  } finally {
    if (current === revision) busy.value = false
  }
}
watch(accountScope, () => {
  revision++
  busy.value = false
  iqStatusError.value = ''
  for (const key of Object.keys(views)) delete views[key]
  cookie.value = ''; phone.value = ''; code.value = ''; pin.value = ''
  iqUsername.value = ''; iqPassword.value = ''; iqAreaCode.value = ''
  dsnpEmail.value = ''; dsnpPassword.value = ''; dsnpSeat.value = ''
})
watch(() => store.state?.configured && !store.state.connecting && allowed('iq') && (!store.state.tunnel.enabled || store.state.tunnel.ok) ? accountScope.value : '', scope => {
  if (scope) void checkIQStatus()
}, { immediate: true })
onBeforeUnmount(() => { revision++ })
</script>

<template>
  <div v-if="allowed('dsnp')" class="provider-account">
    <h3>Disney+ · 账号登录</h3>
    <p>邮箱 + 密码，或邮箱验证码；也可导入本人 refresh token。密码只提交给网关换取令牌，网关不落盘密码，本机不保存。</p>
    <div class="controls"><input v-model="dsnpEmail" class="input grow" autocomplete="off" aria-label="Disney+ 邮箱" placeholder="Disney+ 邮箱" /></div>
    <div class="controls"><input v-model="dsnpPassword" class="input grow" type="password" autocomplete="new-password" aria-label="Disney+ 密码，仅本次提交" placeholder="密码（仅本次提交）" /><button class="btn sm" :disabled="busy || !dsnpEmail.trim() || !dsnpPassword" @click="command({provider:'dsnp',op:'password',email:dsnpEmail.trim(),password:dsnpPassword})">密码登录</button></div>
    <div class="controls"><button class="btn sm" :disabled="busy || !dsnpEmail.trim()" @click="command({provider:'dsnp',op:'otp_request',email:dsnpEmail.trim()})">发送邮箱验证码</button><input v-model="code" class="input" inputmode="numeric" autocomplete="one-time-code" aria-label="邮箱验证码" placeholder="验证码" /><button class="btn sm" :disabled="busy || !dsnpEmail.trim() || !code.trim()" @click="command({provider:'dsnp',op:'otp_verify',email:dsnpEmail.trim(),code:code.trim()})">验证码登录</button></div>
    <textarea v-model="cookie" class="input" aria-label="本人 Disney+ refresh token 或 Cookie，仅本次提交" autocomplete="off" spellcheck="false" placeholder="或粘贴本人 refresh token / Cookie" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'dsnp',op:'import',cookie})">导入令牌</button><button class="btn sm" :disabled="busy" @click="command({provider:'dsnp',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'dsnp',op:'logout'})">退出</button></div>

    <div v-if="views.dsnp?.profiles?.length" class="controls"><label class="grow"><span>家庭席位</span><UiSelect v-model="dsnpSeat" :options="dsnpSeats" aria-label="Disney+ 家庭席位" /></label><input v-model="pin" class="input" type="password" inputmode="numeric" autocomplete="off" aria-label="席位 PIN（如需要）" placeholder="PIN（如需要）" /><button class="btn sm" :disabled="busy || !dsnpSeat" @click="command({provider:'dsnp',op:'seat',id:dsnpSeat,pin})">切换席位</button></div>
    <p v-if="views.dsnp" aria-live="polite">{{ views.dsnp.summary }}</p>
  </div>
  <div v-if="allowed('crunchyroll')" class="provider-account">
    <h3>Crunchyroll · 账号登录</h3>
    <p>点「一键登录」会打开 Crunchyroll 官方登录页（在登录窗里完成，不用手动抓令牌），登录完成后自动把 refresh_token 存到本机配置；网关不保存该令牌，下载时仅用于换取约 1 小时的 access token 与内容密钥，媒体由本机直连 CDN。也可以手动粘贴 refresh_token。</p>
    <div class="controls"><button class="btn sm" :disabled="busy" @click="crSsoLogin">一键登录（自动获取令牌）</button><button class="btn sm" :disabled="busy" @click="command({provider:'crunchyroll',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'crunchyroll',op:'logout'})">退出</button></div>
    <p v-if="crMessage" aria-live="polite">{{ crMessage }}</p>
    <textarea v-model="cookie" class="input" aria-label="本人 Crunchyroll refresh_token，仅保存在本机" autocomplete="off" spellcheck="false" placeholder="或粘贴本人 refresh_token" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'crunchyroll',op:'import',token:cookie})">粘贴导入令牌</button></div>
    <p v-if="views.crunchyroll" aria-live="polite">{{ views.crunchyroll.summary }}</p>
  </div>
  <div v-if="allowed('appletvplus')" class="provider-account">

    <h3>Apple TV · 账号登录</h3>
    <p>粘贴官网的媒体令牌或完整 Cookie，选择你的 Apple 账号地区。</p>
    <div class="controls"><label class="grow"><span>账号地区</span><UiSelect v-model="appleCountry" :options="APPLE_COUNTRIES" aria-label="Apple 账号地区" /></label><a class="btn sm" :href="`https://tv.apple.com/${appleCountry}`" target="_blank" rel="noopener noreferrer">打开 Apple TV 官网</a></div>
    <textarea v-model="cookie" class="input" aria-label="本人 Apple TV 媒体令牌或 Cookie，仅本次提交" autocomplete="off" spellcheck="false" placeholder="媒体令牌（0. 开头）或完整 Cookie" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'appletvplus',op:'import',cookie,country:appleCountry})">导入登录态</button><button class="btn sm" :disabled="busy" @click="command({provider:'appletvplus',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'appletvplus',op:'logout'})">退出</button></div>
    <div class="controls"><input v-model="appleVerifyID" class="input" autocomplete="off" aria-label="单集或电影 ID" placeholder="单集或电影 ID：umc.cmc.…" /><button class="btn sm" :disabled="busy || !appleVerifyID.trim()" @click="command({provider:'appletvplus',op:'verify',id:appleVerifyID.trim()})">验证播放权益</button></div>
    <p v-if="views.appletvplus" aria-live="polite">{{ views.appletvplus.summary }}</p>
  </div>
  <div v-for="terminal in allowed('migu') ? (['mobile','tv'] as const) : []" :key="terminal" class="provider-account">
    <h3>{{ terminal === 'mobile' ? '咪咕 App' : '咪咕 TV（咪视界）' }}</h3>
    <p>{{ terminal === 'mobile' ? '使用咪咕视频 App 扫码，读取 App 目录与画质，支持源站可用的 HDR Vivid。' : '使用咪咕视频 App 扫码授权咪视界，读取 TV 目录与画质，支持源站可用的 4K。' }}</p>
    <div class="controls">
      <button class="btn sm" :disabled="busy" @click="store.miguQrTerminal=terminal;store.qr='migu'">扫码登录</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'migu',op:'status',terminal})">账号状态</button>
      <button class="btn sm" :disabled="busy" @click="command({provider:'migu',op:'logout',terminal})">退出此端</button>
    </div>
    <p v-if="views['migu:' + terminal]" aria-live="polite">{{ views['migu:' + terminal].summary }}</p>
  </div>
  <div v-if="allowed('mgtv')" class="provider-account">
    <h3>芒果 TV · App 扫码登录</h3>
    <p>使用芒果 TV App 扫码，网关按当前 Key 保存账号会话。</p>
    <div class="controls"><button class="btn sm" :disabled="busy" @click="store.qr = 'mgtv'">芒果扫码登录</button><button class="btn sm" :disabled="busy" @click="command({provider:'mgtv',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'mgtv',op:'logout'})">退出</button></div>
    <p v-if="views.mgtv" aria-live="polite">{{ views.mgtv.summary }}</p>
  </div>
  <div v-if="allowed('bilibili')" class="provider-account">
    <h3>哔哩哔哩 · 扫码 / Web Cookie</h3>
    <p>匿名可用。高画质推荐用哔哩哔哩 App 扫码登录；也可导入本人 Web Cookie Header。会话只在网关内存保存，重启需重新登录。</p>
    <div class="controls"><button class="btn sm" :disabled="busy" @click="store.qr = 'bilibili'">B 站扫码登录</button></div>
    <textarea v-model="cookie" class="input" autocomplete="off" spellcheck="false" aria-label="本人 B 站 Web Cookie" placeholder="SESSDATA=…; bili_jct=…" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'bilibili',op:'import',cookie})">验证并导入 B 站 Cookie</button><button class="btn sm" :disabled="busy" @click="command({provider:'bilibili',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'bilibili',op:'logout'})">退出</button></div>
    <p v-if="views.bilibili" aria-live="polite">{{ views.bilibili.summary }}</p>
  </div>
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
        <UiSelect v-model="profile" :options="mewatchProfiles" placeholder="选择 profile" aria-label="选择 profile" />
        <input v-model="pin" class="input" type="password" autocomplete="off" placeholder="PIN（若需要）" />
        <button class="btn sm" :disabled="busy || !profile" @click="command({provider:'mewatch',op:'profile',profileId:profile,pin})">切换 profile</button>
      </div>
    </div>
  </div>
  <div v-if="allowed('hamivideo')" class="provider-account">
    <h3>HamiVideo · 独立 Web / TV 会话</h3>
    <p>通过产品链接打开详情。短信登录不等于 TV 登录；当前网关尚未开放二维码配对。</p>
    <div class="controls"><label class="grow"><span>取流会话</span><UiSelect :model-value="mode" :options="HAMI_MODES" :disabled="busy" aria-label="取流会话" @change="setMode" /></label></div>
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
  <div v-if="allowed('friday')" class="provider-account">
    <h3>Friday影音 · TV 会话</h3>
    <p>需台湾出口并保持隧道在线。榜单免登录；播放需本人 TV 会话（官方绑定页 / 扫码，或导入 TV CK）。</p>
    <div class="controls"><button class="btn sm" :disabled="busy" @click="command({provider:'friday',op:'web'})">打开官方绑定页</button><button class="btn sm" :disabled="busy || !views.friday?.url" @click="command({provider:'friday',op:'poll'})">检查绑定</button></div>
    <div v-if="views.friday?.url" aria-live="polite">
      <strong v-if="views.friday.userCode">绑定码：{{ views.friday.userCode }}</strong>
      <input class="input" :value="views.friday.url" readonly aria-label="复制到台湾出口浏览器打开的官方绑定地址" />
    </div>
    <textarea v-model="cookie" class="input" spellcheck="false" autocomplete="off" aria-label="本人 Friday TV CK，仅本次提交" placeholder="本人 TV CK（friday_tv_* Cookie Header 或 Netscape 文本）；普通网页 CK 不能代替" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'friday',op:'import',cookie})">导入 TV CK</button><button class="btn sm" :disabled="busy" @click="command({provider:'friday',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'friday',op:'refresh'})">续期</button><button class="btn sm" :disabled="busy" @click="command({provider:'friday',op:'logout'})">退出</button></div>
    <p v-if="views.friday" aria-live="polite">{{ views.friday.summary }}</p>
  </div>
  <div v-if="allowed('linetv')" class="provider-account">
    <h3>LINE TV · 可选登录</h3>
    <p>需台湾出口。匿名可看 SD；导入本人浏览器 Cookie（含 accessToken）解锁会员 / FHD。</p>
    <textarea v-model="cookie" class="input" spellcheck="false" autocomplete="off" aria-label="本人 LINE TV Cookie，仅本次提交" placeholder="Cookie Header、Netscape cookies.txt 或 JSON；不会保存到客户端配置" />
    <div class="controls"><button class="btn sm" :disabled="busy || !cookie.trim()" @click="command({provider:'linetv',op:'import',cookie})">导入 Cookie</button><button class="btn sm" :disabled="busy" @click="command({provider:'linetv',op:'status'})">账号状态</button><button class="btn sm" :disabled="busy" @click="command({provider:'linetv',op:'logout'})">退出</button></div>
    <p v-if="views.linetv" aria-live="polite">{{ views.linetv.summary }}</p>
  </div>
</template>

<style scoped>
.provider-account{padding:4px 0 14px}
h3{font-size:14px;margin:0 0 10px} p{font-size:12px;line-height:1.65;opacity:.8;overflow-wrap:anywhere}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.controls .input{width:auto;min-width:150px;flex:1}
textarea{min-height:80px;margin:10px 0} strong{display:block;margin:10px 0}label{display:flex;align-items:center;gap:12px}.controls label.grow{flex:1;min-width:200px}label span{white-space:nowrap;flex-shrink:0}label .ui-select{min-width:0;flex:1}
</style>

