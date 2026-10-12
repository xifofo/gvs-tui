<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), { size: 18, stroke: 2 })

const PATHS: Record<string, string[]> = {
  compass: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M15.5 8.5l-2 5-5 2 2-5z'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-4-4'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  gear: [
    'M12 8.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z',
    'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  ],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12M18 6L6 18'],
  retry: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  refresh: ['M4 12a8 8 0 0 1 13.7-5.7L20 8.6', 'M20 4v4.6h-4.6', 'M20 12a8 8 0 0 1-13.7 5.7L4 15.4', 'M4 20v-4.6h4.6'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2'],
  pause: ['M9.5 4.5v15M14.5 4.5v15'],
  play: ['M7.5 4.8v14.4L19 12z'],
  chevron: ['M6 9.5l6 6 6-6'],
  alert: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M12 8v5', 'M12 16.2v.2'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M12 11v5.5', 'M12 7.6v.2'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M12 7.5V12l3 2'],
  file: ['M6 3.5h7l5 5v12H6z', 'M13 3.5v5h5'],
  more: ['M6.2 12h.2M11.9 12h.2M17.6 12h.2'],
  home: ['M4 11l8-6.5 8 6.5', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  calendar: ['M4.5 6h15v14h-15z', 'M4.5 10h15', 'M8.5 3.5v4M15.5 3.5v4'],
  star: ['M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z'],
  user: ['M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  sidebar: ['M4 5h16v14H4z', 'M9.5 5v14'],
  grid: ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  up: ['M6 14.5l6-6 6 6'],
  down: ['M6 9.5l6 6 6-6'],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z'],
  eyeoff: ['M4 4l16 16', 'M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.6', 'M6.3 7.4A15.5 15.5 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 0 0 4.3-1'],
  globe: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M3.5 12h17', 'M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z'],
}

const paths = PATHS[props.name] ?? []
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex-shrink: 0"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>
