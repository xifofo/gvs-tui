<script setup lang="ts">
import { computed } from 'vue'
import type { AudioView } from '@shared/api'
import { iqcnAudioGroups } from '@shared/iqcn-audio-ui'

const props = defineProps<{ audios: AudioView[]; selectedIds: string[]; defaultId: string }>()
const emit = defineEmits<{ toggle: [audio: AudioView]; setDefault: [audio: AudioView]; all: []; onlyDefault: [] }>()
const groups = computed(() => iqcnAudioGroups(props.audios))
const picked = (audio: AudioView) => audio.embedded || props.selectedIds.includes(audio.id)
const pickedCount = computed(() => props.audios.filter(picked).length)
</script>

<template>
  <fieldset class="audio-picker">
    <legend class="sr-only">选择下载音轨和默认播放音轨</legend>
    <div class="audio-heading">
      <div class="audio-heading-copy"><h2>音轨</h2><span>已选 {{ pickedCount }} 条</span></div>
      <div class="audio-actions">
        <button type="button" @click="emit('onlyDefault')">只选默认</button>
        <button type="button" @click="emit('all')">全选</button>
      </div>
    </div>
    <p class="audio-help">勾选要下载的音轨，再选择打开视频时默认播放哪一条。</p>
    <section v-for="group in groups" :key="group.language" class="audio-language" :aria-label="`${group.language}音轨`">
      <div class="language-heading"><h3>{{ group.language }}</h3><span>默认播放</span></div>
      <div v-for="row in group.items" :key="row.audio.id" class="audio-row" :class="{ picked: picked(row.audio) }">
        <label class="audio-choice">
          <input type="checkbox" :checked="picked(row.audio)" :aria-label="`下载${group.language}${row.title}`"
            :disabled="row.audio.embedded || (selectedIds.length === 1 && picked(row.audio))" @change="emit('toggle', row.audio)" />
          <span class="audio-copy"><span class="audio-title">{{ row.title }}<span v-if="row.recommended" class="recommended">平台默认</span></span><span class="audio-detail">{{ row.detail }}</span></span>
        </label>
        <label v-if="!row.audio.embedded" class="default-choice" :class="{ active: defaultId === row.audio.id }">
          <input type="radio" name="iqcn-default-audio" :checked="defaultId === row.audio.id"
            :aria-label="`${group.language}${row.title}设为默认播放`" @change="emit('setDefault', row.audio)" />
          <span>{{ defaultId === row.audio.id ? '默认' : '设为默认' }}</span>
        </label>
        <span v-else class="embedded-note">随视频</span>
      </div>
    </section>
    <p class="audio-footnote">可选择多条音轨，每种只保留一条。批量下载沿用此选择。</p>
  </fieldset>
</template>

<style scoped>
.audio-picker { min-width: 0; margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.audio-heading, .audio-heading-copy, .audio-actions, .language-heading, .audio-row, .audio-choice, .default-choice, .audio-title { display: flex; align-items: center; }
.audio-heading { justify-content: space-between; gap: 16px; }
.audio-heading-copy { gap: 12px; }
.audio-heading h2 { margin: 0; font-size: 16px; font-weight: 700; }
.audio-heading-copy > span { color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.audio-actions { gap: 14px; }
.audio-actions button { padding: 3px 0; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; cursor: pointer; }
.audio-actions button:hover { color: var(--ink); text-decoration: underline; }
.audio-actions button:focus-visible { outline: 2px solid var(--orange); outline-offset: 4px; }
.audio-help, .audio-footnote { margin: 8px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.audio-language { margin-top: 16px; }
.language-heading { justify-content: space-between; gap: 12px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }
.language-heading h3 { margin: 0; color: var(--ink-2); font-size: 12px; font-weight: 600; }
.language-heading > span { width: 100px; color: var(--ink-3); font-size: 11px; text-align: center; }
.audio-row { min-height: 62px; gap: 12px; border-bottom: 1px solid var(--line); transition: background-color 150ms; }
.audio-row:last-child { border-bottom: 0; }
.audio-row:hover { background: var(--paper-2); }
.audio-choice { flex: 1; min-width: 0; gap: 12px; padding: 10px 0; cursor: pointer; }
input { width: 16px; height: 16px; margin: 0; accent-color: var(--ink); flex: 0 0 auto; cursor: pointer; }
input:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
input:disabled { cursor: default; }
.audio-copy { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
.audio-title { flex-wrap: wrap; gap: 8px; color: var(--ink-2); font-size: 14px; }
.picked .audio-title { color: var(--ink); font-weight: 600; }
.audio-detail { color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.recommended { font-size: 10px; font-weight: 500; color: var(--ink-3); white-space: nowrap; }
.default-choice { justify-content: center; flex: 0 0 100px; gap: 7px; color: var(--ink-3); font-size: 12px; cursor: pointer; }
.default-choice.active { color: var(--ink); font-weight: 600; }
.embedded-note { flex: 0 0 100px; text-align: center; color: var(--ink-3); font-size: 12px; }
.audio-footnote { border-top: 1px solid var(--line); padding-top: 10px; }
@media (max-width: 520px) {
  .audio-picker { padding: 16px; }
  .audio-heading-copy { gap: 8px; }
  .audio-row { gap: 8px; }
  .default-choice, .embedded-note { flex-basis: 86px; }
  .language-heading > span { width: 86px; }
}
@media (prefers-reduced-motion: reduce) { .audio-row { transition: none; } }
</style>
