/** Shared, transport-free provider metadata for terminal and desktop clients. */
export const PROVIDER_IDS = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'mewatch', 'hamivideo', 'friday', 'linetv', 'iq', 'iqcn', 'mgtv', 'bilibili', 'migu', 'appletvplus'] as const
export type ProviderID = (typeof PROVIDER_IDS)[number]
export const PROVIDER_LABELS: Record<string, string> = {
  youku: '优酷', tencent: '腾讯', hongguo: '红果', huangguo: '黄果', douyin: '抖音',
  mewatch: 'mewatch', hamivideo: 'HamiVideo', friday: 'friDay影音', linetv: 'LINE TV',
  iq: 'IQ 海外版',
  iqcn: '爱奇艺国内版',
  mgtv: '芒果 TV', bilibili: '哔哩哔哩', migu: '咪咕视频',
  appletvplus: 'Apple TV',
}
export const supportsSearch = (provider: string): boolean => provider !== 'hamivideo' && provider !== 'appletvplus'
export const supportsBrowse = (provider: string): boolean => provider !== 'hamivideo'
export const isManifestProvider = (provider: string): boolean => provider === 'mewatch' || provider === 'hamivideo' || provider === 'friday' || provider === 'linetv' || provider === 'appletvplus'
/** Providers with the shared movie/series type and optional TMDB naming workflow. */
export const supportsTmdb = (provider: string | undefined): boolean => ['youku','tencent','iq','iqcn','mgtv','bilibili','migu'].includes(provider || '')
