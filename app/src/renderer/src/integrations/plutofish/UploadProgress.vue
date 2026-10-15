<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JobView } from '@shared/api'
import { publicationMissing, publicationStage } from '../../../../../../src/integrations/plutofish/publication-types'
import { errText, gvs, human, store, toast } from '../../store'
import ResourceCategorySelect from './ResourceCategorySelect.vue'
import { publicationCategoryError } from '../../../../../../src/integrations/plutofish/categories'

const props = defineProps<{ job: JobView }>()
const draft = computed(() => props.job.publication!)
const progress = computed(() => draft.value.progress)
const missing = computed(() => publicationMissing(draft.value))
const percent = computed(() => Math.min(100, Math.max(0, progress.value?.uploadPercent ?? 0)))
const total = computed(() => progress.value?.sizeBytes || draft.value.measured?.file.size || 0)
const busy = ref(false)
const category = ref('')
const categoryValid = computed(() => !publicationCategoryError(store.state?.plutofish, category.value))
const ready = computed(() => store.state?.plutofish?.status === 'verified')
const active = computed(() => !missing.value.length && (!progress.value || ['queued', 'processing', 'uploading'].includes(progress.value.stage)))
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
      <strong>{{ publicationStage(draft) }}</strong>
      <span v-if="!missing.length" class="mono">{{ percent.toFixed(1) }}%</span>
    </div>
    <template v-if="!missing.length">
      <div class="progress" :class="{ done: progress?.stage === 'completed', fail: progress?.stage === 'failed', pause: progress?.stage === 'paused' }" role="progressbar" aria-label="上传" :aria-valuenow="percent" :aria-valuemin="0" :aria-valuemax="100">
        <div :style="{ width: percent + '%' }" />
      </div>
      <div class="upload-meta"><span>{{ human(progress?.uploadedBytes ?? 0) || '0 B' }} / {{ human(total) || '待检测' }}</span><span :title="draft.directoryPath">{{ draft.directoryPath || '/' }}</span></div>
    </template>
    <p v-if="progress?.error" class="err" role="alert">{{ progress.error }}</p>
    <p v-if="!ready && progress?.stage !== 'completed'" class="err">{{ store.state?.plutofish?.error || '等待 PlutoFish 连接恢复' }}</p>
    <div v-if="missing.length" class="upload-setup">
      <template v-if="!draft.workTarget.category && draft.binding.sourceAccount">
        <span>文件已下载，选择分类后即可上传。</span>
        <ResourceCategorySelect v-model="category" label="补全资源分类" :connection="store.state?.plutofish" :disabled="busy" />
        <div class="upload-actions">
          <button class="btn sm" :disabled="busy || !ready || !categoryValid" @click="control('setup')">补全并上传</button>
        </div>
      </template>
      <span v-else>{{ missing.join('、') }}尚未配置，请检查发布信息。</span>
    </div>
    <div v-else-if="progress?.stage !== 'completed'" class="upload-actions">
      <button v-if="active" class="btn sm" :disabled="busy" @click="control('pause')">暂停上传</button>
      <button v-else class="btn sm" :disabled="busy || !ready" @click="control('resume')">{{ progress?.stage === 'failed' ? '重试上传' : '继续上传' }}</button>
    </div>
  </section>
</template>

<style scoped>
.upload-progress { display: grid; gap: 8px; margin: 10px 0 4px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); font-size: 12px; min-width: 0; }
.upload-heading, .upload-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.upload-heading strong { color: var(--orange-text); }
.upload-meta { color: var(--ink-3); }
.upload-meta span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upload-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.upload-setup { display: grid; gap: 8px; }
select { min-width: 0; max-width: 100%; padding: 7px 9px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
p { margin: 0; overflow-wrap: anywhere; }
.failed .upload-heading strong { color: var(--err); }
.completed .upload-heading strong { color: var(--ok); }
.progress.pause > div { background: var(--ink-3); }
</style>
