<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ url?: string; provider?: string; title?: string; titleSize?: number; loading?: 'eager' | 'lazy' }>(), {
  url: '',
  provider: '',
  title: '',
  titleSize: 18,
  loading: 'eager',
})

const COLORS = ['#2b3a55', '#7a2e2e', '#3e5c3a', '#5b4a7a', '#8a5a1f', '#2f5f66', '#4a4a4a', '#6b2e4f']
const failed = ref(false)
const loaded = ref(false)
watch(
  () => [props.url, props.provider],
  () => {
    failed.value = false
    loaded.value = false
  },
)
const src = computed(() =>
  props.url && !failed.value ? `gvs-img://poster/?u=${encodeURIComponent(props.url)}&p=${encodeURIComponent(props.provider)}` : '',
)
const color = computed(() => {
  let h = 0
  for (const c of props.title) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
})
</script>

<template>
  <div class="poster" :style="{ background: src ? 'var(--paper-2)' : `linear-gradient(165deg, ${color} 0%, color-mix(in srgb, ${color} 55%, #05050a) 100%)` }" role="img" :aria-label="title ? `${title} 海报` : '海报'">
    <span v-if="src && !loaded" class="sk wash" aria-hidden="true" />
    <img v-if="src" :src="src" alt="" :loading="loading" decoding="async" :class="{ on: loaded }" @load="loaded = true" @error="failed = true" />
    <span v-else-if="title" class="t fb" :style="{ fontSize: titleSize + 'px' }">{{ title }}</span>
  </div>
</template>

<style scoped>
.poster {
  position: relative; overflow: hidden; border-radius: var(--ui-radius-sm); flex-shrink: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-end; padding: 12px;
  border: 1px solid var(--line); box-shadow: var(--ui-poster-shadow);
}
.poster::after { content: ''; position: absolute; inset: auto 0 0; height: 50%; background: linear-gradient(to top, rgb(2 3 8 / 72%), transparent); pointer-events: none; }
.poster:has(img.on)::after { opacity: 0; }
.fb { position: relative; z-index: 1; }
.poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .2s ease; }
.poster img.on { opacity: 1; }
.wash { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 0; }
@media (prefers-reduced-motion: reduce) { .poster img { transition: none; } }
.t { font-weight: 900; line-height: 1.15; text-wrap: balance; word-break: break-word; }
</style>
