/** 密钥不交给可见 Input 渲染，按键和粘贴直接送到 runtime 的私有编辑状态。 */
import type { Snapshot } from '../../types.ts'
export function isConnectionSecret(state: Snapshot): boolean {
  return state.scene === 'setup' && [1, 3].includes(state.connectionForm?.field ?? 0)
}
export function connectionSecretKey(state: Snapshot, event: { name: string; ctrl: boolean; meta: boolean; super: boolean; sequence: string }, set: (field: string, value: string) => void): boolean {
  if (!isConnectionSecret(state)) return false
  const name = event.name.toLowerCase()
  if (['enter', 'return', 'tab', 'escape', 'esc'].includes(name)) return false
  if (event.ctrl && name === 'u') set('connectionSecretClear', '')
  else if (name === 'backspace') set('connectionSecretBackspace', '')
  else if (!event.ctrl && !event.meta && !event.super && event.sequence && !/[\x00-\x1f\x7f]/.test(event.sequence)) set('connectionSecretAppend', event.sequence)
  return true
}
