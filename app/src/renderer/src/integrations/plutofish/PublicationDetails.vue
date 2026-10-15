<!-- 本地草稿可展开核对身份与成品实测值；不把准备完成显示为已上传或已发布。 -->
<script setup lang="ts">
import type { PublicationDraft } from '@shared/api'
import { actualVersionSummary } from '../../../../../../src/lib/actual-version'
defineProps<{ draft?: PublicationDraft }>()
</script>

<template>
  <details v-if="draft" class="publication-details">
    <summary>发布详情</summary>
    <dl>
      <dt>发布目标</dt><dd>{{ draft.binding.url }} · {{ draft.binding.sourceAccount?.alias || '未绑定源账号' }}</dd>
      <dt>作品</dt><dd>{{ draft.workTarget.mediaType === 'movie' ? '电影' : '剧集' }} · {{ draft.workTarget.tmdbId ? `TMDB ${draft.workTarget.tmdbId}` : `${draft.workTarget.sourceProvider || '平台'} · ${draft.workTarget.sourceWorkId || '作品 ID 待补全'}` }} · {{ draft.categoryLabel || '分类待补全' }}</dd>
      <template v-if="draft.workTarget.mediaType === 'tv'"><dt>季／集</dt><dd>{{ draft.seasonNumber }} / {{ draft.episodeNumber }}</dd></template>
      <dt>上传目录</dt><dd>{{ draft.directoryPath || ((!draft.directoryId || draft.directoryId === '0') ? '根目录 /' : `目录 ${draft.directoryId}`) }}</dd>
      <template v-if="draft.progress">
        <dt>下载／上传</dt><dd>{{ draft.progress.downloadPercent.toFixed(1) }}% ／ {{ draft.progress.uploadPercent.toFixed(1) }}%</dd>
      </template>
      <dt>版本标识</dt><dd class="mono">{{ draft.releaseKey }}</dd>
      <dt>文件标识</dt><dd class="mono">{{ draft.fileKey }}</dd>
      <dt>实际规格</dt><dd>{{ draft.measured ? actualVersionSummary(draft.measured) || '未取得有效媒体规格' : '等待成品检测' }}</dd>
    </dl>
  </details>
</template>

<style scoped>
.publication-details { font-size: 12px; margin-top: 6px; min-width: 0; }
summary { cursor: pointer; color: var(--ink-2); }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; margin: 10px 0; }
dt { color: var(--ink-2); }
dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
</style>
