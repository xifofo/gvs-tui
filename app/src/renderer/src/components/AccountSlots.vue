<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AccountSlot, Provider } from '@shared/api'
import { supportsCookieSlot } from '@shared/accounts'
import { accountsOf, errText, gvs, store, toast } from '../store'
import Icon from './Icon.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ provider: Provider }>()
const slots = computed(() => accountsOf(props.provider))
const book = computed(() => store.accounts?.book)
const isDefault = (s: AccountSlot) => book.value?.defaults[props.provider] === s.id
const isActive = (s: AccountSlot) => book.value?.active[props.provider] === s.id
const cookieOk = computed(() => supportsCookieSlot(props.provider))
const canEncrypt = computed(() => store.accounts?.encryption !== false)

const adding = ref(false)
const name = ref('')
const cookie = ref('')
const busy = ref('')
const renaming = ref('')
const renameText = ref('')
const removing = ref<AccountSlot | null>(null)
const recookie = ref('')
const recookieText = ref('')

async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
  busy.value = key
  try { await fn(); if (ok) toast(ok, 'ok') } catch (e) { toast(errText(e), 'err') } finally { busy.value = '' }
}
async function add(viaCookie: boolean) {
  await run('add', async () => {
    const r = await gvs('addAccount', props.provider, name.value, viaCookie ? cookie.value : undefined)
    toast(r.needsLogin ? '已添加账号：请用上方的登录方式扫码，登录结果会记到这个账号' : '已添加并切换到新账号', 'ok')
    adding.value = false; name.value = ''; cookie.value = ''
  })
}
async function activate(s: AccountSlot) {
  await run(s.id, async () => {
    const r = await gvs('activateAccount', s.id)
    toast(r.needsLogin ? `已切换到「${s.name}」：这个账号是扫码登录的，请重新扫码` : `已切换到「${s.name}」`, r.needsLogin ? 'warn' : 'ok')
  })
}
const expiry = (s: AccountSlot) => {
  const t = s.status?.vipUntil
  if (!t) return ''
  const d = new Date(t)
  const left = Math.ceil((t - Date.now()) / 86400e3)
  return `会员至 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${left < 0 ? '（已过期）' : left <= 7 ? `（剩 ${left} 天）` : ''}`
}
const modeText = { cookie: 'Cookie · 可一键切换', qr: '扫码 · 切换需重新扫码', gateway: '网关会话（迁移自单账号）' }
</script>

<template>
  <div class="slots">
    <div v-for="s in slots" :key="s.id" class="slot" :class="{ on: isActive(s) }">
      <span class="av"><Icon name="user" :size="16" /></span>
      <div class="sm">
        <template v-if="renaming === s.id">
          <form class="rn" @submit.prevent="run('rn', () => gvs('renameAccount', s.id, renameText)).then(() => (renaming = ''))">
            <input v-model="renameText" class="input" maxlength="40" aria-label="账号名称" />
            <button type="submit" class="btn sm">保存</button><button type="button" class="btn sm" @click="renaming = ''">取消</button>
          </form>
        </template>
        <b v-else>{{ s.name }}<span v-if="isDefault(s)" class="chip tiny">默认</span><span v-if="isActive(s)" class="chip ok tiny">当前生效</span></b>
        <span class="muted small">{{ modeText[s.mode] }}</span>
        <span v-if="s.status" class="small" :class="s.status.tone === 'err' ? 'err' : s.status.tone === 'ok' ? 'okc' : 'muted'">{{ s.status.short }} · {{ s.status.summary }}</span>
        <span v-if="expiry(s)" class="small vip">{{ expiry(s) }}</span>
        <form v-if="recookie === s.id" class="rn" @submit.prevent="run('rc', () => gvs('updateAccountCookie', s.id, recookieText), '已更新 Cookie').then(() => { recookie = ''; recookieText = '' })">
          <input v-model="recookieText" class="input mono" placeholder="粘贴新的 Cookie" aria-label="新的 Cookie" />
          <button type="submit" class="btn sm" :disabled="!recookieText.trim()">导入</button>
        </form>
      </div>
      <div class="sa">
        <button v-if="!isActive(s)" type="button" class="btn sm" :disabled="!!busy" @click="activate(s)">{{ busy === s.id ? '切换中…' : '切换' }}</button>
        <button v-if="!isDefault(s)" type="button" class="btn sm" :disabled="!!busy" title="订阅和下载默认用这个账号" @click="run('d', () => gvs('setDefaultAccount', s.id), `已把「${s.name}」设为默认`)">设为默认</button>
        <button type="button" class="btn sm icon" title="重命名" aria-label="重命名" @click="renaming = s.id; renameText = s.name"><Icon name="file" :size="14" /></button>
        <button v-if="cookieOk && canEncrypt" type="button" class="btn sm icon" title="更新 Cookie" aria-label="更新 Cookie" @click="recookie = recookie === s.id ? '' : s.id"><Icon name="link" :size="14" /></button>
        <button v-if="slots.length > 1" type="button" class="btn sm icon" title="删除账号" aria-label="删除账号" @click="removing = s"><Icon name="trash" :size="14" /></button>
      </div>
    </div>

    <form v-if="adding" class="add card" @submit.prevent="add(!!cookie.trim())">
      <label class="field">名称<input v-model="name" class="input" maxlength="40" placeholder="例如：家庭会员号" /></label>
      <label v-if="cookieOk" class="field">Cookie（可选）<textarea v-model="cookie" class="input mono ta" rows="3" :disabled="!canEncrypt" :placeholder="canEncrypt ? '粘贴 Cookie：本机加密保存，可一键切换、失败时自动换号' : '系统密钥环不可用，无法保存 Cookie，请扫码'" /></label>
      <div class="aa">
        <button type="button" class="btn sm" @click="adding = false">取消</button>
        <button v-if="cookieOk && cookie.trim()" type="submit" class="btn sm primary" :disabled="busy === 'add'">导入并切换</button>
        <button v-else type="button" class="btn sm primary" :disabled="busy === 'add'" @click="add(false)">添加并扫码登录</button>
      </div>
    </form>
    <button v-else type="button" class="btn sm" @click="adding = true">＋ 添加另一个账号</button>
    <p class="muted small">网关每个平台同一时间只有一个生效会话：切换账号会把该账号的 Cookie 重新导入网关；扫码账号切换时需重新扫码。</p>

    <ConfirmDialog v-if="removing" title="删除账号" :message="`删除「${removing.name}」？本机保存的 Cookie 会一起删除，网关当前会话不受影响。`" confirm-text="删除" danger
      @confirm="run('rm', () => gvs('removeAccount', removing!.id)); removing = null" @cancel="removing = null" />
  </div>
</template>

<style scoped>
.slots { display: flex; flex-direction: column; gap: 8px; }
.slot { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
.slot.on { border-color: var(--ok); background: #f6fbf7; }
.av { width: 30px; height: 30px; border-radius: 50%; background: var(--paper-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sm { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.sm b { display: flex; gap: 6px; align-items: center; }
.sa { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 190px; }
.sa .btn { white-space: nowrap; }
.tiny { height: 18px; padding: 0 6px; font-size: 11px; }
.small { font-size: 12px; }
.err { color: var(--err); } .okc { color: var(--ok); } .vip { color: var(--orange-text); }
.rn { display: flex; gap: 6px; }
.rn .input { height: 32px; }
.add { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.ta { height: auto; padding: 8px 12px; resize: vertical; }
.aa { display: flex; gap: 8px; justify-content: flex-end; }
.slots > .btn { align-self: flex-start; }
</style>
