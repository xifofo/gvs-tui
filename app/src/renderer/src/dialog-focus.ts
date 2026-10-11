import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Keep keyboard navigation inside the active dialog and restore the opener. */
export function useDialogFocus(root: Ref<HTMLElement | null>, close: () => void): void {
  let previous: HTMLElement | null = null
  const controls = () => [...(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])]
    .filter(el => el.getClientRects().length > 0)
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation(); return }
    if (event.key !== 'Tab') return
    const items = controls()
    const first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); root.value?.focus(); return }
    if (!root.value?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  onMounted(async () => {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.addEventListener('keydown', key, true)
    await nextTick()
    if (root.value?.isConnected) (root.value.querySelector<HTMLElement>('[data-dialog-cancel]') ?? controls()[0] ?? root.value).focus()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', key, true)
    if (previous?.isConnected) previous.focus()
  })
}
