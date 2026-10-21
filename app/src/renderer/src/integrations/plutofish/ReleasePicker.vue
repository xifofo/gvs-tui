<!-- 发布前确认版本；请求过期后立即清空选择，续集未匹配时由主进程再次阻止静默新建。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { EnqueueRequest, ReleaseChoices, ReleaseSelection } from '@shared/api'
import { errText, gvs } from '../../store'

const props = defineProps<{ request: EnqueueRequest | null; binding: string; disabled?: boolean }>()
const model = defineModel<ReleaseSelection>()
const choices = ref<ReleaseChoices | null>(null)
const loading = ref(false)
const error = ref('')
let sequence = 0
let timer: ReturnType<typeof setTimeout> | undefined
// 选择自身不影响查询；集号、季、画质、音轨、作品或源账号变化都必须重新匹配。
const query = computed(() => {
  if (!props.request) return null
  const { releaseSelection: _, ...publication } = props.request.publication ?? { category: '' }
  return { ...props.request, publication }
})
const queryKey = computed(() => JSON.stringify([props.binding, query.value]))
watch(queryKey, () => {
  ++sequence
  clearTimeout(timer)
  choices.value = null
  model.value = undefined
  error.value = ''
  loading.value = !!query.value?.publication.category
  if (loading.value) timer = setTimeout(() => { void refresh() }, 250)
}, { immediate: true })
onBeforeUnmount(() => { ++sequence; clearTimeout(timer) })

async function refresh() {
  clearTimeout(timer)
  const seq = ++sequence
  const request = query.value
  if (!request?.publication.category) { loading.value = false; return }
  loading.value = true
  choices.value = null
  model.value = undefined
  error.value = ''
  try {
    const result = await gvs('publicationReleases', request)
    if (seq !== sequence) return
    choices.value = result
    if (result.matchedId) model.value = { context: result.context, mode: 'existing', releaseId: result.matchedId }
  } catch (e) { if (seq === sequence) error.value = errText(e) }
  finally { if (seq === sequence) loading.value = false }
}
const valid = computed(() => !loading.value && !error.value && !!choices.value && (!choices.value.needsChoice || !!model.value))
const selected = computed(() => model.value?.mode === 'existing' ? model.value.releaseId : model.value?.mode === 'new' ? 'new' : '')
function choose(value: string) {
  if (!choices.value) return
  model.value = value === 'new' ? { context: choices.value.context, mode: 'new' }
    : value ? { context: choices.value.context, mode: 'existing', releaseId: value } : undefined
}
function ready() {
  if (!valid.value) throw new Error(error.value || (loading.value ? '正在匹配发布版本，请稍候' : '请选择已有版本或强制新版本'))
}
defineExpose({ valid, loading, ready })
</script>

<template>
  <div class="release-picker">
    <div class="release-heading"><strong>发布版本</strong><button type="button" class="btn sm" :disabled="disabled || loading || !query?.publication.category" @click="refresh">刷新版本</button></div>
    <p v-if="!query?.publication.category" class="small muted">选择资源分类后匹配已有版本。</p>
    <p v-else-if="loading" class="small muted" role="status">正在匹配已有版本…</p>
    <p v-else-if="error" class="small err" role="alert">{{ error }}</p>
    <template v-else-if="choices">
      <p class="small muted release-preview">当前规格：{{ choices.name }}</p>
      <p v-if="choices.needsChoice" class="release-warning small" role="alert">当前为后续集数，未找到唯一匹配版本。请确认版本，选择已有版本或强制新版本。</p>
      <p v-else-if="choices.matchedId" class="small muted">已默认选择{{ choices.match === 'binding' ? '此前关联' : '规格匹配' }}的版本，可手动更改。</p>
      <p v-else class="small muted">{{ query?.detail.kind === 'movie' ? '未匹配到已有版本，完成后自动新建。' : '本批包含第 1 集，完成后可自动新建版本。' }}</p>
      <div class="release-options" role="radiogroup" aria-label="发布版本">
        <label v-if="!choices.needsChoice && !choices.matchedId" class="release-option" :class="{ active: !selected }">
          <input type="radio" name="publication-release" value="" :checked="!selected" :disabled="disabled" @change="choose('')" />
          <span>自动新建版本<small>{{ choices.name }}</small></span>
        </label>
        <label v-for="item in choices.items" :key="item.id" class="release-option" :class="{ active: selected === item.id }">
          <input type="radio" name="publication-release" :value="item.id" :checked="selected === item.id" :disabled="disabled" @change="choose(item.id)" />
          <span>{{ item.name }}<small>{{ item.latestEpisode !== undefined ? `更新至第 ${item.latestEpisode} 集 · ` : '' }}{{ { published: '已发布', draft: '草稿', unpublished: '已下架' }[item.status] }}{{ choices.matchedId === item.id ? ' · 匹配版本' : '' }}</small></span>
        </label>
        <label class="release-option" :class="{ active: selected === 'new' }">
          <input type="radio" name="publication-release" value="new" :checked="selected === 'new'" :disabled="disabled" @change="choose('new')" />
          <span>强制新版本<small>将本批内容发布为独立版本</small></span>
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.release-picker { display: grid; gap: 10px; min-width: 0; }
.release-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
p { margin: 0; }
.release-preview { overflow-wrap: anywhere; }
.release-warning { color: var(--ink); background: color-mix(in srgb, var(--orange) 12%, transparent); padding: 10px 12px; border-radius: 10px; }
.release-options { display: grid; gap: 8px; max-height: 330px; overflow-y: auto; }
.release-option { display: flex; align-items: start; gap: 10px; border: 1px solid var(--line); padding: 12px; border-radius: 12px; cursor: pointer; }
.release-option.active { border-color: var(--orange); background: color-mix(in srgb, var(--orange) 7%, transparent); }
.release-option input { width: 16px; height: 16px; margin: 3px 0 0; flex: 0 0 auto; accent-color: var(--orange); }
.release-option span { min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.release-option small { display: block; margin-top: 3px; color: var(--ink-2); font-size: 12px; }
</style>
