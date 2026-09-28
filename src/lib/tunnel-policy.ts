/** Match gateway egress admission; business permissions remain per provider. */
export const TUNNEL_PROVIDERS = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'mewatch'] as const

export function needsTunnel(allows: (provider: string) => boolean): boolean {
  return TUNNEL_PROVIDERS.some(allows)
}
