<script setup lang="ts">
/**
 * 统一图标：Tabler Icons（@tabler/icons-vue）。保留旧的 name 字符串接口，调用方不用改。
 */
import { computed, type Component } from 'vue'
import {
  IconAlertCircle, IconArrowLeft, IconArrowRight, IconCalendar, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight,
  IconChevronUp, IconClock, IconCompass, IconDots, IconDownload, IconEye, IconEyeOff, IconFile, IconFilter, IconFolder,
  IconFolderOpen, IconHome, IconInfoCircle, IconLayoutGrid, IconLayoutSidebar, IconLink, IconMoon, IconPlayerPauseFilled,
  IconPlayerPlayFilled, IconPoint, IconQrcode, IconRefresh, IconRotateClockwise, IconSearch, IconSettings, IconSparkles,
  IconStar, IconSun, IconDeviceDesktop, IconTrash, IconDeviceTv, IconUser, IconWaveSine, IconWorld, IconX, IconPlus,
} from '@tabler/icons-vue'

const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), { size: 18, stroke: 2 })

const MAP: Record<string, Component> = {
  compass: IconCompass, search: IconSearch, download: IconDownload, gear: IconSettings, check: IconCheck, x: IconX,
  retry: IconRotateClockwise, folder: IconFolder, 'folder-open': IconFolderOpen, arrow: IconArrowRight, back: IconArrowLeft,
  link: IconLink, refresh: IconRefresh, trash: IconTrash, qr: IconQrcode, pause: IconPlayerPauseFilled, play: IconPlayerPlayFilled,
  chevron: IconChevronDown, alert: IconAlertCircle, info: IconInfoCircle, clock: IconClock, file: IconFile, more: IconDots,
  home: IconHome, calendar: IconCalendar, star: IconStar, user: IconUser, sidebar: IconLayoutSidebar, grid: IconLayoutGrid,
  up: IconChevronUp, down: IconChevronDown, eye: IconEye, eyeoff: IconEyeOff, globe: IconWorld, left: IconChevronLeft,
  right: IconChevronRight, filter: IconFilter, tv: IconDeviceTv, sparkles: IconSparkles, wave: IconWaveSine, sun: IconSun,
  moon: IconMoon, system: IconDeviceDesktop, plus: IconPlus,
}

const comp = computed(() => MAP[props.name] ?? IconPoint)
</script>

<template>
  <component :is="comp" :size="size" :stroke="stroke" aria-hidden="true" style="flex-shrink: 0" />
</template>
