<!-- 识别只修改草稿；首次空白草稿自动识别，迟到结果和已有填写内容需明确采用。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Recognition, RecognizedWork } from '@shared/api'
import { errText, gvs } from '../../store'

const props = defineProps<{ scope: string; sourceAccountId: string; sample: string; draftKey: string; canAutoFill: boolean; disabled: boolean }>()
const emit = defineEmits<{ apply: [result: Recognition]; confirm: [work: RecognizedWork, season?: number]; pending: [value: boolean] }>()
const fileName = ref(''), pending = ref(false), message = ref(''), error = ref('')
const result = ref<Recognition | null>(null), applied = ref(false)
const selectedIndex = ref<number | null>(null), season = ref('')
const candidate = computed(() => selectedIndex.value === null ? undefined : result.value?.candidates[selectedIndex.value])
const seasonValid = computed(() => /^\d+$/.test(season.value) && Number(season.value) <= 999)
const canConfirm = computed(() => !!candidate.value && (candidate.value.work.mediaType === 'movie' || seasonValid.value))
const conflictLabels: Record<string, string> = { title: '片名', year: '年份', media_type: '作品类型', tmdb_id: 'TMDB ID', release_title: '发行片名' }
let generation = 0, attempted = false, edited = false
function invalidate() {
  generation++; pending.value = false; emit('pending', false)
  result.value = null; selectedIndex.value = null; season.value = ''; applied.value = false; message.value = ''; error.value = ''
}
watch(() => props.scope, () => { invalidate(); fileName.value = ''; attempted = false; edited = false }, { immediate: true })
watch(() => [props.sample, props.disabled, props.canAutoFill, props.sourceAccountId, props.scope], () => {
  if (!edited && !attempted) fileName.value = props.sample
  if (!attempted && !props.disabled && props.sourceAccountId && props.sample && props.canAutoFill) {
    attempted = true
    void recognize()
  }
}, { immediate: true, flush: 'post' })
function input() { edited = true; attempted = true; invalidate() }
async function recognize() {
  if (props.disabled || !props.sourceAccountId || !fileName.value.trim() || pending.value) return
  const current = ++generation, draft = props.draftKey, canFill = props.canAutoFill
  pending.value = true; emit('pending', true); result.value = null; selectedIndex.value = null; season.value = ''; applied.value = false; error.value = ''
  message.value = '正在识别作品与分类…'
  try {
    const response = await gvs('recognizePublication', props.sourceAccountId, fileName.value.trim())
    if (current !== generation) return
    result.value = response
    if (response.canAutoFill && canFill && draft === props.draftKey && !props.disabled) apply()
    else if (response.canAutoFill) message.value = '识别完成。当前已有填写内容，可确认后替换。'
    else if (response.status === 'not_identified') message.value = '未识别到作品，可修改文件名重试或继续手动填写。'
    else if (response.candidates.length) message.value = '请选择候选，核对后确认填入。'
    else if (response.reasons.some(r => r.startsWith('category_'))) message.value = '已识别作品，但分类未匹配到可用字典项，请检查后台分类规则或手动填写。'
    else message.value = '识别结果需要确认，请参考候选并手动填写。'
  } catch (e) { if (current === generation) { message.value = ''; error.value = errText(e) } }
  finally { if (current === generation) { pending.value = false; emit('pending', false) } }
}
function apply() {
  if (props.disabled || !result.value?.canAutoFill) return
  emit('apply', result.value); applied.value = true; message.value = '已填入作品、分类与季号，请确认后继续。'
}
function selectCandidate(index: number) {
  if (props.disabled || pending.value) return
  selectedIndex.value = index; applied.value = false
  const parsed = result.value?.parsed
  season.value = candidate.value?.work.mediaType === 'tv' && parsed?.seasonNumber !== undefined && parsed.seasonNumber <= 999
    && (parsed.seasonEnd === undefined || parsed.seasonEnd === parsed.seasonNumber) ? String(parsed.seasonNumber) : ''
}
function confirmCandidate() {
  if (props.disabled || pending.value || applied.value || !canConfirm.value || !candidate.value) return
  const work = candidate.value.work
  emit('confirm', work, work.mediaType === 'tv' ? Number(season.value) : undefined)
  applied.value = true
  message.value = work.category.status === 'matched' ? '已填入所选作品，请确认后继续。' : '已填入所选作品，请在下方选择资源分类。'
}
onBeforeUnmount(invalidate)
</script>

<template>
  <div class="publication-recognition">
    <label for="publication-recognition-file">文件名识别</label>
    <div class="input-action">
      <input id="publication-recognition-file" v-model="fileName" maxlength="1000" placeholder="例如：作品名.2024.S01E02.1080p.mkv" :disabled="disabled" @input="input" @keydown.enter.prevent="recognize" />
      <button type="button" class="btn sm" :disabled="disabled || pending || !sourceAccountId || !fileName.trim()" @click="recognize">{{ pending ? '识别中…' : '识别并填入' }}</button>
    </div>
    <span class="small muted">首次使用命名预览中的文件名识别；也可手动输入文件名。</span>
    <span v-if="message" role="status" class="small muted">{{ message }}</span>
    <span v-if="error" role="alert" class="small err">{{ error }}</span>
    <div v-if="result?.work && (result.canAutoFill || !result.candidates.length)" class="recognized-work">
      <strong>{{ result.work.title }}</strong>
      <span class="small">{{ result.work.mediaType === 'tv' ? '剧集' : '电影' }} · TMDB {{ result.work.tmdbId }} · {{ result.work.category.label || '分类待选择' }}</span>
      <button v-if="result.canAutoFill && !applied" type="button" class="btn sm" :disabled="disabled || pending" @click="apply">替换当前作品信息</button>
    </div>
    <details v-if="result && !result.canAutoFill && result.candidates.length" open>
      <summary class="small">识别候选（{{ result.candidates.length }}）</summary>
      <p v-if="result.truncated" class="small muted">当前仅展示部分候选；没有正确作品时，可修改文件名重新识别或手动填写 TMDB ID。</p>
      <div class="recognition-candidates" role="group" aria-label="识别候选">
        <button v-for="(item, index) in result.candidates" :key="`${item.work.mediaType}:${item.work.tmdbId}`" type="button" class="recognition-candidate" :aria-pressed="selectedIndex === index" :disabled="disabled || pending" @click="selectCandidate(index)">
          <span><strong>{{ item.work.title }}</strong><small v-if="item.work.originalTitle && item.work.originalTitle !== item.work.title">{{ item.work.originalTitle }}</small><small>{{ item.work.year || '年份未知' }} · {{ item.work.mediaType === 'tv' ? '剧集' : '电影' }} · TMDB {{ item.work.tmdbId }}</small></span>
          <span class="candidate-action">{{ selectedIndex === index ? (applied ? '已确认' : '已选中') : '选择' }}</span>
        </button>
      </div>
      <div v-if="candidate" class="candidate-confirmation" aria-live="polite">
        <strong>{{ candidate.work.title }}</strong>
        <span class="small">{{ candidate.work.year || '年份未知' }} · {{ candidate.work.mediaType === 'tv' ? '剧集' : '电影' }} · TMDB {{ candidate.work.tmdbId }}</span>
        <span class="small muted">分类：{{ candidate.work.category.status === 'matched' ? (candidate.work.category.label || candidate.work.category.name) : '待选择' }}</span>
        <p v-for="(conflict, index) in candidate.conflicts" :key="index" class="small err">{{ conflictLabels[conflict.field] || '识别信息' }}不一致：文件名为「{{ conflict.expected || '未知' }}」，候选为「{{ conflict.actual || '未知' }}」。</p>
        <label v-if="candidate.work.mediaType === 'tv'" class="candidate-season">确认季号
          <input v-model="season" aria-label="候选季号" type="number" min="0" max="999" step="1" placeholder="填写季号，特别篇为 0" :disabled="disabled || pending" @input="applied = false" @keydown.enter.prevent="confirmCandidate" />
          <span v-if="!seasonValid" class="small muted">请填写单一季号（0–999），不会采用文件名中的多季范围。</span>
        </label>
        <span v-if="candidate.work.category.status !== 'matched'" class="small muted">确认后请在下方选择资源分类。</span>
        <button type="button" class="btn sm" :disabled="disabled || pending || applied || !canConfirm" @click="confirmCandidate">{{ applied ? '已确认并填入' : '确认并填入' }}</button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.publication-recognition { display: grid; gap: 8px; min-width: 0; font-size: 12px; }
.input-action { display: flex; flex-wrap: wrap; gap: 8px; }
input { flex: 1; min-width: 180px; width: 100%; padding: 8px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.recognized-work { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow-wrap: anywhere; }
summary { cursor: pointer; }
.recognition-candidates { margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; max-height: 260px; overflow: auto; }
.recognition-candidate { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; padding: 10px; background: transparent; color: var(--ink); border: 0; border-bottom: 1px solid var(--line); text-align: left; }
.recognition-candidate:last-child { border-bottom: 0; }
.recognition-candidate:hover, .recognition-candidate[aria-pressed=true] { background: var(--card); }
.recognition-candidate:focus-visible { outline: 2px solid var(--orange); outline-offset: -2px; }
.recognition-candidate>span:first-child { min-width: 0; overflow-wrap: anywhere; }
.recognition-candidate strong, .recognition-candidate small { display: block; }
.recognition-candidate small { margin-top: 4px; color: var(--ink-3); }
.candidate-action { flex-shrink: 0; color: var(--orange-text); font-size: 12px; }
.candidate-confirmation { display: grid; gap: 8px; margin-top: 10px; padding: 12px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow-wrap: anywhere; }
.candidate-confirmation p { margin: 0; }
.candidate-confirmation>.btn { justify-self: start; }
.candidate-season { display: grid; gap: 6px; }
.candidate-season input { min-width: 0; width: 100%; box-sizing: border-box; }
</style>
