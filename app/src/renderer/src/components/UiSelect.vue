<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'

/**
 * Styled single-select listbox (WAI-ARIA "select-only combobox").
 * Focus stays on the trigger; the popup is teleported to <body> so drawers
 * with overflow never clip it. Keys: ↑/↓/Home/End move, Enter/Space pick,
 * Esc/Tab close, typing jumps to the first matching label.
 */
export type UiOption<V> = { value: V; label: string; disabled?: boolean }
const props = withDefaults(defineProps<{ modelValue: T; options: UiOption<T>[]; ariaLabel?: string; disabled?: boolean; placeholder?: string }>(), { ariaLabel: undefined, disabled: false, placeholder: '请选择' })
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T] }>()

const uid = `uisel-${Math.random().toString(36).slice(2, 9)}`
const open = ref(false)
const active = ref(-1)
const trigger = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0, width: 0, maxHeight: 280, up: false })
const current = computed(() => props.options.find((o) => o.value === props.modelValue))
let typed = ''
let typedAt = 0

function place() {
  const r = trigger.value?.getBoundingClientRect()
  if (!r) return
  const below = window.innerHeight - r.bottom - 8
  const up = below < 180 && r.top > below
  pos.value = { left: r.left, width: r.width, top: up ? r.top - 6 : r.bottom + 6, maxHeight: Math.max(120, Math.min(280, (up ? r.top : below) - 12)), up }
}
function enabledIndex(from: number, step: number): number {
  const n = props.options.length
  for (let i = 0, k = from; i < n; i++, k += step) {
    const j = ((k % n) + n) % n
    if (!props.options[j].disabled) return j
  }
  return -1
}
async function show() {
  if (props.disabled || open.value) return
  place()
  open.value = true
  const sel = props.options.findIndex((o) => o.value === props.modelValue)
  active.value = sel >= 0 ? sel : enabledIndex(0, 1)
  await nextTick()
  scrollActive()
}
function hide(focus = true) {
  open.value = false
  if (focus) trigger.value?.focus()
}
function pick(i: number) {
  const o = props.options[i]
  if (!o || o.disabled) return
  if (o.value !== props.modelValue) { emit('update:modelValue', o.value); emit('change', o.value) }
  hide()
}
function scrollActive() {
  list.value?.querySelector<HTMLElement>(`#${uid}-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}
function move(i: number) { if (i >= 0) { active.value = i; void nextTick(scrollActive) } }
function onKey(e: KeyboardEvent) {
  if (props.disabled) return
  const k = e.key
  if (!open.value) {
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); void show() }
    return
  }
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); hide() }
  else if (k === 'Tab') hide(false)
  else if (k === 'ArrowDown') { e.preventDefault(); move(enabledIndex(active.value + 1, 1)) }
  else if (k === 'ArrowUp') { e.preventDefault(); move(enabledIndex(active.value - 1, -1)) }
  else if (k === 'Home') { e.preventDefault(); move(enabledIndex(0, 1)) }
  else if (k === 'End') { e.preventDefault(); move(enabledIndex(props.options.length - 1, -1)) }
  else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(active.value) }
  else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const now = Date.now()
    typed = now - typedAt > 700 ? k : typed + k
    typedAt = now
    const i = props.options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.toLowerCase()))
    move(i)
  }
}
function outside(e: MouseEvent) {
  const t = e.target as Node
  if (!trigger.value?.contains(t) && !list.value?.contains(t)) hide(false)
}
function reflow() { if (open.value) place() }
function unlisten() {
  document.removeEventListener('mousedown', outside, true)
  window.removeEventListener('resize', reflow)
  window.removeEventListener('scroll', reflow, true)
}
watch(open, (v) => {
  unlisten()
  if (!v) return
  document.addEventListener('mousedown', outside, true)
  window.addEventListener('resize', reflow)
  window.addEventListener('scroll', reflow, true)
})
onBeforeUnmount(unlisten)
</script>

<template>
  <button
    ref="trigger" type="button" class="input ui-select" :class="{ open }" role="combobox"
    :aria-label="ariaLabel" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="`${uid}-list`"
    :aria-activedescendant="open && active >= 0 ? `${uid}-${active}` : undefined" :disabled="disabled"
    @click="open ? hide() : show()" @keydown="onKey"
  >
    <span class="val" :class="{ ph: !current }">{{ current?.label ?? placeholder }}</span>
    <Icon name="down" :size="15" class="caret" />
  </button>
  <Teleport to="body">
    <ul
      v-if="open" :id="`${uid}-list`" ref="list" class="ui-select-pop" :class="{ up: pos.up }" role="listbox" :aria-label="ariaLabel"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, minWidth: `${pos.width}px`, maxHeight: `${pos.maxHeight}px` }"
    >
      <li
        v-for="(o, i) in options" :id="`${uid}-${i}`" :key="String(o.value)" role="option"
        :aria-selected="o.value === modelValue" :aria-disabled="o.disabled || undefined"
        :class="{ active: i === active, sel: o.value === modelValue, dis: o.disabled }"
        @mousemove="!o.disabled && (active = i)" @mousedown.prevent @click="pick(i)"
      >
        <span>{{ o.label }}</span><Icon v-if="o.value === modelValue" name="check" :size="14" class="tick" />
      </li>
    </ul>
  </Teleport>
</template>