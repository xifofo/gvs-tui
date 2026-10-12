<script setup lang="ts">
/**
 * 背景粒子 / 光晕。低开销：≤ 36 个粒子、约 30fps、DPR 固定 1、页面隐藏或窗口失焦时停、
 * prefers-reduced-motion 或设置里关闭动效时不画（只留静态光晕）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ enabled: boolean }>()
const cv = ref<HTMLCanvasElement | null>(null)
let raf = 0
let last = 0
let running = false
let parts: Array<{ x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number }> = []
let w = 0, h = 0
let rgb = '208 135 0'
const reduce = matchMedia('(prefers-reduced-motion: reduce)')

function seed() {
  const c = cv.value
  if (!c) return
  w = c.width = c.clientWidth
  h = c.height = c.clientHeight
  const n = Math.min(36, Math.round((w * h) / 42000))
  parts = Array.from({ length: n }, () => ({
    x: Math.random() * w, y: Math.random() * h, r: 0.6 + Math.random() * 1.8,
    vx: (Math.random() - 0.5) * 0.12, vy: -0.05 - Math.random() * 0.16, a: 0.15 + Math.random() * 0.45, tw: Math.random() * Math.PI * 2,
  }))
  rgb = getComputedStyle(document.documentElement).getPropertyValue('--ui-accent-channel').trim() || rgb
}

function frame(t: number) {
  raf = requestAnimationFrame(frame)
  if (t - last < 33) return
  const dt = Math.min(3, (t - last) / 16.7)
  last = t
  const ctx = cv.value?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.tw += 0.02 * dt
    if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w }
    if (p.x < -6) p.x = w + 6; else if (p.x > w + 6) p.x = -6
    const a = p.a * (0.6 + 0.4 * Math.sin(p.tw))
    ctx.beginPath()
    ctx.fillStyle = `rgb(${rgb} / ${a.toFixed(3)})`
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function sync() {
  const want = props.enabled && !reduce.matches && !document.hidden && !document.documentElement.classList.contains('no-motion')
  if (want === running) return
  running = want
  if (want) { seed(); last = 0; raf = requestAnimationFrame(frame) }
  else { cancelAnimationFrame(raf); cv.value?.getContext('2d')?.clearRect(0, 0, w, h) }
}
let ro: ResizeObserver | null = null
const themeObs = new MutationObserver(() => { rgb = getComputedStyle(document.documentElement).getPropertyValue('--ui-accent-channel').trim() || rgb })
onMounted(() => {
  document.addEventListener('visibilitychange', sync)
  reduce.addEventListener('change', sync)
  ro = new ResizeObserver(() => { if (running) seed() })
  if (cv.value) ro.observe(cv.value)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  sync()
})
watch(() => props.enabled, sync)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  document.removeEventListener('visibilitychange', sync)
  reduce.removeEventListener('change', sync)
  ro?.disconnect()
  themeObs.disconnect()
})
</script>

<template>
  <div class="amb" aria-hidden="true">
    <i class="g1" /><i class="g2" />
    <canvas ref="cv" />
  </div>
</template>

<style scoped>
.amb { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
i { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; }
.g1 { opacity: var(--amb-1, .5); width: 520px; height: 360px; left: 38%; top: -220px; background: rgb(var(--ui-accent-channel) / 18%); animation: drift 26s ease-in-out infinite alternate; }
.g2 { opacity: var(--amb-2, .5); width: 420px; height: 420px; right: -160px; bottom: -220px; background: rgb(120 90 255 / 9%); animation: drift 32s ease-in-out infinite alternate-reverse; }
@keyframes drift { to { transform: translate(-60px, 40px) scale(1.08); } }
</style>
