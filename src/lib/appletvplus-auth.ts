/** Build a transient Apple TV Cookie from a pasted media token and explicit region. */
export function appleTVImportCookie(value: string, country?: string): string {
  const text = value.trim()
  if (/^0\.[A-Za-z0-9+/_=-]{20,}$/.test(text)) {
    const region = (country || '').toLowerCase()
    if (!['hk', 'tw', 'jp', 'us', 'gb', 'au', 'ca'].includes(region)) throw new Error('请选择 Apple 账号地区后导入媒体令牌')
    return `itua=${region.toUpperCase()}; media-user-token=${text}`
  }
  if (/\r|\n/.test(text) && !text.includes('\t') && !text.startsWith('[') && !text.startsWith('{')) throw new Error('Cookie 中包含无效换行')
  return text
}
