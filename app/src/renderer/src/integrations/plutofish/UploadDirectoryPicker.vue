<!-- 在发布端绑定源网盘内浏览或显式创建输出目录；仅核验成功后改变上传位置。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PublisherDirectoryPage } from '@shared/api'
import Icon from '../../components/Icon.vue'
import { useDialogFocus } from '../../dialog-focus'
import { errText, gvs, store } from '../../store'

const props = defineProps<{ sourceAccountId: string; sourceName: string; directoryId: string; outputFolders?: string[]; creation?: { folders: string[]; existingWorkId?: string; seasonFolder?: string } }>()
const emit = defineEmits<{ cancel: []; select: [directory: { id: string; path: string }]; created: [result: { page: PublisherDirectoryPage; parent: { id: string; path: string } }]; busy: [value: boolean] }>()
const dialog = ref<HTMLElement | null>(null)
const page = ref<PublisherDirectoryPage | null>(null)
const busy = ref(false)
const error = ref('')
const creating = ref(false)
const createError = ref('')
const current = computed(() => page.value?.path.at(-1))
const parent = computed(() => page.value?.path.at(-2))
const path = computed(() => '/' + (page.value?.path.slice(1).map(d => d.name).join('/') ?? ''))
let sequence = 0
let requested = { id: props.directoryId, cursor: '' }
// 当前已经位于作品/季目录时只补缺失层级，避免再次打开后重复嵌套。
const remainingFolders = computed(() => {
  const names = props.outputFolders ?? []
  const currentNames = page.value?.path.slice(1).map(d => d.name) ?? []
  for (let count = names.length; count > 0; count--) {
    if (currentNames.length >= count && names.slice(0, count).every((name, i) => currentNames[currentNames.length - count + i] === name)) return names.slice(count)
  }
  return names
})
const createFoldersHere = computed(() => props.creation ? (current.value?.id === props.creation.existingWorkId && props.creation.seasonFolder ? [props.creation.seasonFolder] : props.creation.folders) : remainingFolders.value)
const creationPath = computed(() => [path.value.replace(/\/$/, ''), ...createFoldersHere.value].join('/'))
function cancel() { if (!creating.value) emit('cancel') }
useDialogFocus(dialog, cancel)

async function createFolders() {
  if (busy.value || error.value || !current.value || !createFoldersHere.value.length) return
  const request = ++sequence, selectedParent = { id: current.value.id, path: path.value }, folders = [...createFoldersHere.value]
  busy.value = true
  creating.value = true
  emit('busy', true)
  createError.value = ''
  try {
    const next = await gvs('createPublisherDirectories', props.sourceAccountId, selectedParent.id, folders)
    if (request !== sequence) return
    page.value = next
    if (props.creation) emit('created', { page: next, parent: selectedParent })
    else emit('select', { id: next.path.at(-1)!.id, path: '/' + next.path.slice(1).map(d => d.name).join('/') })
  } catch (e) {
    if (request === sequence) createError.value = errText(e)
  } finally {
    if (request === sequence) { busy.value = false; creating.value = false; emit('busy', false) }
  }
}

async function load(id: string, cursor = '') {
  const request = ++sequence
  requested = { id, cursor }
  busy.value = true
  error.value = ''
  createError.value = ''
  try {
    const next = await gvs('publisherDirectories', props.sourceAccountId, id, cursor)
    if (request !== sequence) return
    if (cursor && page.value && current.value?.id === id) {
      // 下一页使用服务端当前路径；去重避免供应商分页期间目录移动产生重复行。
      const items = new Map(page.value.items.map(d => [d.id, d]))
      for (const item of next.items) items.set(item.id, item)
      page.value = { ...next, items: [...items.values()] }
    } else page.value = next
  } catch (e) {
    if (request === sequence) error.value = errText(e)
  } finally {
    if (request === sequence) busy.value = false
  }
}

function select() {
  if (!busy.value && !error.value && current.value) emit('select', { id: current.value.id, path: path.value })
}

onMounted(() => { store.dialogCount++; void load(props.directoryId) })
onBeforeUnmount(() => { ++sequence; store.dialogCount--; emit('busy', false) })
</script>

<template>
  <Teleport to="body">
    <div class="directory-scrim" @click.self="cancel">
      <section ref="dialog" class="directory-dialog" role="dialog" aria-modal="true" :aria-label="creation ? '选择创建上级目录' : '选择 115 上传目录'" tabindex="-1">
        <header>
          <div><h2>{{ creation ? '选择创建上级目录' : '选择 115 上传目录' }}</h2><p class="small muted">{{ sourceName }}</p></div>
          <button class="btn sm icon" type="button" aria-label="关闭目录选择" data-dialog-cancel :disabled="creating" @click="cancel"><Icon name="x" /></button>
        </header>
        <nav class="breadcrumbs" aria-label="当前网盘路径">
          <button type="button" class="crumb" :disabled="busy" @click="load('0')">根目录</button>
          <template v-for="entry in page?.path.slice(1)" :key="entry.id">
            <span class="muted">/</span><button type="button" class="crumb" :disabled="busy" @click="load(entry.id)">{{ entry.name }}</button>
          </template>
        </nav>
        <div class="toolbar">
          <button class="btn sm" type="button" :disabled="busy || !parent" @click="parent && load(parent.id)"><Icon name="back" :size="15" />上一级</button>
          <button class="btn sm" type="button" :disabled="busy" @click="load(current?.id ?? props.directoryId)"><Icon name="refresh" :size="15" />刷新</button>
        </div>
        <div v-if="error" class="directory-error" role="alert">
          <span>{{ error }}</span><button class="btn sm" type="button" :disabled="busy" @click="load(requested.id, requested.cursor)">重试</button>
        </div>
        <div class="folders" :aria-busy="busy" aria-label="子文件夹">
          <p v-if="!page && busy" class="empty" role="status">正在读取文件夹…</p>
          <button v-for="entry in page?.items" :key="entry.id" class="folder" type="button" :disabled="busy" @click="load(entry.id)">
            <Icon name="folder" :size="20" /><span>{{ entry.name }}</span><Icon name="right" :size="16" />
          </button>
          <p v-if="page && !page.items.length && !busy && !error" class="empty">此目录没有子文件夹，可以直接选择。</p>
          <button v-if="page?.nextCursor" class="btn more" type="button" :disabled="busy" @click="load(current!.id, page.nextCursor)">{{ busy ? '读取中…' : '加载更多文件夹' }}</button>
        </div>
        <div v-if="creation && page" class="create-output" aria-label="确认创建网盘文件夹">
          <div class="create-heading"><Icon name="folder" :size="18" /><strong>将创建以下完整路径</strong></div>
          <p class="output-folders mono" aria-label="完整创建路径">{{ creationPath }}</p>
          <p class="small muted">在当前上级目录下创建，已有同名文件夹会复用。</p>
          <p v-if="createError" class="directory-error" role="alert">{{ createError }}</p>
        </div>
        <div v-else-if="outputFolders?.length && page" class="create-output" aria-label="创建输出文件夹">
          <div class="create-heading"><Icon name="folder" :size="18" /><strong>按输出预览创建文件夹</strong></div>
          <p class="output-folders mono">{{ outputFolders.join(' / ') }}</p>
          <div class="create-action">
            <span class="small muted">{{ remainingFolders.length ? '在当前目录下创建，已有文件夹会复用。' : '当前目录已匹配输出预览。' }}</span>
            <button v-if="remainingFolders.length" class="btn sm" type="button" :disabled="busy || !!error || !current" @click="createFolders">{{ creating ? '正在创建…' : '创建并选择' }}</button>
          </div>
          <p v-if="createError" class="directory-error" role="alert">{{ createError }}</p>
        </div>
        <footer>
          <p class="selected small" :title="path">{{ page ? `${creation ? '上级目录' : '上传至'}：${path}` : creation ? '请选择创建位置' : '请选择上传位置' }}</p>
          <div class="actions">
            <button class="btn" type="button" :disabled="creating" @click="cancel">取消</button>
            <button v-if="creation" class="btn primary" type="button" :disabled="busy || !!error || !current || !createFoldersHere.length" @click="createFolders">{{ creating ? '正在创建…' : '确认创建' }}</button>
            <button v-else class="btn primary" type="button" :disabled="busy || !!error || !current" @click="select">选择此目录</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.directory-scrim { position: fixed; inset: 0; z-index: 55; background: var(--ui-overlay); backdrop-filter: blur(6px); display: grid; place-items: center; padding: 24px; }
.directory-dialog { width: min(560px, 100%); max-height: calc(100dvh - 48px); background: var(--paper); color: var(--ink); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: var(--ui-shadow-dialog); padding: 22px; display: flex; flex-direction: column; gap: 14px; }
header, .toolbar, .actions { display: flex; align-items: center; gap: 10px; }
header { justify-content: space-between; }
header div { min-width: 0; overflow-wrap: anywhere; }
h2 { font-size: 18px; margin: 0 0 4px; }
p { margin: 0; }
.breadcrumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-height: 90px; overflow: auto; }
.crumb { color: var(--ink); background: none; border: 0; border-radius: 4px; font: inherit; font-size: 13px; text-align: left; overflow-wrap: anywhere; cursor: pointer; padding: 3px; }
.crumb:hover { background: var(--card); }
.folders { min-height: 120px; max-height: 330px; overflow: auto; border-block: 1px solid var(--line); }
.folder { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 12px 6px; color: var(--ink); font: inherit; font-size: 13px; background: none; border: 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.folder span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.folder:hover { background: var(--card); }
button:disabled { opacity: .5; cursor: default; }
.empty { color: var(--ink-2); padding: 32px 10px; text-align: center; font-size: 13px; }
.directory-error { color: var(--err); display: grid; justify-items: start; gap: 8px; font-size: 13px; }
.more { margin: 10px auto; }
footer { display: grid; gap: 12px; }
.selected { overflow-wrap: anywhere; max-height: 70px; overflow: auto; color: var(--ink-2); }
.actions { justify-content: flex-end; flex-wrap: wrap; }
</style>

<style scoped>
.create-output { display: grid; gap: 10px; padding: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.create-heading { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.output-folders { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.create-action { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.create-action button { flex-shrink: 0; }
.folders { flex: 1; min-height: 80px; }
@media (max-width: 520px) { .directory-scrim { padding: 12px; } .directory-dialog { padding: 16px; max-height: calc(100dvh - 24px); overflow: auto; } }
</style>
