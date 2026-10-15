<!-- 下载前确认发布分类与集号；选项来自已验证发布端，不保存任何密钥。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { EpisodeView, PlutoFishView, PublicationContext, PublicationInput, PublicationPreferences, TmdbHit } from '@shared/api'
import type { OutputNaming } from '@shared/output-naming'
import UploadDirectoryPicker from './UploadDirectoryPicker.vue'
import ResourceCategorySelect from './ResourceCategorySelect.vue'
import { publicationCategoryError } from '../../../../../../src/integrations/plutofish/categories'
import Icon from '../../components/Icon.vue'
import { errText, gvs } from '../../store'

const props = withDefaults(defineProps<{ connection?: PlutoFishView; outputFolders?: string[]; provider: string; sourceWorkId: string; revision?: number; tmdb: TmdbHit | null; tmdbSeason?: number; naming?: OutputNaming; kind: 'movie' | 'show'; title: string; year: number; episodes: EpisodeView[]; remember?: boolean; busy?: boolean }>(), { remember: true })
const model = defineModel<PublicationInput>({ required: true })
const emit = defineEmits<{ match: [hit: TmdbHit]; restore: [preferences: PublicationPreferences] }>()
const manualId = ref('')
const choosingDirectory = ref(false)
const source = computed(() => props.connection?.identity?.sourceAccount)
const context = computed<PublicationContext>(() => ({ provider: props.provider, sourceWorkId: props.sourceWorkId,
  kind: props.kind, tmdb: props.tmdb ? { ...props.tmdb } : null, tmdbSeason: props.tmdbSeason, naming: props.naming ? { ...props.naming } : undefined,
  binding: props.connection?.identity ? { url: props.connection.url, publisherId: props.connection.identity.id,
    sourceAccount: source.value ? { id: source.value.id, alias: source.value.alias } : null } : undefined }))
const loading = ref(false)
const error = ref('')
const categoryError = computed(() => publicationCategoryError(props.connection, model.value.category))
const categoryValid = computed(() => !categoryError.value)
let sequence = 0
let saves = Promise.resolve()
let hydration = Promise.resolve()
watch(() => JSON.stringify([props.connection?.status === 'verified', props.connection?.url, props.connection?.identity?.id,
  source.value?.id, source.value?.alias, props.provider, props.sourceWorkId, props.kind, props.tmdb?.id, props.revision]), () => { hydration = hydrate() }, { immediate: true })
async function hydrate() {
  const seq = ++sequence
  choosingDirectory.value = false
  error.value = ''
  model.value = { ...model.value, category: '', directoryId: '0', directoryPath: '/' }
  if (!source.value || props.connection?.status !== 'verified') { loading.value = false; return }
  loading.value = true
  try {
    const saved = await gvs('publicationPreferences', { ...context.value })
    if (seq !== sequence) return
    if (saved) {
      model.value = { ...model.value, ...saved.publication }
      if (saved.naming || (!props.tmdb && saved.tmdb) || (props.tmdbSeason === undefined && saved.tmdbSeason !== undefined)) emit('restore', saved)
    }
  } catch (e) { if (seq === sequence) error.value = errText(e) }
  finally { await nextTick(); if (seq === sequence) loading.value = false }
}
onBeforeUnmount(() => { sequence++ })

function persist(value = model.value) {
  if (!source.value || props.connection?.status !== 'verified') return Promise.resolve()
  const target = { ...context.value }
  const input = { category: value.category, directoryId: value.directoryId, directoryPath: value.directoryPath }
  const seq = sequence
  saves = saves.catch(() => {}).then(() => gvs('savePublicationPreferences', target, input))
    .then(() => { if (seq === sequence) error.value = '' }).catch(e => { if (seq === sequence) error.value = errText(e); throw e })
  return saves
}
async function ready() {
  let pending: Promise<void>
  do { pending = hydration; await pending; await nextTick() } while (pending !== hydration)
  if (error.value) throw new Error(error.value)
  await saves
  if (categoryError.value) throw new Error(categoryError.value)
}
async function save() { await ready(); await persist() }
function remember(value = model.value) { if (props.remember !== false) void persist(value).catch(() => {}) }
watch(() => props.tmdbSeason, () => { if (!loading.value && !props.busy) remember() })
watch(() => JSON.stringify(props.naming), () => { if (!loading.value && !props.busy) remember() })
defineExpose({ loading, ready, save, categoryValid })
function changeCategory(category: string) {
  const next = { ...model.value, category }
  model.value = next
  remember(next)
}
const directoryLabel = computed(() => model.value.directoryPath || ((!model.value.directoryId || model.value.directoryId === '0') ? '根目录 /' : `目录 ${model.value.directoryId}`))

function chooseDirectory(directory: { id: string; path: string }) {
  const next = { ...model.value, directoryId: directory.id, directoryPath: directory.path }
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
    <ResourceCategorySelect :model-value="model.category" :connection="connection" :disabled="loading || busy" @update:model-value="changeCategory" />
    <div class="field">115 上传目录
      <div class="directory-value"><span :title="directoryLabel">{{ directoryLabel }}</span>
        <button class="btn sm" type="button" :disabled="loading || busy || !source || connection?.status !== 'verified'" @click="choosingDirectory = true"><Icon name="folder" :size="16" />选择目录</button>
      </div>
      <span v-if="source" class="small muted">{{ source.name }}</span>
    </div>
    <UploadDirectoryPicker v-if="choosingDirectory && source" :output-folders="outputFolders" :source-account-id="source.id" :source-name="source.name" :directory-id="model.directoryId ?? '0'" @cancel="choosingDirectory = false" @select="chooseDirectory" />
    <span v-if="error" class="small err" role="alert">{{ error }}</span>
    <span class="small">{{ tmdb ? `${tmdb.kind === 'movie' ? '电影' : '剧集'} · TMDB ${tmdb.id}` : '使用平台作品资料（无需 TMDB）' }}</span>
    <details>
      <summary class="small">手动指定 TMDB ID</summary>
      <div class="manual-id">
        <input v-model="manualId" inputmode="numeric" aria-label="TMDB ID" placeholder="填写当前内容类型的 TMDB ID" @keydown.enter.prevent="match" />
        <button type="button" class="btn sm" :disabled="!validId" @click="match">采用</button>
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
    <span v-if="categoryValid" class="small muted">下载完成后自动上传到绑定源账号并登记草稿目录。</span>
  </section>
</template>

<style scoped>
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
