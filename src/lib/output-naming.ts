export type OutputNaming = { title?: string; year?: number; season?: number }

/** Shared by task creation and remembered work preferences; renderer input is untrusted. */
export function outputNaming(value: OutputNaming | undefined): OutputNaming {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('命名设置无效')
  const result: OutputNaming = {}
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || value.title.length > 160 || /[\x00-\x1f\x7f]/.test(value.title)) throw new Error('文件名标题无效')
    const title = value.title.trim()
    if (title && !/[\p{L}\p{N}]/u.test(title)) throw new Error('文件名标题需包含文字或数字')
    if (title) result.title = title
  }
  if (value.year !== undefined) {
    if (!Number.isInteger(value.year) || value.year < 1000 || value.year > 9999) throw new Error('年份需为四位数字')
    result.year = value.year
  }
  if (value.season !== undefined) {
    if (!Number.isInteger(value.season) || value.season < 0 || value.season > 999) throw new Error('季号需为 0–999 的整数')
    result.season = value.season
  }
  return result
}
