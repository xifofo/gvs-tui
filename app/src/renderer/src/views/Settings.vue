<script setup lang="ts">
import HookSettingsCard from '../components/HookSettingsCard.vue'
import DeviceFilesCard from '../components/DeviceFilesCard.vue'
import IdentityInfo from '../integrations/plutofish/IdentityInfo.vue'
import RetentionSettings from '../integrations/plutofish/RetentionSettings.vue'
import { computed, reactive, ref, watch } from 'vue'
import { PROVIDER_NAME, type Provider, type SettingsPatch } from '@shared/api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Skeleton from '../components/Skeleton.vue'
import { back, errText, gvs, hasProvider, human, prefs, savePrefs, store, toast, type SettingsTab } from '../store'
import type { QualityCap, ThemePref } from '@shared/ui-prefs'

const QUALITY_OPTIONS: Array<{ value: QualityCap; label: string }> = [
  { value: 'best', label: '最高' }, { value: '2160', label: '4K' }, { value: '1080', label: '1080P' }, { value: '720', label: '720P' },
]

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'download', label: '下载' },
  { key: 'appearance', label: '外观与动效' },
  { key: 'gateway', label: '网关' },
  { key: 'devices', label: '设备文件' },
  { key: 'plutofish', label: 'PlutoFish' },
  { key: 'naming', label: '命名与刮削' },
  { key: 'about', label: '关于' },
]

const THEMES: Array<{ value: ThemePref; label: string; icon: string }> = [
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'system', label: '跟随系统', icon: 'system' },
]

const s = computed(() => store.state!.settings)
const form = reactive({
  host: '',
  desktopProxy: '',
  key: '',
  outDir: '',
  tmpDir: '',
  releaseGroup: '',
  tmdbKey: '',
  tmdbLang: '',
  threads: 4,
  tencentCookie: '',
  douyinCookie: '',
  iqCookie: '',
  iqProfile: '',
  hongguoNfo: true,
  huangguoNfo: true,
  hongguoFmt: 'mkv',
  huangguoFmt: 'mkv',
})
let lastSettings: Record<string, unknown> = {}
watch(() => store.state?.settings, next => {
  if (!next) return
  const draft = form as Record<string, unknown>
  for (const key of Object.keys(form)) {
    if (key === 'key') continue
    if (!(key in lastSettings) || draft[key] === lastSettings[key]) draft[key] = (next as unknown as Record<string, unknown>)[key] ?? draft[key]
  }
  lastSettings = { ...next }
}, { immediate: true })

const saving = ref('')
let saveQueue: Promise<void> = Promise.resolve()
async function save(patch: SettingsPatch, what: string) {
  const submitted = { ...patch }
  saveQueue = saveQueue.then(async () => {
    saving.value = what
    try {
      store.state = await gvs('saveSettings', submitted)
      if ('key' in submitted && form.key === submitted.key) form.key = ''
      toast('已保存', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      saving.value = ''
    }
  })
  await saveQueue
}

async function pickDir(which: 'out' | 'tmp') {
  const cur = which === 'tmp' ? form.tmpDir || form.outDir : form.outDir
  const dir = await gvs('chooseDir', cur || undefined)
  if (!dir) return
  await save(which === 'tmp' ? { tmpDir: dir } : { outDir: dir }, which)
}


function step(d: number) {
  form.threads = Math.min(16, Math.max(1, form.threads + d))
  void save({ threads: form.threads }, 'threads')
}

// ---- 缓存 ----
const cache = ref<{ posters: number; temp: number } | null>(null)
const cacheError = ref('')
async function loadCache() {
  cacheError.value = ''
  try {
    cache.value = await gvs('cacheInfo')
  } catch (e) {
    cacheError.value = errText(e)
  }
}
watch(
  () => store.view,
  (v) => {
    if (v === 'settings') void loadCache()
  },
  { immediate: true },
)
const clearing = ref(false)
const askClear = ref(false)
async function clearCache() {
  askClear.value = false
  clearing.value = true
  try {
    await gvs('clearCache')
    toast('缓存已清理', 'ok')
    await loadCache()
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    clearing.value = false
  }
}
const cacheText = computed(() => {
  const c = cache.value
  if (!c) return '正在统计…'
  return `海报 ${human(c.posters) || '0 B'} · 临时残留 ${human(c.temp) || '0 B'}`
})

// ---- 更新 ----
const upd = computed(() => store.update)
const updText = computed(() => {
  const u = upd.value
  if (!u) return '未检查'
  switch (u.status) {
    case 'checking': return '检查中…'
    case 'latest': return '已是最新'
    case 'available': return `新版本 ${u.version}`
    case 'downloading': return `下载中 ${u.percent}%`
    case 'ready': return `${u.version} 已就绪`
    case 'error': return '暂时无法检查'
    default: return '未检查'
  }
})
const updTone = computed(() => {
  const st = upd.value?.status
  return st === 'ready' || st === 'latest' ? 'ok' : st === 'available' || st === 'downloading' ? 'warn' : st === 'error' ? 'err' : ''
})
async function checkUpdate() {
  try {
    store.update = await gvs('checkUpdate')
  } catch (e) {
    toast(errText(e), 'err')
  }
}

const onSystemDrive = computed(() => store.state?.platform === 'win32' && /^c:[\\/]/i.test(form.outDir))
const tmpOnSystem = computed(() => !!form.tmpDir && store.state?.platform === 'win32' && /^c:[\\/]/i.test(form.tmpDir))
const tmpText = computed(() => form.tmpDir || '自动（下载目录所在盘）')
const tunnelText = computed(() => {
  const t = store.state!.tunnel
  if (!t.enabled) return { cls: '', text: '无需隧道' }
  return t.ok ? { cls: 'ok', text: '隧道正常' } : { cls: 'warn', text: t.err ? `隧道：${t.err}` : '隧道连接中' }
})
const plat = (p: Provider) => hasProvider(p)
</script>

<template>
  <div class="page">
    <button v-if="store.history.at(-1) === 'quality' || (store.history.at(-1) === 'detail' && store.qualityInline)" type="button" class="back" @click="back(store.history.at(-1))"><Icon name="back" :size="16" />返回画质选择</button>
    <h1 class="h1">设置</h1>

    <div class="cols">
      <nav class="tabs" aria-label="设置分类">
        <button v-for="t in TABS" :key="t.key" type="button" class="tab" :class="{ on: store.settingsTab === t.key }" :aria-current="store.settingsTab === t.key" @click="store.settingsTab = t.key">
          {{ t.label }}
        </button>
      </nav>

      <div class="panel">
        <!-- 下载 -->
        <section v-if="store.settingsTab === 'download'" class="card">
          <h2 class="h2s">下载</h2>

          <div class="srow">
            <div class="sl">
              <span class="st">保存到</span>
              <span class="sd mono mid" :title="form.outDir">{{ form.outDir || '未设置' }}</span>
              <span v-if="onSystemDrive" class="sd warn-text">当前在系统盘，大文件容易把系统盘占满。</span>
            </div>
            <div class="sc">
              <button type="button" class="btn sm" :disabled="saving === 'out'" @click="pickDir('out')"><span v-if="saving === 'out'" class="spin" />更改…</button>
              <button type="button" class="btn sm" :disabled="!form.outDir" @click="gvs('openPath', form.outDir)"><Icon name="folder" :size="15" />打开</button>
            </div>
          </div>

          <div class="srow">
            <div class="sl">
              <span class="st">临时目录</span>
              <span class="sd mono mid" :title="form.tmpDir">{{ tmpText }}</span>
              <span class="sd">下载分片、解密和封装的中间文件放这里；和下载目录同盘时完成后直接改名，最快。</span>
              <span v-if="tmpOnSystem" class="sd warn-text">临时目录在系统盘，会和下载目录之间来回拷贝大文件。</span>
            </div>
            <div class="sc">
              <button type="button" class="btn sm" :disabled="saving === 'tmp'" @click="pickDir('tmp')"><span v-if="saving === 'tmp'" class="spin" />更改…</button>
              <button type="button" class="btn sm" :disabled="!form.tmpDir" @click="save({ tmpDir: '' }, 'tmp')">恢复自动</button>
            </div>
          </div>

          <div class="srow">
            <div class="sl">
              <span class="st">分片并发</span>
              <span class="sd">同时下载的分片数，网络好可以调高。1 ~ 16。</span>
            </div>
            <div class="sc">
              <div class="stepper">
                <button type="button" aria-label="减少" @click="step(-1)">−</button>
                <span class="mono">{{ form.threads }}</span>
                <button type="button" aria-label="增加" @click="step(1)">+</button>
              </div>
            </div>
          </div>

          <div class="srow">
            <div class="sl">
              <span class="st">默认画质</span>
              <span class="sd">打开画质面板时自动选中的档位：不超过所选分辨率的最高画质。随时可以手动改。</span>
            </div>
            <div class="sc">
              <div class="seg qseg" role="radiogroup" aria-label="默认画质">
                <button v-for="q in QUALITY_OPTIONS" :key="q.value" type="button" role="radio" :aria-checked="prefs().defaultQuality === q.value" :class="{ on: prefs().defaultQuality === q.value }" @click="savePrefs({ defaultQuality: q.value })">{{ q.label }}</button>
              </div>
            </div>
          </div>

          <div class="srow">
            <div class="sl">
              <span class="st">缓存</span>
              <span class="sd">{{ cacheError || cacheText }}</span>
            </div>
            <div class="sc">
              <button type="button" class="btn sm" :disabled="clearing || !!cacheError" @click="askClear = true"><span v-if="clearing" class="spin" /><Icon v-else name="trash" :size="15" />清理</button>
            </div>
          </div>
        </section>
        <HookSettingsCard v-if="store.settingsTab === 'download'" />

        <!-- 网关 -->
        <section v-if="store.settingsTab === 'gateway'" class="card">
          <h2 class="h2s">网关</h2>
          <div class="srow wrap">
            <div class="sl"><span class="st">网关地址</span><span class="sd">地址和 Key 找网关管理员要，只保存在这台电脑上。</span></div>
            <div class="field-full"><input v-model="form.host" class="input mono" autocomplete="off" /></div>
          </div>
          <div class="srow wrap">
            <div class="sl"><span class="st">API Key</span><span class="sd">换 Key 时填新的，留空则保持不变。</span></div>
            <div class="field-full"><input v-model="form.key" class="input mono" :placeholder="s.keyMasked || 'sk_live_…'" autocomplete="off" /></div>
          </div>
          <div class="srow wrap">
            <div class="sl"><label class="st" for="desktop-proxy">代理地址</label><span class="sd">填写 HTTP/HTTPS 代理地址和端口，留空使用系统代理。用于网关、隧道、TMDB、IQ 海外版以及 friDay／LINE TV 的登录与取流。</span></div>
            <div class="field-full"><input id="desktop-proxy" v-model="form.desktopProxy" class="input mono" placeholder="http://127.0.0.1:7890（留空使用系统代理）" autocomplete="off" spellcheck="false" /></div>
          </div>
          <div class="srow">
            <div class="sl">
              <span class="st">状态</span>
              <span class="sd">保存后会断开重连一次。</span>
            </div>
            <div class="sc">
              <span class="chip ok">{{ store.state!.keyName || '已连接' }}</span>
              <span class="chip" :class="tunnelText.cls">{{ tunnelText.text }}</span>
              <button type="button" class="btn sm outline" :disabled="saving === 'gw' || (form.host === s.host && form.desktopProxy === s.desktopProxy && !form.key)" @click="save({ host: form.host, key: form.key || undefined, desktopProxy: form.desktopProxy }, 'gw')">
                <span v-if="saving === 'gw'" class="spin" />保存并重连
              </button>
            </div>
          </div>
        </section>

        <!-- 外观 -->
        <section v-else-if="store.settingsTab === 'appearance'" class="card">
          <h2 class="h2s">外观与动效</h2>
          <div class="srow">
            <div class="sl">
              <span class="st">主题</span>
              <span class="sd">默认深色；「跟随系统」会随 Windows 的浅色 / 深色模式自动切换。</span>
            </div>
            <div class="sc">
              <div class="seg acc" role="radiogroup" aria-label="主题">
                <button v-for="t in THEMES" :key="t.value" type="button" role="radio" :aria-checked="prefs().theme === t.value" :class="{ on: prefs().theme === t.value }" @click="savePrefs({ theme: t.value })"><Icon :name="t.icon" :size="15" />{{ t.label }}</button>
              </div>
            </div>
          </div>
          <div class="srow">
            <div class="sl">
              <span class="st">背景光效与动画</span>
              <span class="sd">背景粒子光晕、页面切换和列表入场动画。系统开启「减少动态效果」时始终关闭；窗口隐藏时自动暂停，不占 CPU。</span>
            </div>
            <div class="sc">
              <label class="toggle"><input type="checkbox" :checked="prefs().motion" aria-label="背景光效与动画" @change="savePrefs({ motion: ($event.target as HTMLInputElement).checked })" /><span class="track"><span class="knob" /></span></label>
            </div>
          </div>
        </section>

        <!-- 命名与刮削 -->
        <section v-else-if="store.settingsTab === 'naming'" class="card">
          <h2 class="h2s">命名与刮削</h2>

          <div class="srow">
            <div class="sl"><span class="st">发布组</span><span class="sd">文件名结尾的组名后缀；新下载的 MKV 同步写入 GROUP 标签。</span></div>
            <div class="sc"><input v-model="form.releaseGroup" class="input" style="width: 200px" @change="save({ releaseGroup: form.releaseGroup }, 'rg')" /></div>
          </div>

          <div class="srow wrap">
            <div class="sl"><span class="st">TMDB API Key</span><span class="sd">填了 Key，优酷、腾讯和 IQ 海外版下载时会自动匹配 TMDB，按 Jellyfin/Plex 的习惯命名。</span></div>
            <div class="field-full"><input v-model="form.tmdbKey" class="input mono" autocomplete="off" @change="save({ tmdbKey: form.tmdbKey }, 'tk')" /></div>
          </div>

          <div class="srow">
            <div class="sl"><span class="st">TMDB 语言</span><span class="sd">刮削时优先取的标题语言。</span></div>
            <div class="sc"><input v-model="form.tmdbLang" class="input mono" style="width: 160px" @change="save({ tmdbLang: form.tmdbLang }, 'tl')" /></div>
          </div>

          <template v-for="p in (['hongguo', 'huangguo'] as Provider[]).filter(plat)" :key="p">
            <div class="srow">
              <div class="sl"><span class="st acct"><PlatformLogo :provider="p" :size="18" />{{ PROVIDER_NAME[p] }}写入 NFO</span><span class="sd">生成供 Jellyfin / Emby 读取的元数据文件。</span></div>
              <div class="sc">
                <label class="toggle">
                  <input :checked="p === 'hongguo' ? form.hongguoNfo : form.huangguoNfo" type="checkbox" @change="(e) => save(p === 'hongguo' ? { hongguoNfo: (e.target as HTMLInputElement).checked } : { huangguoNfo: (e.target as HTMLInputElement).checked }, p === 'hongguo' ? 'hn' : 'yn')" />
                  <span class="track"><span class="knob" /></span>
                </label>
              </div>
            </div>
            <div class="srow">
              <div class="sl"><span class="st">{{ PROVIDER_NAME[p] }}封装格式</span><span class="sd">MKV 兼容性最好，MP4 更通用。</span></div>
              <div class="sc">
                <div class="seg" style="width: 180px">
                  <button v-for="f in ['mkv', 'mp4']" :key="f" type="button" :class="{ on: (p === 'hongguo' ? form.hongguoFmt : form.huangguoFmt) === f }" @click="save(p === 'hongguo' ? { hongguoFmt: f } : { huangguoFmt: f }, p === 'hongguo' ? 'hf' : 'yf')">{{ f.toUpperCase() }}</button>
                </div>
              </div>
            </div>
          </template>
        </section>

        <!-- 设备文件 -->
        <DeviceFilesCard v-else-if="store.settingsTab === 'devices'" />

        <div v-else-if="store.settingsTab === 'plutofish'">
          <IdentityInfo :connection="store.state?.plutofish" />
          <RetentionSettings />
        </div>

        <!-- 关于 -->
        <section v-else-if="store.settingsTab !== 'download'" class="card">
          <h2 class="h2s">关于</h2>
          <div class="srow">
            <div class="sl"><span class="st">版本</span><span class="sd mono">GVS {{ store.state!.version }} · {{ store.state!.platform }}</span></div>
            <div class="sc"><span class="chip" :class="updTone">{{ updText }}</span></div>
          </div>
          <div v-if="upd?.status === 'downloading'" class="srow"><div class="sl"><div class="progress"><div :style="{ width: upd.percent + '%' }" /></div></div></div>
          <div class="srow">
            <div class="sl"><span class="st">更新</span><span class="sd">{{ upd?.auto ? '有新版本会自动下载，下次退出时安装。' : '有新版本时会在这里提示。' }}</span></div>
            <div class="sc">
              <button type="button" class="btn sm" :disabled="upd?.status === 'checking' || upd?.status === 'downloading'" @click="checkUpdate">
                <span v-if="upd?.status === 'checking'" class="spin" />检查更新
              </button>
              <button v-if="upd?.status === 'ready'" type="button" class="btn sm outline" @click="gvs('installUpdate')">立即重启安装</button>
              <button v-else-if="upd?.url" type="button" class="btn sm outline" @click="gvs('installUpdate')">打开发布页</button>
            </div>
          </div>
          <div v-if="upd?.message" class="srow"><p class="update-note" role="status">{{ upd.message }}</p></div>
          <div class="srow">
            <div class="sl"><span class="st">媒体工具</span><span class="sd">下载、解密和封装都要用到，缺哪个会在任务里报错。</span></div>
          </div>
          <div v-for="t in store.state!.tools" :key="t.name" class="srow tool">
            <div class="sl"><span class="st acct"><Icon :name="t.ok ? 'check' : 'x'" :size="15" :stroke="2.5" :style="{ color: t.ok ? 'var(--ok)' : 'var(--err)' }" />{{ t.name }}</span></div>
            <div class="sc"><span class="muted small">{{ t.note }}</span></div>
          </div>
          <div v-if="!store.state!.tools.length" class="srow"><div class="sl"><span class="sd row"><span class="spin" />检查中…</span></div></div>
        </section>
      </div>
    </div>

    <ConfirmDialog
      v-if="askClear"
      title="清理缓存？"
      :message="cacheText"
      confirm-text="清理"
      checkbox="同时删掉没有任务在用的临时残留"
      @confirm="clearCache"
      @cancel="askClear = false"
    />
  </div>
</template>

<style scoped>
.cols { display: flex; gap: 28px; align-items: flex-start; }
.tabs { width: 156px; flex-shrink: 0; position: sticky; top: 0; display: flex; flex-direction: column; gap: 4px; }
.tab {
  height: 38px; padding: 0 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--ink-2);
  font-size: 13.5px; font-weight: 700; text-align: left; cursor: pointer; transition: background var(--ui-duration-fast), color var(--ui-duration-fast);
}
.tab:hover { background: var(--paper-2); color: var(--ink); }
.tab.on { background: var(--paper-2); color: var(--ink); border-color: var(--line); box-shadow: var(--ui-inset); }
.tab.on::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--orange); margin-right: 8px; vertical-align: 2px; box-shadow: 0 0 8px rgb(var(--ui-accent-channel) / 70%); }
.panel { flex-grow: 1; min-width: 0; max-width: 760px; }
.card { overflow: hidden; }
/* :deep so the rule also reaches cards rendered by child components (设备文件、下载钩子). */
.card > :deep(.h2s) { padding: 18px 20px 14px; border-bottom: 1px solid var(--line); }
.small { font-size: 13px; }
.row { display: flex; align-items: center; gap: 8px; }
.acct { display: flex; align-items: center; gap: 8px; }
.srow.wrap { flex-wrap: wrap; }
.field-full { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.field-act { display: flex; justify-content: flex-end; }
textarea.input { height: 72px; }
.stepper { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); display: flex; align-items: center; }
.stepper button { width: 34px; height: 34px; border: 0; background: transparent; font-size: 17px; cursor: pointer; }
.stepper span { flex-grow: 1; min-width: 34px; text-align: center; font-size: 15px; }
.warn-text { color: var(--orange-text); }
.update-note { color: var(--ink-2); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.tool .st { font-weight: 500; }
@media (max-width: 1100px) {
  .cols { gap: 18px; }
  .tabs { width: 160px; }
}
.qseg { width: 300px; }
</style>
