<!-- 识别只修改草稿；首次空白草稿自动识别，迟到结果和已有填写内容需明确采用。 -->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { Recognition } from '@shared/api'
import { errText, gvs } from '../../store'

const props = defineProps<{ scope: string; sourceAccountId: string; sample: string; draftKey: string; canAutoFill: boolean; disabled: boolean }>()
const emit = defineEmits<{ apply: [result: Recognition]; pending: [value: boolean] }>()
const fileName = ref(''), pending = ref(false), message = ref(''), error = ref('')
const result = ref<Recognition | null>(null), applied = ref(false)
let generation = 0, attempted = false, edited = false
function invalidate() {
  generation++; pending.value = false; emit('pending', false)
  result.value = null; applied.value = false; message.value = ''; error.value = ''
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
  pending.value = true; emit('pending', true); result.value = null; applied.value = false; error.value = ''
  message.value = '正在识别作品与分类…'
  try {
    const response = await gvs('recognizePublication', props.sourceAccountId, fileName.value.trim())
    if (current !== generation) return
    result.value = response
    if (response.canAutoFill && canFill && draft === props.draftKey && !props.disabled) apply()
    else if (response.canAutoFill) message.value = '识别完成。当前已有填写内容，可确认后替换。'
    else if (response.status === 'not_identified') message.value = '未识别到作品，可修改文件名重试或继续手动填写。'
    else if (response.reasons.some(r => r.startsWith('category_'))) message.value = '已识别作品，但分类未匹配到可用字典项，请检查后台分类规则或手动填写。'
    else message.value = '识别结果需要确认，请参考候选并手动填写。'
  } catch (e) { if (current === generation) { message.value = ''; error.value = errText(e) } }
  finally { if (current === generation) { pending.value = false; emit('pending', false) } }
}
function apply() {
  if (props.disabled || !result.value?.canAutoFill) return
  emit('apply', result.value); applied.value = true; message.value = '已填入作品、分类与季号，请确认后继续。'
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
    <div v-if="result?.work" class="recognized-work">
      <strong>{{ result.work.title }}</strong>
      <span class="small">{{ result.work.mediaType === 'tv' ? '剧集' : '电影' }} · TMDB {{ result.work.tmdbId }} · {{ result.work.category.label || '分类待选择' }}</span>
      <button v-if="result.canAutoFill && !applied" type="button" class="btn sm" :disabled="disabled || pending" @click="apply">替换当前作品信息</button>
    </div>
    <details v-if="result && !result.canAutoFill && result.candidates.length">
      <summary class="small">识别候选（{{ result.candidates.length }}）</summary>
      <p v-for="candidate in result.candidates" :key="`${candidate.work.mediaType}:${candidate.work.tmdbId}`" class="small muted">{{ candidate.work.title }} · {{ candidate.work.year || '年份未知' }} · {{ candidate.work.mediaType === 'tv' ? '剧集' : '电影' }} · TMDB {{ candidate.work.tmdbId }}</p>
    </details>
  </div>
</template>

<style scoped>
.publication-recognition { display: grid; gap: 8px; min-width: 0; font-size: 12px; }
.input-action { display: flex; flex-wrap: wrap; gap: 8px; }
input { flex: 1; min-width: 180px; width: 100%; padding: 8px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.recognized-work { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow-wrap: anywhere; }
summary { cursor: pointer; }
</style>
