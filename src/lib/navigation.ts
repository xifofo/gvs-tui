import type { Scene } from '../types'
export type Location = { scene: Scene; cursor: number; payload?: unknown }
export class Navigation {
  private stack: Location[] = []
  push(scene: Scene, cursor: number, payload?: unknown) {
    this.stack.push({ scene, cursor, payload })
  }
  pop(): Location {
    return this.stack.pop() ?? { scene: 'workspace', cursor: 0 }
  }
  clear() {
    this.stack = []
  }
}
/** Up/down move one job. Left/right and PageUp/PageDown flip a fixed-size page. */
export function moveJobCursor(cursor: number, key: string, total: number, page = 50) {
  if (key === 'left' || key === 'right' || key === 'pageup' || key === 'pagedown') {
    const last = Math.max(0, total - 1)
    const at = Math.max(0, Math.min(last, Number.isFinite(cursor) ? Math.floor(cursor) : 0))
    const pageIndex = Math.floor(at / page)
    const offset = at - pageIndex * page
    const lastPage = Math.floor(last / page)
    const next =
      key === 'left' || key === 'pageup'
        ? Math.max(0, pageIndex - 1)
        : Math.min(lastPage, pageIndex + 1)
    return Math.min(last, next * page + offset)
  }
  return moveCursor(cursor, key, total, page)
}

export function moveCursor(
  cursor: number,
  key: string,
  total: number,
  page: number,
  columns = 1,
) {
  const last = Math.max(0, total - 1)
  const delta =
    key === 'up'
      ? -columns
      : key === 'down'
        ? columns
        : key === 'left'
          ? -1
          : key === 'right'
            ? 1
            : key === 'pageup'
              ? -page
              : key === 'pagedown'
                ? page
                : 0
  return key === 'home'
    ? 0
    : key === 'end'
      ? last
      : Math.max(0, Math.min(last, cursor + delta))
}
