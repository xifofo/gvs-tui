<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DRMStatus, DRMSystem } from '@shared/api'
import ConfirmDialog from './ConfirmDialog.vue'
import { errText, gvs, toast } from '../store'

type Row = { system: DRMSystem; title: string; ext: string; desc: string }

const ROWS: Row[] = [
  {
    system: 'widevine',
    title: 'Widevine 设备文件',
    ext: '.wvd',
    desc: 'friDay影音、HamiVideo、LINE TV、Disney+、Apple TV 获取内容密钥时使用。支持 L1 / L3；Disney+ 高画质与 Apple TV 4K / HDR 需要 L1。',
  },
  {
    system: 'playready',
    title: 'PlayReady 设备文件',
    ext: '.prd',
    desc: 'Apple TV 下载时使用（同时上传 .wvd 时优先使用 .prd）。支持 SL150 / SL2000 / SL3000，等级由网关读取文件得出。',
  },
]

const status = ref<DRMStatus | null>(null)
const loadError = ref('')
const busy = ref<DRMSystem | null>(null)
const confirmDelete = ref<Row | null>(null)

async function load(): Promise<void> {
  try {
    status.value = await gvs('drmStatus')
    loadError.value = ''
  } catch (e) {
    loadError.value = errText(e)
  }
}
onMounted(load)

function levelText(system: DRMSystem, level?: number): string {
  if (!level) return ''
  return system === 'widevine' ? `L${level}` : `SL${level}`
}

async function upload(row: Row): Promise<void> {
  busy.value = row.system
  try {
    const next = await gvs('uploadDRM', row.system)
    if (next) {
      status.value = next
      toast(`${row.title}已上传`, 'ok')
    }
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    busy.value = null
  }
}

async function remove(): Promise<void> {
  const row = confirmDelete.value
  confirmDelete.value = null
  if (!row) return
  busy.value = row.system
  try {
    status.value = await gvs('deleteDRM', row.system)
    toast(`${row.title}已删除`, 'ok')
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="card devices-card">
    <h2 class="h2s">设备文件</h2>
    <p class="intro">
      获取受保护内容的密钥需要你本人的设备文件，网关不提供共享设备。文件只上传到当前 API Key 名下并加密保存，
      不会出现在任何接口返回里，本机也不保留副本。没有上传时，相关平台下载会提示先上传。
    </p>
    <p v-if="loadError" class="load-error">{{ loadError }} <button type="button" class="btn sm outline" @click="load">重试</button></p>
    <div v-for="row in ROWS" :key="row.system" class="srow">
      <div class="sl">
        <span class="st">{{ row.title }} <span class="mono dim">{{ row.ext }}</span></span>
        <span class="sd">{{ row.desc }}</span>
      </div>
      <div class="sc">
        <template v-if="status?.[row.system].configured">
          <span v-if="status[row.system].reupload" class="chip warn" title="网关里保存的是旧格式文件，已不能使用">需重新上传</span>
          <span v-else class="chip ok">已上传 {{ levelText(row.system, status[row.system].level) }}</span>
          <span v-if="status[row.system].name" class="name mono" :title="status[row.system].name">{{ status[row.system].name }}</span>
        </template>
        <span v-else-if="status" class="chip warn">未上传</span>
        <button type="button" class="btn sm outline" :disabled="busy !== null" @click="upload(row)">
          <span v-if="busy === row.system" class="spin" />{{ status?.[row.system].configured ? '替换' : '上传' }}
        </button>
        <button
          v-if="status?.[row.system].configured"
          type="button"
          class="btn sm danger"
          :disabled="busy !== null"
          @click="confirmDelete = row"
        >删除</button>
      </div>
    </div>
    <ConfirmDialog
      v-if="confirmDelete"
      :title="`删除${confirmDelete.title}？`"
      message="删除后，需要该文件的平台将无法下载，直到重新上传。"
      confirm-text="删除"
      danger
      @confirm="remove"
      @cancel="confirmDelete = null"
    />
  </section>
</template>

<style scoped>
.intro { margin: 0; padding: 14px 20px 6px; font-size: 12.5px; line-height: 1.7; color: var(--ink-3); }
.load-error { margin: 6px 20px; font-size: 12.5px; color: var(--err); display: flex; align-items: center; gap: 10px; }
.sc { flex-wrap: wrap; justify-content: flex-end; }
.name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--ink-3); }
.dim { color: var(--ink-3); font-weight: 500; font-size: 12px; }
</style>
