/** 独立 HTTP 校验：不向网关发送发布密钥，不跟随重定向，不回显服务端原文。 */
import type { PlutoFishInput, PublisherIdentity } from './types.ts'

export function normalizePlutoFishURL(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('请填写有效的 PlutoFish 服务地址') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('PlutoFish 地址须使用 HTTPS，本机开发可使用 HTTP')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('PlutoFish 地址不能包含账号、密码、查询参数或锚点')
  return url.toString().replace(/\/+$/, '')
}

function identity(value: unknown): PublisherIdentity {
  if (!value || typeof value !== 'object') throw new Error('PlutoFish 身份响应格式不正确，请确认服务地址和版本')
  const v = value as Record<string, unknown>
  const valid = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 256
  if (!valid(v.id) || !valid(v.name) || !['publisher', 'legacy'].includes(String(v.kind))) {
    throw new Error('PlutoFish 身份响应格式不正确，请确认服务地址和版本')
  }
  const categories = v.categories
  if (categories !== undefined && (!Array.isArray(categories) || categories.some(c => !c || !valid(c.value) || !valid(c.label)))) {
    throw new Error('PlutoFish 分类响应格式不正确，请确认服务版本')
  }
  const options = categories === undefined ? {} : { categories: (categories as Array<{value: string; label: string}>).map(c => ({ value: c.value, label: c.label })) }
  if (v.kind === 'legacy' && v.sourceAccount === null) return { id: v.id, name: v.name, kind: 'legacy', sourceAccount: null, ...options }
  const a = v.sourceAccount as Record<string, unknown> | null
  if (v.kind !== 'publisher' || !a || !valid(a.id) || !valid(a.name) || !valid(a.alias)) {
    throw new Error('PlutoFish 未返回有效的绑定源账号')
  }
  return { id: v.id, name: v.name, kind: 'publisher', sourceAccount: { id: a.id, name: a.name, alias: a.alias }, ...options }
}

export type PublisherFetch = (url: string, init: RequestInit) => Promise<Response>

export async function verifyPublisher(input: PlutoFishInput, signal?: AbortSignal, request: PublisherFetch = fetch): Promise<PublisherIdentity> {
  const url = normalizePlutoFishURL(input.url)
  if (!input.key.trim() || /[\r\n]/.test(input.key)) throw new Error('请填写 PlutoFish 发布端密钥')
  let response: Response
  try {
    response = await request(`${url}/api/v1/publisher/me`, {
      method: 'GET', headers: { Authorization: `Bearer ${input.key.trim()}`, Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
    })
  } catch { throw new Error('无法连接 PlutoFish，请检查地址、网络或证书后重试') }
  if (response.status === 401) throw new Error('PlutoFish 密钥无效或发布端已停用，请重新填写')
  if (response.status === 403) throw new Error('PlutoFish 发布端绑定的源账号不可用，请联系管理员')
  if (!response.ok) throw new Error(`PlutoFish 验证失败（HTTP ${response.status}），请稍后重试`)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('PlutoFish 未返回身份 JSON，请检查服务地址')
  let body: unknown
  try { body = await response.json() } catch { throw new Error('PlutoFish 身份响应格式不正确') }
  return identity(body)
}
