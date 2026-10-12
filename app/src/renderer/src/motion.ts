/**
 * 主题（dark / light / system）、动效开关、跨页过渡（View Transitions API + 海报→详情共享元素）。
 * 偏好存 UiPrefs（tui.json），并镜像到 localStorage 以便首帧（未连上主进程前）就用对主题。
 */
import { nextTick, ref } from 'vue'

/** View Transition 进行中：App.vue 关掉 Vue <Transition> 的 CSS，避免两套动画叠加 */
export const vtActive = ref(false)

export type ThemePref = 'dark' | 'light' | 'system'
const LS = 'gvs.theme'
const LS_MOTION = 'gvs.motion'
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
let current: ThemePref = 'dark'

export function resolveTheme(pref: ThemePref, systemLight: boolean): 'dark' | 'light' {
  return pref === 'system' ? (systemLight ? 'light' : 'dark') : pref
}

function paint(animate: boolean): void {
  const el = document.documentElement
  const t = resolveTheme(current, !!media?.matches)
  if (el.classList.contains(t)) return
  if (animate && !reducedMotion()) {
    el.classList.add('theme-anim')
    setTimeout(() => el.classList.remove('theme-anim'), 320)
  }
  el.classList.remove('dark', 'light')
  el.classList.add(t)
}

export function applyTheme(pref: ThemePref | undefined, animate = false): void {
  current = pref === 'light' || pref === 'system' ? pref : 'dark'
  try { localStorage.setItem(LS, current) } catch { /* ignore */ }
  paint(animate)
}

/** 动效开关：关闭时禁用背景粒子并把过渡压到 1ms */
export function applyMotion(on: boolean): void {
  document.documentElement.classList.toggle('no-motion', !on)
  try { localStorage.setItem(LS_MOTION, on ? '1' : '0') } catch { /* ignore */ }
}

export function reducedMotion(): boolean {
  return !!reduce?.matches || document.documentElement.classList.contains('no-motion')
}

export function initTheme(): void {
  let saved: string | null = null
  let motion: string | null = null
  try { saved = localStorage.getItem(LS); motion = localStorage.getItem(LS_MOTION) } catch { /* ignore */ }
  applyTheme((saved as ThemePref) ?? 'dark')
  applyMotion(motion !== '0')
  media?.addEventListener('change', () => paint(true))
}

/* ---------- 跨页过渡 ---------- */
type VTDoc = Document & { startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> } }
export const supportsViewTransition = (): boolean => typeof (document as VTDoc).startViewTransition === 'function'

let heroEl: HTMLElement | null = null
let heroAt = 0
/** 记住最近一次点击的海报，作为跳详情时的共享元素 */
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    const p = (e.target as HTMLElement | null)?.closest?.('.poster, [data-hero]') as HTMLElement | null
    const card = p ?? ((e.target as HTMLElement | null)?.closest?.('[data-card]')?.querySelector('.poster') as HTMLElement | null)
    if (card) { heroEl = card; heroAt = Date.now() }
  }, true)
}

/** 包一层 View Transition；不支持或关闭动效时直接执行 */
/** 只在「海报 → 详情」和「详情 → 返回」时用（共享元素）；其它页面切换走 Vue <Transition>，store.view 同步更新 */
export function viewTransition(mutate: () => void, toDetail = false, fromDetail = false): void {
  if (typeof document === 'undefined' || !supportsViewTransition() || reducedMotion()) { mutate(); return }
  const doc = document as VTDoc
  const hero = toDetail && heroEl && Date.now() - heroAt < 1500 && heroEl.isConnected ? heroEl : null
  if (!hero && !fromDetail) { mutate(); return }
  if (hero) hero.style.viewTransitionName = 'hero-poster'
  document.documentElement.classList.add('vt-detail', 'vt-run')
  const t = doc.startViewTransition!(async () => {
    if (hero) hero.style.viewTransitionName = ''
    vtActive.value = true
    mutate()
    // <Transition mode="out-in"> 先卸旧页（duration 0 → setTimeout）再挂新页，等它落定再让浏览器截新快照
    await nextTick()
    await new Promise((r) => setTimeout(r, 32))
    await nextTick()
  })
  void t.finished.finally(() => { vtActive.value = false; document.documentElement.classList.remove('vt-detail', 'vt-run'); heroEl = null })
}
