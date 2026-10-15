<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PlutoFishFields from '../integrations/plutofish/ConnectionFields.vue'
import type { PlutoFishInput } from '@shared/api'
import { PROVIDER_NAME, PROVIDERS, type Provider } from '@shared/api'
import { orderProviders, providerMeta } from '@shared/provider-registry'
import type { QualityCap } from '@shared/ui-prefs'
import mark from '../assets/gvs-mark.svg'
import AccountDrawer from '../components/AccountDrawer.vue'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import { errText, go, gvs, prefs, savePrefs, store } from '../store'

const host = ref(store.state?.settings.host || 'https://')
const key = ref('')
const desktopProxy = ref(store.state?.settings.desktopProxy || '')
const plutofish = ref<PlutoFishInput>({ url: store.state?.plutofish?.url || '', key: '' })
const busy = ref(false)
const error = ref(store.state?.keyError ?? '')
const connectionError = computed(() => {
  const message = error.value || store.state?.keyError || ''
  const plutoError = store.state?.plutofish?.error
  return plutoError && message.includes(plutoError) ? '' : message
})
/** 已连上（configured）但仍在引导里时，从第 2 步继续 */
const step = ref<1 | 2 | 3>(store.state?.configured ? 2 : 1)
watch(() => store.state?.configured, (ready) => { if (!ready) step.value = 1 })

async function connect() {
  if (busy.value || store.state?.connecting) return
  busy.value = true
  error.value = ''
  store.onboarding = true
  try {
    store.state = await gvs('setup', host.value, key.value, desktopProxy.value, { ...plutofish.value })
    if (store.state.configured) { key.value = ''; plutofish.value.key = ''; step.value = 2 }
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}

// ---- 第 2 步：选择常用平台并登录 ----
const available = computed(() => orderProviders(store.state?.providers ?? [], prefs().providerOrder))
const hidden = computed(() => new Set(prefs().hiddenProviders))
const account = (p: Provider) => store.state?.accounts.find((a) => a.provider === p)
function toggle(p: Provider) {
  const set = new Set(prefs().hiddenProviders)
  set.has(p) ? set.delete(p) : set.add(p)
  void savePrefs({ hiddenProviders: [...set] })
}
const enabledCount = computed(() => available.value.filter((p) => !hidden.value.has(p)).length)

// ---- 第 3 步：下载目录与默认画质 ----
const outDir = computed(() => store.state?.settings.outDir || '')
async function pickDir() {
  const dir = await gvs('chooseDir', outDir.value || undefined)
  if (!dir) return
  try { store.state = await gvs('saveSettings', { outDir: dir }) } catch (e) { error.value = errText(e) }
}
const QUALITY: Array<{ value: QualityCap; label: string; hint: string }> = [
  { value: 'best', label: '最高可用', hint: '有 4K / 杜比就用' },
  { value: '1080', label: '1080P', hint: '省空间，画质够用' },
  { value: '720', label: '720P', hint: '最省空间' },
]
function finish() {
  store.onboarding = false
  go('home')
}

const brandPlats = computed(() => (store.state?.providers?.length ? store.state.providers : PROVIDERS.filter((p) => p !== 'douyin')).slice(0, 9))
const STEPS = [
  { n: 1, title: '连接服务', hint: '网关与 PlutoFish 双重鉴权' },
  { n: 2, title: '选择常用平台并登录', hint: '只显示你用的平台' },
  { n: 3, title: '下载目录与默认画质', hint: '之后可在设置里修改' },
] as const
</script>

<template>
  <div class="setup">
    <section class="left">
      <div class="logo"><img :src="mark" alt="" width="34" height="34" /><span>GVS</span></div>
      <h1 class="hero">三步开始<br /><span>追剧不用守着</span></h1>
      <p class="tag">一个地方搜遍你常用的平台，<br />画质和音轨按规则自动挑，文件存在你自己电脑上。</p>
      <ol class="steps">
        <li v-for="s in STEPS" :key="s.n" class="step" :class="{ on: step === s.n, done: step > s.n }">
          <span class="n mono"><Icon v-if="step > s.n" name="check" :size="14" :stroke="3" /><template v-else>{{ s.n }}</template></span>
          <span class="st"><b>{{ s.title }}</b><small>{{ s.hint }}</small></span>
        </li>
      </ol>
      <div class="plats">
        <PlatformLogo v-for="p in brandPlats" :key="p" :provider="p" :size="22" :title="PROVIDER_NAME[p]" />
        <span class="muted-l">{{ brandPlats.length }} 个平台</span>
      </div>
    </section>

    <section class="right">
      <!-- 1 连接网关 -->
      <form v-if="step === 1" class="card hard form dual-auth" @submit.prevent="connect">
        <div class="title">
          <span class="muted small">第 1 步 / 共 3 步</span>
          <h2>连接网关与 PlutoFish</h2>
          <span class="dim">分别填写网关和 PlutoFish 的凭据，两项验证通过后才能进入。</span>
        </div>
        <label class="field strong-label">网关地址
          <input v-model="host" :disabled="busy || store.state?.connecting" class="input strong mono" placeholder="https://your-gateway.example" autocomplete="off" required />
        </label>
        <label class="field strong-label">网关 API Key
          <span v-if="store.state?.settings.hasKey" class="dim">已保存 Key，留空继续使用。</span>
          <input v-model="key" type="password" :disabled="busy || store.state?.connecting" class="input strong mono" :placeholder="store.state?.settings.keyMasked || 'sk_live_…'" autocomplete="off" :required="!store.state?.settings.hasKey" />
        </label>
        <label class="field strong-label">代理地址
          <span class="dim">填写 HTTP/HTTPS 代理地址和端口；留空使用系统代理。</span>
          <input v-model="desktopProxy" :disabled="busy || store.state?.connecting" class="input strong mono" placeholder="http://127.0.0.1:7890" autocomplete="off" spellcheck="false" />
        </label>
        <PlutoFishFields v-model="plutofish" :state="store.state?.plutofish" :disabled="busy || store.state?.connecting" />
        <div v-if="connectionError" class="error-box" role="alert">{{ connectionError }}</div>
        <button type="submit" class="btn primary big" :disabled="busy || store.state?.connecting">
          <span v-if="busy || store.state?.connecting" class="spin" />
          <span>{{ busy || store.state?.connecting ? '连接中…' : '验证并进入' }}</span>
          <Icon v-if="!busy" name="arrow" />
        </button>
        <div class="note"><Icon name="check" :size="15" :stroke="2.5" style="color: var(--ok)" />连上后会自动建立隧道，需要本机出网的平台请求从本机发出</div>
      </form>

      <!-- 2 选择平台并登录 -->
      <div v-else-if="step === 2" class="wide">
        <div class="title">
          <span class="muted small">第 2 步 / 共 3 步</span>
          <h2>你常用哪些平台？</h2>
          <span class="dim">只勾选你用的，其它平台会被隐藏（随时可以在「账号」里重新启用）。勾选后可以直接登录，也可以稍后再登。</span>
        </div>
        <div v-if="!available.length" class="notice"><span class="spin" />正在读取当前 Key 可用的平台…</div>
        <div class="pgrid">
          <div v-for="p in available" :key="p" class="card pc" :class="{ on: !hidden.has(p) }">
            <button type="button" class="pc-h" :aria-pressed="!hidden.has(p)" @click="toggle(p)">
              <PlatformLogo :provider="p" :size="28" />
              <b>{{ PROVIDER_NAME[p] }}</b>
              <span class="cb" :class="{ on: !hidden.has(p) }"><Icon v-if="!hidden.has(p)" name="check" :size="13" :stroke="3" /></span>
            </button>
            <div v-if="!hidden.has(p)" class="pc-b">
              <span v-if="account(p)?.tone === 'ok'" class="chip ok">● {{ account(p)?.short }}</span>
              <button v-else-if="!providerMeta(p).methods.includes('none')" type="button" class="btn sm" @click="store.accountDrawer = p">登录</button>
              <span v-else class="chip">无需登录</span>
              <span v-if="providerMeta(p).region" class="region">{{ providerMeta(p).region }}</span>
            </div>
            <span v-else class="muted small">未启用</span>
          </div>
        </div>
        <div class="nav">
          <span class="muted small">已启用 {{ enabledCount }} 个平台</span>
          <span class="sp" />
          <button type="button" class="btn" @click="step = 3">稍后再登录</button>
          <button type="button" class="btn primary" :disabled="!enabledCount" @click="step = 3">下一步：下载与画质<Icon name="arrow" :size="16" /></button>
        </div>
      </div>

      <!-- 3 下载目录与默认画质 -->
      <div v-else class="card hard form">
        <div class="title">
          <span class="muted small">第 3 步 / 共 3 步</span>
          <h2>下载到哪里、默认什么画质</h2>
        </div>
        <label class="field strong-label">下载目录
          <span class="dim">文件保存在这台电脑上。默认避开系统盘。</span>
          <div class="dir">
            <input :value="outDir" class="input strong mono" readonly title="选择保存视频的文件夹" @click="pickDir" />
            <button type="button" class="btn" @click="pickDir">更改</button>
          </div>
        </label>
        <div class="field strong-label">默认画质
          <span class="dim">打开画质面板时自动选中；每次下载前都可以改。</span>
          <div class="qopts" role="radiogroup" aria-label="默认画质">
            <button v-for="q in QUALITY" :key="q.value" type="button" role="radio" class="qopt" :class="{ on: prefs().defaultQuality === q.value }" :aria-checked="prefs().defaultQuality === q.value" @click="savePrefs({ defaultQuality: q.value })">
              <b>{{ q.label }}</b><small>{{ q.hint }}</small>
            </button>
          </div>
        </div>
        <div v-if="error" class="error-box" role="alert">{{ error }}</div>
        <div class="nav">
          <button type="button" class="btn" @click="step = 2">上一步</button>
          <span class="sp" />
          <button type="button" class="btn primary big" @click="finish">开始使用<Icon name="arrow" /></button>
        </div>
      </div>
    </section>
    <AccountDrawer v-if="store.accountDrawer" :key="store.accountDrawer" :provider="store.accountDrawer" />
  </div>
</template>

<style scoped>
.setup { height: 100%; display: flex; }
.left { width: 36%; max-width: 460px; background: var(--side); color: var(--ink); border-right: 1px solid var(--line); padding: 44px; display: flex; flex-direction: column; gap: 26px; }
.logo { display: flex; align-items: center; gap: 12px; font-family: var(--font-display); font-size: 22px; font-weight: 800; }
.hero { margin-top: 12px; font-family: var(--font-display); font-size: clamp(36px, 3.6vw, 48px); font-weight: 800; letter-spacing: -1px; line-height: 1.15; }
.hero span { color: var(--orange); }
.tag { font-size: 15px; line-height: 1.7; color: var(--ink-2); }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.step { display: flex; gap: 14px; align-items: center; padding: 12px; border-radius: 10px; color: var(--ink-2); }
.step.on { background: var(--paper-2); color: var(--ink); border: 1px solid var(--line); }
.step .n { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid var(--line-2); display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.step.on .n { background: var(--orange); border-color: var(--orange); color: var(--on-orange); font-weight: 700; }
.step.done .n { background: var(--side-ok); border-color: var(--side-ok); color: var(--on-orange); }
.st { display: flex; flex-direction: column; gap: 2px; }
.st b { font-size: 14px; }
.st small { font-size: 12px; color: var(--ink-3); }
.plats { margin-top: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.muted-l { font-size: 12px; color: var(--ink-3); }
.right { flex: 1; min-width: 0; overflow-y: auto; padding: 44px 52px; display: flex; flex-direction: column; align-items: center; }
.form { width: 520px; max-width: 100%; margin: auto 0; flex-shrink: 0; padding: 34px; border-radius: 12px; box-shadow: 8px 8px 0 var(--ink); display: flex; flex-direction: column; gap: 20px; }
.dual-auth { gap: 12px; padding: 24px; }
.wide { width: 100%; max-width: 920px; display: flex; flex-direction: column; gap: 18px; margin: auto 0; }
.title { display: flex; flex-direction: column; gap: 8px; }
.title h2 { font-size: 26px; font-weight: 900; }
.small { font-size: 12px; }
.strong-label { font-size: 14px; font-weight: 500; color: var(--ink); gap: 8px; }
.note { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); }
.dir { display: flex; gap: 8px; align-items: center; }
.dir .input { min-width: 0; text-overflow: ellipsis; }
.pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.pc { padding: 14px; display: flex; flex-direction: column; gap: 10px; opacity: .72; }
.pc.on { opacity: 1; border: 1.5px solid var(--ink); }
.pc-h { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; cursor: pointer; text-align: left; font-size: 15px; }
.pc-h b { flex: 1; }
.cb { width: 20px; height: 20px; border-radius: 5px; border: 1.5px solid var(--line-2); display: flex; align-items: center; justify-content: center; }
.cb.on { background: var(--orange); border-color: var(--orange); color: var(--on-orange); }
.pc-b { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; }
.region { font-size: 11px; color: var(--orange-text); text-align: right; }
.nav { display: flex; align-items: center; gap: 10px; }
.sp { flex: 1; }
.qopts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.qopt { padding: 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--card); display: flex; flex-direction: column; gap: 4px; align-items: flex-start; cursor: pointer; }
.qopt small { font-size: 12px; color: var(--ink-3); }
.qopt.on { border-color: var(--ink); background: var(--orange-soft); }
</style>
