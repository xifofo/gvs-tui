<!-- 下载前确认发布分类与集号；选项来自已验证发布端，不保存任何密钥。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { EpisodeView, PlutoFishView, PublicationContext, PublicationInput, PublicationPreferences, PublisherDirectoryPage, Recognition, TmdbHit } from '@shared/api'
import { publicationDirectoryPreview } from '@shared/publication-directory'
import type { OutputNaming } from '@shared/output-naming'
import { publisherSources } from '../../../../../../src/integrations/plutofish/sources'
import PublicationRecognition from './PublicationRecognition.vue'
import UploadDirectoryPicker from './UploadDirectoryPicker.vue'
import ResourceCategorySelect from './ResourceCategorySelect.vue'
import { publicationCategoryError } from '../../../../../../src/integrations/plutofish/categories'
import Icon from '../../components/Icon.vue'
import { errText, gvs } from '../../store'

const props = withDefaults(defineProps<{ connection?: PlutoFishView; outputFolders?: string[]; recognitionFileName?: string; provider: string; sourceWorkId: string; revision?: number; tmdb: TmdbHit | null; tmdbSeason?: number; effectiveSeason?: number; directoryPreviewReady?: boolean; naming?: OutputNaming; kind: 'movie' | 'show'; title: string; year: number; episodes: EpisodeView[]; remember?: boolean; busy?: boolean }>(), { remember: true, directoryPreviewReady: true })
const model = defineModel<PublicationInput>({ required: true })
const emit = defineEmits<{ match: [hit: TmdbHit]; restore: [preferences: PublicationPreferences]; recognized: [hit: TmdbHit, season?: number] }>()
const manualId = ref('')
const choosingDirectory = ref(false), creatingDirectory = ref(false)
const creationDialog = ref<{ sequence: number; sourceAccountId: string; workKey: string; kind: 'movie' | 'show'; parentId: string; folders: string[]; existingWorkId?: string; seasonFolder?: string } | null>(null)
const sources = computed(() => publisherSources(props.connection?.identity))
const source = computed(() => sources.value.find(s => s.id === (model.value.sourceAccountId ?? props.connection?.identity?.sourceAccount.id)))
const context = computed<PublicationContext>(() => ({ provider: props.provider, sourceWorkId: props.sourceWorkId,
  kind: props.kind, tmdb: props.tmdb ? { ...props.tmdb } : null, tmdbSeason: props.tmdbSeason, naming: props.naming ? { ...props.naming } : undefined,
  binding: props.connection?.identity ? { url: props.connection.url, publisherId: props.connection.identity.id,
    sourceAccount: model.value.sourceAccountId && source.value ? { id: source.value.id, alias: source.value.alias } : null } : undefined,
  sourceAccountId: model.value.sourceAccountId }))
const loading = ref(false)
const recognitionPending = ref(false), applyingRecognition = ref(false)
const error = ref('')
const categoryError = computed(() => !source.value ? '请选择可用的上传账号' : publicationCategoryError(props.connection, model.value.category))
const categoryValid = computed(() => !categoryError.value)
let sequence = 0
let saves = Promise.resolve()
let hydration = Promise.resolve()
let hydratedScope = ''
watch(() => JSON.stringify([props.connection?.status === 'verified', props.connection?.url, props.connection?.identity?.id,
  sources.value.map(s => [s.id, s.alias, s.enabled]), props.provider, props.sourceWorkId, props.kind, props.tmdb?.id, props.revision]), () => { if (!applyingRecognition.value) hydration = hydrate() }, { immediate: true })
async function hydrate(switching = false) {
  const seq = ++sequence
  choosingDirectory.value = false
  error.value = ''
  creationDialog.value = null
  const scope = JSON.stringify([props.connection?.url, props.connection?.identity?.id, props.provider, props.sourceWorkId, props.kind])
  const sourceAccountId = hydratedScope && hydratedScope !== scope ? undefined : model.value.sourceAccountId
  hydratedScope = scope
  model.value = { ...model.value, sourceAccountId, category: switching ? model.value.category : '', directoryId: '0', directoryPath: '/', directoryCreation: undefined, releaseSelection: undefined }
  if (props.connection?.status !== 'verified') { loading.value = false; return }
  loading.value = true
  // v-model 通过父组件回传，等本轮更新结束再读取账号和上下文。
  await nextTick()
  if (seq !== sequence) return
  try {
    const saved = await gvs('publicationPreferences', { ...context.value })
    if (seq !== sequence) return
    model.value = { ...model.value, ...saved?.publication,
      sourceAccountId: saved?.publication.sourceAccountId ?? model.value.sourceAccountId ?? props.connection?.identity?.sourceAccount.id }
    if (saved) {
      if (saved.naming || (!props.tmdb && saved.tmdb) || (props.tmdbSeason === undefined && saved.tmdbSeason !== undefined)) emit('restore', saved)
    }
  } catch (e) { if (seq === sequence) error.value = errText(e) }
  finally { await nextTick(); if (seq === sequence) loading.value = false }
}
onBeforeUnmount(() => { sequence++ })

function persist(value = model.value) {
  if (!source.value || props.connection?.status !== 'verified') return Promise.resolve()
  const target = { ...context.value }
  const input = { category: value.category, sourceAccountId: value.sourceAccountId, directoryId: value.directoryId, directoryPath: value.directoryPath, directoryCreation: value.directoryCreation ? { ...value.directoryCreation } : undefined }
  const seq = sequence
  saves = saves.catch(() => {}).then(() => gvs('savePublicationPreferences', target, input))
    .then(() => { if (seq === sequence) error.value = '' }).catch(e => { if (seq === sequence) error.value = errText(e); throw e })
  return saves
}
async function ready() {
  let pending: Promise<void>
  do { pending = hydration; await pending; await nextTick() } while (pending !== hydration)
  if (!props.directoryPreviewReady && createdDirectory.value) throw new Error('请等待命名预览完成')
  if (creationDialog.value) throw new Error('请先完成或取消网盘文件夹创建')
  if (createdDirectory.value && createdDirectory.value.workKey !== directoryWorkKey.value) throw new Error('请为当前作品和季创建文件夹，或重新手动选择上传目录')
  if (recognitionPending.value || applyingRecognition.value) throw new Error('请等待识别完成')
  if (error.value) throw new Error(error.value)
  await saves
  if (categoryError.value) throw new Error(categoryError.value)
}
async function save() { await ready(); await persist() }
function remember(value = model.value) { if (props.remember !== false) void persist(value).catch(() => {}) }
watch(() => props.tmdbSeason, () => { if (!loading.value && !props.busy) remember() })
watch(() => JSON.stringify(props.naming), () => { if (!loading.value && !props.busy) remember() })
defineExpose({ loading: computed(() => loading.value || creatingDirectory.value || recognitionPending.value || applyingRecognition.value), ready, save, categoryValid })
function changeSource(event: Event) {
  model.value = { ...model.value, sourceAccountId: (event.target as HTMLSelectElement).value, directoryId: '0', directoryPath: '/', directoryCreation: undefined, releaseSelection: undefined }
  loading.value = true
  hydration = nextTick().then(() => hydrate(true)).then(() => { if (!error.value) remember() })
}
function changeCategory(category: string) {
  const next = { ...model.value, category }
  model.value = next
  remember(next)
}
const recognitionScope = computed(() => JSON.stringify([props.connection?.status, props.connection?.url, props.connection?.identity?.id, source.value?.id, source.value?.alias, props.provider, props.sourceWorkId, props.revision]))
const recognitionDraft = computed(() => JSON.stringify([context.value, model.value]))
async function applyRecognition(result: Recognition) {
  const work = result.work
  if (!result.canAutoFill || !work || loading.value || props.busy) return
  if (publicationCategoryError(props.connection, work.category.value)) { error.value = '识别分类已不可用，请刷新分类或手动选择'; return }
  applyingRecognition.value = true
  const scope = recognitionScope.value
  const hit: TmdbHit = { id: Number(work.tmdbId), kind: work.mediaType === 'movie' ? 'movie' : 'show', name: work.title, title: work.englishTitle || work.originalTitle || work.title, year: work.year ?? 0, overview: '' }
  model.value = { ...model.value, category: work.category.value, releaseSelection: undefined }
  emit('recognized', hit, work.mediaType === 'tv' ? result.parsed.seasonNumber : undefined)
  await nextTick()
  applyingRecognition.value = false
  if (scope !== recognitionScope.value) return
  hydratedScope = JSON.stringify([props.connection?.url, props.connection?.identity?.id, props.provider, props.sourceWorkId, props.kind])
  remember()
}
const directoryPreview = computed(() => !props.directoryPreviewReady ? '' : publicationDirectoryPreview({
  categoryLabel: props.connection?.identity?.categories?.find(c => c.value === model.value.category)?.label ?? '',
  title: props.tmdb?.name || props.title, tmdbId: props.tmdb?.id, kind: props.kind, season: props.effectiveSeason,
}))
const directoryWorkKey = computed(() => JSON.stringify([props.kind, props.tmdb?.id, props.kind === 'movie' ? null : props.effectiveSeason]))
const createdDirectory = computed(() => model.value.directoryCreation?.targetId === model.value.directoryId ? model.value.directoryCreation : undefined)
const directoryAlreadyCreated = computed(() => !!createdDirectory.value && createdDirectory.value.workKey === directoryWorkKey.value)
const sameCreatedWork = computed(() => {
  try { const key = JSON.parse(createdDirectory.value?.workKey || 'null'); return Array.isArray(key) && key[0] === props.kind && key[1] === props.tmdb?.id } catch { return false }
})
const creatingSeason = computed(() => props.kind === 'show' && sameCreatedWork.value && !!createdDirectory.value?.workDirectoryId)
const createParent = computed(() => creatingSeason.value ? { id: createdDirectory.value!.workDirectoryId!, path: createdDirectory.value!.workDirectoryPath || '已创建的作品目录' }
  : createdDirectory.value ? { id: createdDirectory.value.parentId, path: createdDirectory.value.parentPath } : { id: model.value.directoryId ?? '0', path: model.value.directoryPath || '/' })
const createSegments = computed(() => creatingSeason.value ? [`season ${String(props.effectiveSeason).padStart(2, '0')}`] : directoryPreview.value.split('/'))
function openCreateDirectory() {
  if (creationDialog.value || creatingDirectory.value || loading.value || props.busy || !source.value || !props.tmdb || !directoryPreview.value || directoryAlreadyCreated.value) return
  creationDialog.value = { sequence, sourceAccountId: source.value.id, workKey: directoryWorkKey.value, kind: props.kind,
    parentId: createParent.value.id, folders: directoryPreview.value.split('/'),
    ...(creatingSeason.value ? { existingWorkId: createdDirectory.value!.workDirectoryId, seasonFolder: createSegments.value[0] } : {}) }
}
function createdWorkDirectory(result: { page: PublisherDirectoryPage; parent: { id: string; path: string } }) {
  const request = creationDialog.value
  if (!request || request.sequence !== sequence || source.value?.id !== request.sourceAccountId || directoryWorkKey.value !== request.workKey) return
  const target = result.page.path.at(-1)!, workIndex = result.page.path.length - (request.kind === 'show' ? 2 : 1)
  const workDirectory = result.page.path[workIndex]!
  const previous = request.existingWorkId === result.parent.id ? createdDirectory.value : undefined
  const next = { ...model.value, directoryId: target.id, directoryPath: '/' + result.page.path.slice(1).map(d => d.name).join('/'),
    directoryCreation: { parentId: previous?.parentId ?? result.parent.id, parentPath: previous?.parentPath ?? result.parent.path,
      targetId: target.id, workKey: request.workKey, workDirectoryId: workDirectory.id,
      workDirectoryPath: '/' + result.page.path.slice(1, workIndex + 1).map(d => d.name).join('/') } }
  model.value = next
  creationDialog.value = null
  remember(next)
}
watch(directoryWorkKey, key => { if (creationDialog.value && key !== creationDialog.value.workKey) creationDialog.value = null })
const directoryLabel = computed(() => model.value.directoryPath || ((!model.value.directoryId || model.value.directoryId === '0') ? '根目录 /' : `目录 ${model.value.directoryId}`))

function chooseDirectory(directory: { id: string; path: string }) {
  const next = { ...model.value, directoryId: directory.id, directoryPath: directory.path, directoryCreation: model.value.directoryId === directory.id ? model.value.directoryCreation : undefined }
  model.value = next
  choosingDirectory.value = false
  remember(next)
}
const validId = computed(() => /^\d+$/.test(manualId.value) && Number(manualId.value) > 0 && Number(manualId.value) <= 2147483647)

function match() {
  if (validId.value) emit('match', { id: Number(manualId.value), kind: props.kind, title: props.title, name: props.title, year: props.year, overview: '' })
}

function changeEpisode(vid: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const next = { ...model.value.episodeNumbers }
  if (!raw) delete next[vid]
  else next[vid] = Number(raw)
  model.value = { ...model.value, episodeNumbers: next }
}
</script>

<template>
  <section class="publication-fields" aria-label="PlutoFish 发布信息">
    <strong>PlutoFish 发布信息</strong>
    <label class="field">上传账号
      <select :value="error && !model.sourceAccountId ? '' : (model.sourceAccountId ?? source?.id ?? '')" :disabled="loading || creatingDirectory || busy || connection?.status !== 'verified'" @change="changeSource">
        <option v-if="error && !model.sourceAccountId" value="" disabled>请选择上传账号</option>
        <option v-if="model.sourceAccountId && !source" :value="model.sourceAccountId" disabled>原账号已不可用，请重新选择</option>
        <option v-for="account in sources" :key="account.id" :value="account.id" :disabled="account.enabled === false || !!(account.provider && account.provider !== '115')">{{ account.provider === '115' || !account.provider ? '115' : account.provider }} · {{ account.name }} · {{ account.alias }}</option>
      </select>
    </label>
    <PublicationRecognition :scope="recognitionScope" :source-account-id="source?.id ?? ''" :sample="recognitionFileName ?? ''" :draft-key="recognitionDraft" :can-auto-fill="!tmdb && !model.category && !Object.keys(naming ?? {}).length" :disabled="loading || creatingDirectory || applyingRecognition || !!busy || connection?.status !== 'verified'" @pending="recognitionPending = $event" @apply="applyRecognition" />
    <ResourceCategorySelect :model-value="model.category" :connection="connection" :disabled="loading || creatingDirectory || busy" @update:model-value="changeCategory" />
    <div class="field">上传目录
      <div class="directory-value"><span :title="directoryLabel">{{ directoryLabel }}</span>
        <button class="btn sm" type="button" :disabled="loading || creatingDirectory || busy || !source || connection?.status !== 'verified'" @click="choosingDirectory = true"><Icon name="folder" :size="16" />选择目录</button>
      </div>
      <span v-if="source" class="small muted">{{ source.name }}</span>
      <div v-if="tmdb" class="create-work-directory">
        <template v-if="!directoryAlreadyCreated">
          <span class="small muted">点击后选择上级目录，确认完整路径后再创建。</span>
          <code v-if="directoryPreview" aria-label="新建网盘路径">{{ createSegments.join('/') }}</code>
          <span v-else class="small muted">{{ !directoryPreviewReady ? '正在确认目录预览…' : !model.category ? '请选择资源分类后创建文件夹。' : '请确认当前季号后创建文件夹。' }}</span>
        </template>
        <button class="btn sm" type="button" :disabled="loading || creatingDirectory || busy || !source || !directoryPreview || directoryAlreadyCreated || connection?.status !== 'verified'" @click="openCreateDirectory">{{ creatingDirectory ? '正在创建…' : directoryAlreadyCreated ? '文件夹已创建' : '在网盘创建文件夹' }}</button>
        <span v-if="directoryAlreadyCreated" class="small muted">继续使用上方已选目录；修改作品标题不会重复创建。</span>
      </div>
    </div>
    <UploadDirectoryPicker v-if="creationDialog && source" :source-account-id="creationDialog.sourceAccountId" :source-name="source.name" :directory-id="creationDialog.parentId" :creation="{ folders: creationDialog.folders, existingWorkId: creationDialog.existingWorkId, seasonFolder: creationDialog.seasonFolder }" @cancel="creationDialog = null" @busy="creatingDirectory = $event" @created="createdWorkDirectory" />
    <UploadDirectoryPicker v-if="choosingDirectory && source" :output-folders="outputFolders" :source-account-id="source.id" :source-name="source.name" :directory-id="model.directoryId ?? '0'" @cancel="choosingDirectory = false" @select="chooseDirectory" />
    <span v-if="error" class="small err" role="alert">{{ error }}</span>
    <span class="small">{{ tmdb ? `${tmdb.kind === 'movie' ? '电影' : '剧集'} · TMDB ${tmdb.id}` : '使用平台作品资料（无需 TMDB）' }}</span>
    <details>
      <summary class="small">手动指定 TMDB ID</summary>
      <div class="manual-id">
        <input v-model="manualId" :disabled="loading || creatingDirectory || busy" inputmode="numeric" aria-label="TMDB ID" placeholder="填写当前内容类型的 TMDB ID" @keydown.enter.prevent="match" />
        <button type="button" class="btn sm" :disabled="!validId || loading || creatingDirectory || busy" @click="match">采用</button>
      </div>
    </details>
    <details v-if="kind !== 'movie' && episodes.length">
      <summary class="small">确认集号（{{ episodes.length }} 集）</summary>
      <div class="episodes">
        <label v-for="(episode, i) in episodes" :key="episode.vid" class="episode">
          <span :title="episode.title">{{ episode.title }}</span>
          <input :value="model.episodeNumbers?.[episode.vid] ?? (episode.number || i + 1)" type="number" min="0" max="100000" step="1" :aria-label="`${episode.title} 集号`" @input="changeEpisode(episode.vid, $event)" />
        </label>
      </div>
    </details>
    <span v-if="!connection?.identity?.sourceAccount" class="small muted">当前凭据未绑定源账号，发布信息将保留为待补全。</span>
    <span v-if="categoryValid" class="small muted">下载完成后自动上传，核验成功后自动发布。</span>
  </section>
</template>

<style scoped>
.create-work-directory { display: grid; justify-items: start; gap: 6px; padding-top: 4px; min-width: 0; }
.create-work-directory code { font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.publication-fields { display: grid; gap: 10px; margin: 14px 0; padding: 14px 0; border-block: 1px solid var(--line); }
.field { display: grid; gap: 6px; font-size: 12px; }
.directory-value { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.directory-value > span { flex: 1; min-width: 120px; overflow-wrap: anywhere; }
select, input { min-width: 0; width: 100%; padding: 8px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
summary { cursor: pointer; }
.manual-id { display: flex; gap: 6px; margin-top: 8px; }
.episodes { max-height: 190px; overflow-y: auto; margin-top: 8px; }
.episode { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 8px; align-items: center; margin: 6px 0; font-size: 12px; }
.episode span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
