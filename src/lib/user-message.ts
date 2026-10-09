import { errorCatalog } from './user-message-catalog'

export const defaultErrorMessage = '操作暂时未能完成，请稍后重试；若持续失败，请联系客服并说明操作时间。'
const rules = errorCatalog.map(row => ({ ...row, re: new RegExp(row.pattern, 'i') }))
const technical = /[\r\n{}<>]|https?:\/\/|wss?:\/\/|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[A-Z]:[\\/]|\/(?:home|tmp|var|usr|etc)\/|\b(?:JSON|DRM|MTOP|UPS|interfaceKey|paramKey|aesKeyHex|diagnostic|stack|panic|sql|sqlite|select|insert|traceback|goroutine|authorization|cookie|token|pck|ccsn|TypeError|SyntaxError|ECONN\w*|http\s*\d+|em\s*[=:]\s*\d+)\b|上游|源站|解密|签名|反序列化|票据|令牌|设备证书|[a-zA-Z0-9_+/=.-]{32,}/i

export function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const row = error as Record<string, unknown>
  return typeof row.errorCode === 'string' ? row.errorCode : typeof row.error_code === 'string' ? row.error_code : ''
}

/** Only use at display/IPC boundaries; internal retries keep original errors. */
export function userMessage(error: unknown, fallback = defaultErrorMessage): string {
  const code = errorCode(error)
  const coded = rules.find(row => row.code === code)
  if (coded) return coded.message
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
  const raw = (typeof error === 'string' ? error : error instanceof Error ? error.message : typeof row?.message === 'string' ? row.message : '').trim()
  if (raw && [...raw].length <= 180 && /\p{Script=Han}/u.test(raw) && !technical.test(raw)) return raw
  const text = raw.split('; diagnostic=')[0]!.slice(0, 8192)
  const matched = rules.find(row => row.code === text || row.re.test(text))
  if (matched) return matched.message
  if (error instanceof Error && error.name === 'AbortError') return '操作已取消，您可以重新发起。'
  return fallback
}

/** Opt-in human text fields in event/snapshot data; IDs and machine flags stay intact. */
export function userFacing<T>(value: T): T {
  if (Array.isArray(value)) return value.map(userFacing) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const [key, item] of Object.entries(out)) {
    if (['err', 'error', 'keyError', 'searchError', 'detailError', 'probeError', 'tmdbError'].includes(key) && typeof item === 'string') {
      out[key] = item ? userMessage(item) : ''
    } else if ((['message', 'msg', 'hint', 'reason'].includes(key) || key === 'summary' && 'authenticated' in out) && typeof item === 'string' && item) {
      const states: Record<string, string> = { pending: '等待确认', signed_out: '尚未登录', expired: '登录已过期，请重新登录。', denied: '本次操作未获允许，请在官方客户端检查账号状态。', ok: '操作成功', success: '操作成功' }
      const fallback = key === 'summary' && 'authenticated' in out
        ? out.authenticated ? '已登录，可继续选择内容。' : '尚未完成登录，请按账号设置中的提示操作。'
        : defaultErrorMessage
      out[key] = states[item.toLowerCase()] || userMessage(item, fallback)
    } else if (typeof item === 'object') out[key] = userFacing(item)
  }
  return out as T
}
