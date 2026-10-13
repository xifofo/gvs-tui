<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PROVIDER_NAME, type HistoryEntry } from '@shared/api'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { copyText, errText, gvs, store, toast } from '../store'

defineOptions({ name: 'HistoryView' })

const PAGE = 30
const items = ref<HistoryEntry[]>([])
const total = ref(0)
const text = ref('')
const provider = ref('')
const page = ref(0)
const loading = ref(false)
const error = ref('')
const hashing = ref(new Set<number>())
const askRemove = ref<HistoryEntry | null>(null)

const providers = computed(() => store.state?.providers ?? [])
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await gvs('history', { text: text.value, provider: provider.value || undefined, limit: PAGE, offset: page.value * PAGE })
    items.value = r.items
    total.value = r.total
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(text, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 0; void load() }, 250) })
watch([provider, page], () => void load())
onMounted(load)
// 新完成的任务进来时刷新
watch(() => store.jobs.filter((j) => j.state === 'done').length, () => void load())

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b > 0 ? `${(b / 1024 ** 2).toFixed(1)} MB` : '—')
const when = (ms: number) => new Date(ms).toLocaleString('zh-CN', { hour12: false })
const base = (p: string) => p.split(/[\\/]/).pop() || p

async function ed2k(e: HistoryEntry) {
  if (e.ed2kLink) return copyText(e.ed2kLink, '已复制 ed2k 链接')
  hashing.value.add(e.id)
  try {
    const link = await gvs('computeEd2k', e.id)
    e.ed2kLink = link
    await copyText(link, 'ed2k 已算好并复制')
  } catch (err) {
    toast(errText(err), 'err')
  } finally {
    hashing.value.delete(e.id)
  }
}
async function remove() {
  const e = askRemove.value
  askRemove.value = null
  if (!e) return
  try { await gvs('removeHistory', e.id); await load() } catch (err) { toast(errText(err), 'err') }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="h1">下载历史</h1>
      <span class="muted">{{ total }} 集 · 本地文件删掉后仍记为已下载，订阅不会重复下载</span>
    </div>
    <div class="tools">
      <label class="sbox"><Icon name="search" :size="16" /><input v-model="text" placeholder="搜索剧名、集标题或文件路径" aria-label="搜索下载历史" /></label>
      <select v-model="provider" class="qsel" aria-label="按平台筛选">
        <option value="">全部平台</option>
        <option v-for="p in providers" :key="p" :value="p">{{ PROVIDER_NAME[p] }}</option>
      </select>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="!items.length && !loading" class="empty card"><Icon name="history" :size="30" /><span>{{ text || provider ? '没有匹配的记录' : '还没有下载记录。下载完成的每一集都会记在这里。' }}</span></div>

    <div v-else class="list">
      <div v-for="e in items" :key="e.id" class="card hrow">
        <PlatformLogo :provider="e.provider" :size="28" />
        <div class="hi">
          <div class="ht"><b>{{ e.showTitle }}</b><span class="mono lbl">{{ e.label }}</span><span v-if="e.title" class="muted small clip">{{ e.title }}</span></div>
          <div class="muted small meta">
            <span>{{ e.quality }}</span><span v-if="e.audio">· {{ e.audio }}</span><span>· {{ size(e.size) }}</span><span>· {{ when(e.completedAt) }}</span>
          </div>
          <div class="mono small path" :title="e.filePath">{{ base(e.filePath) }}</div>
          <div v-if="e.ed2kLink" class="mono tiny ed2k" :title="e.ed2kLink">{{ e.ed2kLink }}</div>
        </div>
        <div class="ha">
          <button type="button" class="btn sm" :disabled="hashing.has(e.id)" :title="e.ed2kLink ? '复制 ed2k 链接' : '计算并复制 ed2k 链接'" @click="ed2k(e)">
            <span v-if="hashing.has(e.id)" class="spin" /><Icon v-else :name="e.ed2kLink ? 'copy' : 'hash'" :size="15" />{{ e.ed2kLink ? '复制 ed2k' : '计算 ed2k' }}
          </button>
          <button v-if="e.filePath" type="button" class="btn sm icon" title="打开所在文件夹" aria-label="打开所在文件夹" @click="gvs('showItem', e.filePath).catch((x) => toast(errText(x), 'err'))"><Icon name="folder" :size="16" /></button>
          <button type="button" class="btn sm icon" title="删除这条记录（不删文件）" aria-label="删除记录" @click="askRemove = e"><Icon name="trash" :size="15" /></button>
        </div>
      </div>
      <div v-if="pages > 1" class="pager">
        <button type="button" class="btn sm" :disabled="page === 0" @click="page--"><Icon name="left" :size="14" />上一页</button>
        <span class="mono muted">{{ page + 1 }} / {{ pages }}</span>
        <button type="button" class="btn sm" :disabled="page >= pages - 1" @click="page++">下一页<Icon name="right" :size="14" /></button>
      </div>
    </div>

    <ConfirmDialog
      v-if="askRemove" title="删除这条下载记录？" :message="`《${askRemove.showTitle}》${askRemove.label} 会重新显示为未下载，订阅可能再次下载它。本地文件不会被删除。`"
      confirm-text="删除记录" danger @confirm="remove" @cancel="askRemove = null"
    />
  </div>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.tools { display: flex; gap: 8px; align-items: center; }
.sbox { flex: 1; max-width: 420px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); }
.sbox input { flex: 1; border: 0; outline: 0; background: transparent; color: inherit; font-size: 14px; }
.qsel { height: 34px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); color: inherit; padding: 0 8px; }
.list { display: flex; flex-direction: column; gap: 8px; }
.hrow { display: flex; align-items: center; gap: 14px; padding: 12px 14px; }
.hi { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ht { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.lbl { font-size: 12px; color: var(--orange-text); }
.clip, .path, .ed2k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.meta { display: flex; gap: 6px; flex-wrap: wrap; }
.small { font-size: 12px; }
.tiny { font-size: 11px; color: var(--ink-3); }
.ha { display: flex; gap: 6px; flex-shrink: 0; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px; color: var(--ink-3); }
.pager { display: flex; justify-content: center; align-items: center; gap: 12px; padding: 8px; }
</style>
