<script setup lang="ts">
import { computed } from 'vue'
import { PLATFORM_ICONS } from '../assets/platforms/platform-icons'
import youku from '../assets/platforms/youku.svg'
import tencent from '../assets/platforms/tencent.svg'
import douyin from '../assets/platforms/douyin.svg'
import iq from '../assets/platforms/iq.svg'
import mewatch from '../assets/platforms/mewatch.png'
import hamivideo from '../assets/platforms/hamivideo.png'

const props = withDefaults(defineProps<{ provider: string; size?: number }>(), { size: 18 })
/** 官方素材只取轮廓（CSS 蒙版），统一染成白色 */
const MASKS: Record<string, string> = { youku, tencent, douyin, iq, mewatch, hamivideo }
const icon = computed(() => PLATFORM_ICONS[props.provider])
const fallbackText = computed(() => (props.provider.slice(0, 1) || '?').toUpperCase())
const text = computed(() => (icon.value?.glyph.kind === 'text' ? icon.value.glyph.text : fallbackText.value))
const fontSize = computed(() => Math.max(7, Math.round(props.size * (text.value.length >= 4 ? 0.3 : text.value.length === 3 ? 0.36 : text.value.length === 2 ? 0.42 : 0.58))))
const tile = computed(() => ({ width: props.size + 'px', height: props.size + 'px', background: icon.value?.color ?? '#5b5b66', borderRadius: Math.max(3, Math.round(props.size * 0.24)) + 'px' }))
const maskUrl = computed(() => (icon.value?.glyph.kind === 'mask' && MASKS[icon.value.glyph.asset] ? `url("${MASKS[icon.value.glyph.asset]}")` : ''))
</script>

<template>
  <span class="plogo" :style="tile" :title="icon?.name" :data-provider="provider" aria-hidden="true">
    <svg v-if="icon?.glyph.kind === 'path'" class="g" viewBox="0 0 24 24" fill="#fff"><path :d="icon.glyph.d" /></svg>
    <span v-else-if="maskUrl" class="g m" :style="{ maskImage: maskUrl, WebkitMaskImage: maskUrl }" />
    <span v-else class="t" :style="{ fontSize: fontSize + 'px' }">{{ text }}</span>
  </span>
</template>

<style scoped>
.plogo { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 14%); vertical-align: middle; }
.g { width: 64%; height: 64%; display: block; }
.m { background: #fff; mask-size: contain; mask-repeat: no-repeat; mask-position: center; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; width: 74%; height: 74%; }
.t { color: #fff; font-weight: 900; line-height: 1; letter-spacing: -0.02em; white-space: nowrap; font-family: var(--font-display, inherit); }
</style>
