<!-- 只展示发布器确认的保存与清理状态，不推断 ED2K 云下载可用性。 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { RetentionProgress } from '../../../../../../src/integrations/plutofish/publication-types'

const props = defineProps<{ progress?: RetentionProgress }>()
const labels: Record<RetentionProgress['state'], string> = {
  waiting_publish: '上传并登记成功后开始保留计时',
  waiting_ed2k: '等待 ED2K 生成，暂不删除',
  waiting_save: '等待服务器保存 ED2K，暂不删除',
  retained: '本地成品保留中',
  due: '已到期，等待清理',
  busy: '文件仍被任务使用，延后删除',
  changed: '文件已改变，跳过自动删除',
  failed: '清理失败，稍后重试',
  disabled: '自动删除已关闭',
  policy_error: '保留设置无法读取，自动清理已停止',
  deleted: '本地文件已删除',
}
const warning = computed(() => ['changed', 'failed', 'policy_error'].includes(props.progress?.state ?? ''))
const deadline = computed(() => props.progress?.deleteAt && !['deleted', 'disabled', 'policy_error'].includes(props.progress.state)
  ? new Date(props.progress.deleteAt).toLocaleString() : '')
</script>

<template>
  <span v-if="progress" class="retention-status dim small" :class="{ warning }" role="status">
    <span v-if="progress.ed2kSaved">ED2K 已保存到服务器 · </span>{{ labels[progress.state] }}
    <span v-if="deadline"> · 计划删除：{{ deadline }}</span>
  </span>
</template>

<style scoped>
.retention-status { display: block; overflow-wrap: anywhere; }
.warning { color: var(--warn); }
</style>
