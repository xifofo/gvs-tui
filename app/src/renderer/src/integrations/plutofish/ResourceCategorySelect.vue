<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PlutoFishView } from '@shared/api'
import { publicationCategoryError } from '../../../../../../src/integrations/plutofish/categories'
import { errText, gvs, store } from '../../store'

const props = defineProps<{ connection?: PlutoFishView; disabled?: boolean; label?: string }>()
const model = defineModel<string>({ required: true })
const refreshing = ref(false)
const error = ref('')
const categories = computed(() => props.connection?.identity?.categories)
const validation = computed(() => publicationCategoryError(props.connection, model.value))
let pending: Promise<void> | undefined
function refresh(): Promise<void> {
  if (pending) return pending
  refreshing.value = true
  error.value = ''
  pending = gvs('refreshPublicationCategories').then(connection => {
    if (store.state) store.state.plutofish = connection
  }).catch(e => { error.value = errText(e) }).finally(() => { refreshing.value = false; pending = undefined })
  return pending
}
// 旧连接快照没有分类时主动重取；空数组返回后不会反复轮询。
watch(() => JSON.stringify([props.connection?.status, props.connection?.url, props.connection?.identity?.id,
  props.connection?.identity?.sourceAccount?.id]), () => {
  error.value = ''
  if (props.connection?.status === 'verified' && !categories.value?.length) void refresh()
}, { immediate: true })
</script>

<template>
  <div class="resource-category">
    <label class="category-label">
      <span>资源分类 <span class="required" aria-hidden="true">*</span></span>
      <div class="category-control">
        <select :value="model" required aria-required="true" :aria-label="label || '资源分类'" :aria-invalid="!!validation" :disabled="disabled || refreshing || connection?.status !== 'verified' || !categories?.length" @change="model = ($event.target as HTMLSelectElement).value">
          <option value="" disabled>{{ refreshing ? '正在获取分类…' : categories?.length ? '请选择资源分类' : '暂无可选分类' }}</option>
          <option v-for="c in categories" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
        <button type="button" class="btn sm" aria-label="刷新资源分类" :disabled="disabled || refreshing || connection?.status !== 'verified'" @click="refresh">{{ refreshing ? '获取中…' : '刷新' }}</button>
      </div>
    </label>
    <span v-if="error" class="category-error" role="alert">{{ error }}</span>
    <span v-else-if="validation && !refreshing" class="category-error">{{ validation }}</span>
  </div>
</template>

<style scoped>
.resource-category, .category-label { display: grid; gap: 6px; min-width: 0; font-size: 12px; }
.category-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
select { flex: 1; width: 100%; min-width: 0; padding: 8px; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.category-control button { flex-shrink: 0; }
.required, .category-error { color: var(--err); }
.category-error { line-height: 1.5; }
</style>
