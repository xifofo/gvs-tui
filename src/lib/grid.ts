/**
 * Episode grid metrics. Pure math, shared by the picker that renders the cells
 * and by the shell that reports the scrolling range — and by the runtime, which
 * steps the cursor one visual row at a time with `perRow` from here.
 */
export type GridWindow = {
  /** Cell width in cells, including the gap after it. */
  cellWidth: number
  /** Episode number column width (zero-padded). */
  numWidth: number
  /** Cells per row. */
  perRow: number
  /** Total rows the whole episode list needs. */
  totalRows: number
  /** First visible row. */
  startRow: number
  /** 1-based index of the first visible episode. */
  first: number
  /** 1-based index of the last visible episode (inclusive). */
  last: number
}

/**
 * Cells a single episode cell takes besides the number itself: a leading
 * indent, the mark, a space after it and a one-cell gap — ` ✓ 012 `. So a
 * 151-episode show needs 7 cells a cell (3 digits + 4) and fits 14 per row at
 * 100 columns, 11 at 80.
 */
const CELL_CHROME = 4

export function gridWindow(count: number, cursor: number, width: number, rows: number): GridWindow {
  const safeCount = Math.max(0, count)
  const numWidth = Math.max(2, String(safeCount).length)
  const cellWidth = numWidth + CELL_CHROME
  const perRow = Math.max(1, Math.floor(Math.max(1, width) / cellWidth))
  const totalRows = Math.ceil(safeCount / perRow)
  const visible = Math.max(1, Math.min(rows, totalRows || 1))
  const cursorRow = Math.floor(Math.max(0, Math.min(cursor, Math.max(0, safeCount - 1))) / perRow)
  const maxStart = Math.max(0, totalRows - visible)
  const startRow = totalRows <= visible ? 0 : Math.max(0, Math.min(cursorRow - Math.floor(visible / 2), maxStart))
  const first = Math.min(safeCount, startRow * perRow + 1)
  const last = Math.min(safeCount, (startRow + visible) * perRow)
  return { cellWidth, numWidth, perRow, totalRows, startRow, first, last }
}
