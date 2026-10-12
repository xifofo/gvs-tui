<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { QRPoll, QRStart } from '@shared/api'
import { errText, gvs, store, toast } from '../store'
import Icon from './Icon.vue'
import PlatformLogo from './PlatformLogo.vue'
import { useDialogFocus } from '../dialog-focus'

const kind = store.qr!
const miguTerminal = store.miguQrTerminal
const title = kind === 'migu' ? (miguTerminal === 'tv' ? '扫码登录咪咕 TV（咪视界）' : '扫码登录咪咕 App') : kind === 'mgtv' ? '扫码登录芒果 TV' : kind === 'bilibili' ? '扫码登录哔哩哔哩' : kind === 'iqcn' ? '扫码登录爱奇艺国内版' : kind === 'youku' ? '扫码登录优酷' : '扫码登录腾讯视频'
const start = ref<QRStart | null>(null)
const status = ref<QRPoll>({ done: false, message: '正在获取二维码…', tone: 'muted' })
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null
let busy = false
let active = true
let generation = 0
const dialog = ref<HTMLElement | null>(null)
useDialogFocus(dialog, close)

async function load() {
  stop()
  const current = ++generation
  error.value = ''
  start.value = null
  status.value = { done: false, message: '正在获取二维码…', tone: 'muted' }
  try {
    let response: QRStart
    if (kind === 'mgtv' || kind === 'migu') {
      const view = await gvs('providerSession',{provider:kind,op:'start',...(kind === 'migu' ? {terminal:miguTerminal} : {})})
      if (!view.qrDataUrl) throw new Error('网关没有返回二维码图片')
      response = {images:[{title:kind==='migu' ? '咪咕视频 App 扫码' : '芒果 TV App 扫码',image:view.qrDataUrl}],hint:view.summary}
    } else response = kind === 'bilibili' ? await gvs('bilibiliQrStart') : kind === 'iqcn' ? await gvs('iqcnQrStart') : kind === 'youku' ? await gvs('youkuQrStart') : await gvs('tencentQrStart')
    if (!active || current !== generation) return
    start.value = response
    status.value = { done: false, message: '等待扫码…', tone: 'muted' }
    timer = setInterval(poll, kind === 'mgtv' || kind === 'migu' ? 3000 : kind === 'iqcn' || kind === 'bilibili' ? 2000 : kind === 'youku' ? 1500 : 3500)
  } catch (e) {
    if (active && current === generation) error.value = errText(e)
  }
}

async function poll() {
  if (busy || !active) return
  const current = generation
  busy = true
  try {
    let r: QRPoll
    if (kind === 'mgtv' || kind === 'migu') {
      const view = await gvs('providerSession',{provider:kind,op:'poll',...(kind === 'migu' ? {terminal:miguTerminal} : {})})
      r = {done:view.authenticated,message:view.summary,tone:view.authenticated ? 'ok' : ['expired','denied'].includes(view.state) ? 'warn' : 'muted'}
    } else r = kind === 'bilibili' ? await gvs('bilibiliQrPoll') : kind === 'iqcn' ? await gvs('iqcnQrPoll') : kind === 'youku' ? await gvs('youkuQrPoll') : await gvs('tencentQrPoll')
    if (!active || current !== generation) return
    status.value = r
    if (r.done) {
      stop()
      toast(r.message, 'ok')
      close()
    } else if (r.tone === 'warn') stop()
  } catch (e) {
    if (!active || current !== generation) return
    status.value = { done: false, message: errText(e), tone: 'warn' }
    stop()
  } finally {
    busy = false
  }
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

function close() {
  active = false
  ++generation
  stop()
  void gvs('qrCancel').catch(() => {})
  store.qr = null
}

onMounted(() => {
  void load()
})
onBeforeUnmount(() => {
  active = false
  ++generation
  stop()
})
</script>

<template>
  <div class="scrim" @click.self="close">
    <div ref="dialog" class="dlg" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
      <div class="head">
        <PlatformLogo :provider="kind" :size="26" />
        <h1 class="title">{{ title }}</h1>
        <button type="button" class="btn sm icon" aria-label="关闭" @click="close"><Icon name="x" :size="16" /></button>
      </div>

      <div v-if="error" class="error-box">{{ error }}</div>
      <div v-else-if="!start" class="loading"><span class="spin" /> 正在获取二维码…</div>
      <div v-else class="codes" :class="{ two: start.images.length > 1 }">
        <figure v-for="img in start.images" :key="img.title" class="code">
          <div class="frame"><img :src="img.image" :alt="img.title + ' 二维码'" /></div>
          <figcaption v-if="start.images.length > 1">{{ img.title }}</figcaption>
        </figure>
      </div>

      <div v-if="start" class="status" :class="status.tone">
        <span v-if="status.tone === 'muted'" class="spin" />
        {{ status.message }}
      </div>
      <p v-if="start" class="hint">{{ start.hint }}</p>

      <div class="foot">
        <button type="button" class="btn sm" @click="load"><Icon name="refresh" :size="15" />刷新二维码</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(23, 24, 28, 0.45); display: flex; align-items: center; justify-content: center; z-index: 40; }
.dlg {
  width: 480px; max-width: calc(100vw - 48px); background: var(--paper); border: 1.5px solid var(--ink); border-radius: 12px;
  box-shadow: 8px 8px 0 var(--ink); padding: 26px; display: flex; flex-direction: column; align-items: center; gap: 18px;
}
.dlg:has(.two) { width: 640px; }
.head { align-self: stretch; display: flex; align-items: center; gap: 10px; }
.title { font-size: 21px; font-weight: 700; }
.head .btn { margin-left: auto; }
.loading { height: 240px; display: flex; align-items: center; gap: 10px; color: var(--ink-2); }
.codes { display: flex; gap: 24px; }
.code { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.frame { padding: 14px; background: var(--card); border: 1.5px solid var(--ink); border-radius: 12px; box-shadow: 6px 6px 0 var(--orange); }
.frame img { width: 220px; height: 220px; display: block; image-rendering: pixelated; }
figcaption { font-size: 14px; font-weight: 700; }
.status { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 500; }
.status.ok { color: var(--ok); }
.status.warn { color: var(--orange-text); }
.hint { font-size: 14px; color: var(--ink-2); text-align: center; line-height: 1.6; }
.foot { align-self: stretch; display: flex; justify-content: flex-end; }
.error-box { align-self: stretch; }
</style>
