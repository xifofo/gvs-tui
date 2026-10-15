/** 入口只接受网关返回的真实 Key 身份，空的成功响应不能放行。 */
import type { GwClient, KeyInfo } from '../../lib/client.ts'

export async function verifiedGatewayKey(client: Pick<GwClient, 'keyInfo'>): Promise<KeyInfo> {
  const info = await client.keyInfo()
  if (!info || typeof info.id !== 'string' || !info.id || typeof info.name !== 'string' || !info.name ||
      typeof info.all !== 'boolean' || !Array.isArray(info.scope) || info.scope.some(p => typeof p !== 'string')) {
    throw new Error('网关未返回有效的 Key 身份，请检查地址和版本')
  }
  return info
}
