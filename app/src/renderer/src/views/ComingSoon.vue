<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import { go, store } from '../store'

const info = computed(() => store.view === 'calendar'
  ? { title: '追剧日历', icon: 'calendar', lines: ['按周 / 月查看订阅剧集的更新时间：平台更新预告、TMDB 播出日期与手动时间表。', '已下载、待更新、已更新未下载、失败分别用不同颜色标出。'] }
  : { title: '订阅', icon: 'star', lines: ['订阅在追的剧，按播出时间自动检查新集。', '按画质 / 编码 / 音轨规则组匹配后自动下载或仅通知。'] })
</script>

<template>
  <div class="page">
    <h1 class="h1">{{ info.title }}</h1>
    <div class="card soon">
      <Icon :name="info.icon" :size="34" />
      <b>即将推出</b>
      <p v-for="l in info.lines" :key="l" class="muted">{{ l }}</p>
      <div class="acts">
        <button type="button" class="btn" @click="store.paletteOpen = true"><Icon name="search" :size="15" />先去搜索一部剧</button>
        <button type="button" class="btn" @click="go('downloads')"><Icon name="download" :size="15" />查看下载</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.soon { padding: 48px 32px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; border-style: dashed; }
.soon b { font-size: 18px; }
.soon p { font-size: 14px; max-width: 560px; line-height: 1.7; }
.acts { display: flex; gap: 10px; margin-top: 8px; }
</style>
