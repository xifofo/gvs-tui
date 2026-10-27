<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JobView, PublicationFileChoice } from '@shared/api'
import { publicationMissing, publicationStage } from '../../../../../../src/integrations/plutofish/publication-types'
import { errText, gvs, human, store, toast } from '../../store'
import ResourceCategorySelect from './ResourceCategorySelect.vue'
import Icon from '../../components/Icon.vue'
import { publicationCategoryError } from '../../../../../../src/integrations/plutofish/categories'
import { uploadBytes, uploadRemaining } from '../../../../../../src/integrations/plutofish/upload-display'

const props = defineProps<{ job: JobView }>()
const draft = computed(() => props.job.publication!)
const progress = computed(() => draft.value.progress)
const missing = computed(() => publicationMissing(draft.value))
const total = computed(() => progress.value?.sizeBytes || draft.value.measured?.file.size || 0)
const transfer = computed(() => progress.value?.stage === 'uploading' && progress.value.phase === 'uploading' ? progress.value.transfer : undefined)
const percent = computed(() => Math.min(100, Math.max(0, transfer.value && total.value ? transfer.value.sentBytes / total.value * 100 : progress.value?.uploadPercent ?? 0)))
const busy = ref(false)
const category = ref('')
const categoryValid = computed(() => !publicationCategoryError(store.state?.plutofish, category.value))
const ready = computed(() => store.state?.plutofish?.status === 'verified')
const active = computed(() => !missing.value.length && !progress.value?.awaitingManual && (!progress.value || ['queued', 'processing', 'uploading'].includes(progress.value.stage)))
const canRelink = computed(() => progress.value?.stage !== 'completed' && !active.value && progress.value?.canRelink !== false)
const fileName = computed(() => (props.job.output || draft.value.output).split(/[\\/]/).pop() || '')
const fileChoice = ref<PublicationFileChoice | null>(null)
const fileError = ref('')
const season = ref('')
const episode = ref('')
const fileInputError = computed(() => {
  if (!fileChoice.value || draft.value.workTarget.mediaType !== 'tv') return ''
  return String(season.value).trim() === '' || String(episode.value).trim() === '' || !Number.isInteger(Number(season.value)) || Number(season.value) < 0 || Number(season.value) > 10000
    || !Number.isInteger(Number(episode.value)) || Number(episode.value) < 0 || Number(episode.value) > 100000 ? '请填写有效的季号和集号，0 为特别篇。' : ''
})
async function chooseFile() {
  busy.value = true
  fileError.value = ''
  try {
    const choice = await gvs('choosePublicationFile', props.job.id)
    if (!choice) return
    fileChoice.value = choice
    season.value = choice.seasonNumber === undefined ? '' : String(choice.seasonNumber)
    episode.value = choice.episodeNumber === undefined ? '' : String(choice.episodeNumber)
  } catch (error) { fileError.value = errText(error) }
  finally { busy.value = false }
}
async function useFile() {
  if (!fileChoice.value || fileInputError.value) return
  busy.value = true
  fileError.value = ''
  try {
    await gvs('relinkPublicationFile', props.job.id, fileChoice.value.token,
      draft.value.workTarget.mediaType === 'tv' ? { seasonNumber: Number(season.value), episodeNumber: Number(episode.value) } : undefined)
    fileChoice.value = null
    toast('已关联新文件，上传时使用此文件名', 'ok')
  } catch (error) { fileError.value = errText(error) }
  finally { busy.value = false }
}
async function control(action: 'pause' | 'resume' | 'setup') {
  busy.value = true
  try {
    if (action === 'setup') {
      if (!categoryValid.value) throw new Error('请选择有效的资源分类')
      await gvs('completePublicationSetup', props.job.id, category.value)
    }
    else await gvs('controlPublication', props.job.id, action)
  } catch (error) { toast(errText(error), 'err') }
  finally { busy.value = false }
}
</script>

<template>
  <section class="upload-progress" aria-label="115 上传进度" :class="{ failed: progress?.stage === 'failed', completed: progress?.stage === 'completed', pending: missing.length }">
    <div class="upload-heading">
      <div class="upload-stages">
        <span class="download-completed"><Icon name="check" :size="13" />下载已完成</span>
        <span class="stage-divider" aria-hidden="true">→</span>
        <strong>{{ publicationStage(draft) }}</strong>
      </div>
      <span v-if="!missing.length" class="mono">{{ percent.toFixed(1) }}%</span>
    </div>
    <div class="upload-file">
      <span :title="job.output || draft.output">上传文件：<span class="mono">{{ fileName }}</span></span>
      <button v-if="canRelink" type="button" class="btn sm" :disabled="busy" @click="chooseFile">重新选择文件</button>
    </div>
    <div v-if="fileChoice" class="file-choice" aria-label="确认上传文件">
      <strong>使用改名或移动后的文件</strong>
      <span class="mono file-choice-name">{{ fileChoice.name }}</span>
      <span class="muted file-choice-path">{{ fileChoice.path }} · {{ human(fileChoice.size) }}</span>
      <template v-if="draft.workTarget.mediaType === 'tv'">
        <p class="muted">{{ !fileChoice.canEditNumbers ? '此任务沿用已保存的发布季集号。' : fileChoice.numbersFromName ? '已从文件名读取季号和集号，请确认。' : '文件名没有明确的 SxxExx，沿用任务季号和集号，请确认。' }}</p>
        <div class="file-numbers">
          <label>季号（0 为特别篇）<input v-model="season" type="number" min="0" max="10000" step="1" aria-label="新文件发布季号" :disabled="busy || !fileChoice.canEditNumbers" /></label>
          <label>集号<input v-model="episode" type="number" min="0" max="100000" step="1" aria-label="新文件发布集号" :disabled="busy || !fileChoice.canEditNumbers" /></label>
        </div>
      </template>
      <p class="muted">确认关联后仍等待你点击上传，文件会保留当前名称。</p>
      <p v-if="fileInputError" class="err" role="alert">{{ fileInputError }}</p>
      <div class="upload-actions">
        <button type="button" class="btn sm primary" :disabled="busy || !!fileInputError" @click="useFile">确认使用此文件</button>
        <button type="button" class="btn sm" :disabled="busy" @click="fileChoice = null; fileError = ''">取消</button>
      </div>
    </div>
    <p v-if="fileError" class="err" role="alert">{{ fileError }}</p>
    <template v-if="!missing.length">
      <div class="progress" :class="{ done: progress?.stage === 'completed', fail: progress?.stage === 'failed', pause: progress?.stage === 'paused' }" role="progressbar" aria-label="上传" :aria-valuenow="percent" :aria-valuemin="0" :aria-valuemax="100">
        <div :style="{ width: percent + '%' }" />
      </div>
      <div class="upload-meta"><span>{{ transfer ? '已发送 ' : '' }}{{ human(transfer?.sentBytes ?? progress?.uploadedBytes ?? 0) || '0 B' }} / {{ human(total) || '待检测' }}</span><span :title="`${draft.binding.sourceAccount?.alias ?? ''} · ${draft.directoryPath || '/'}`">{{ draft.binding.sourceAccount?.alias }} · {{ draft.directoryPath || '/' }}</span></div>
      <div v-if="progress?.stage === 'uploading' && progress.phase === 'uploading'" class="upload-speed" aria-label="上传速度与剩余时间">
        <strong>{{ transfer ? `${uploadBytes(transfer.bytesPerSecond)}/s` : '测速中…' }}</strong>
        <span>{{ transfer?.sentBytes === total ? '等待分片确认' : `剩余${uploadRemaining(transfer?.etaSeconds)}` }}</span>
        <span v-if="transfer && transfer.rateLimit > 0">账号共享上限 {{ uploadBytes(transfer.rateLimit) }}/s</span>
      </div>
    </template>
    <p v-if="progress?.error" class="err" role="alert">{{ progress.error }}</p>
    <p v-if="progress?.awaitingManual" role="status">此任务等待手动上传，文件已保留在本地。点击“立即上传”可上传此文件。</p>
    <p v-if="store.state?.plutofish?.uploadNotice && progress?.stage !== 'completed'" role="status">{{ store.state.plutofish.uploadNotice }}</p>
    <p v-if="!ready && progress?.stage !== 'completed'" class="err">{{ store.state?.plutofish?.error || '等待 PlutoFish 连接恢复' }}</p>
    <div v-if="missing.length" class="upload-setup">
      <template v-if="!draft.workTarget.category && draft.binding.sourceAccount">
        <span>文件已下载，选择分类后即可上传。</span>
        <ResourceCategorySelect v-model="category" label="补全资源分类" :connection="store.state?.plutofish" :disabled="busy" />
        <div class="upload-actions">
          <button class="btn sm" :disabled="busy || !!fileChoice || !ready || !categoryValid" @click="control('setup')">补全并上传</button>
        </div>
      </template>
      <span v-else>{{ missing.join('、') }}尚未配置，请检查发布信息。</span>
    </div>
    <div v-else-if="progress?.stage !== 'completed'" class="upload-actions">
      <button v-if="active" class="btn sm" :disabled="busy" @click="control('pause')">暂停上传</button>
      <button v-else class="btn sm" :disabled="busy || !!fileChoice || !ready" @click="control('resume')">{{ progress?.awaitingManual ? '立即上传' : progress?.stage === 'failed' ? '重试上传' : '继续上传' }}</button>
    </div>
  </section>
</template>

<style scoped>
.upload-progress { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); font-size: 12px; min-width: 0; max-width: 100%; }
.upload-heading, .upload-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.upload-heading { min-width: 0; }
.upload-stages { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.download-completed { display: inline-flex; align-items: center; gap: 4px; color: var(--ok); white-space: nowrap; }
.stage-divider { color: var(--ink-3); }
.upload-heading strong { min-width: 0; overflow-wrap: anywhere; color: var(--orange-text); }
.upload-heading .mono { flex-shrink: 0; white-space: nowrap; }
.upload-meta { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; color: var(--ink-3); }
.upload-meta span { min-width: 0; overflow-wrap: anywhere; }
.upload-speed { display: flex; flex-wrap: wrap; gap: 6px 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.upload-speed strong { color: var(--orange-text); }
.upload-meta span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upload-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.upload-setup { display: grid; gap: 8px; }
.upload-file { display: grid; gap: 6px; justify-items: start; min-width: 0; }
.upload-file > span, .file-choice-name, .file-choice-path { overflow-wrap: anywhere; min-width: 0; max-width: 100%; }
.file-choice { display: grid; gap: 8px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.file-numbers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.file-numbers label { display: grid; gap: 4px; min-width: 0; }
.file-numbers input { width: 100%; min-width: 0; padding: 6px 8px; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 6px; }
select { min-width: 0; max-width: 100%; padding: 7px 9px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
p { margin: 0; overflow-wrap: anywhere; }
.failed .upload-heading strong { color: var(--err); }
.completed .upload-heading strong { color: var(--ok); }
.progress.pause > div { background: var(--ink-3); }
</style>
