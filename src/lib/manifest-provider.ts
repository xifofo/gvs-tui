import type { Quality } from '../types.ts'
import type { FileConfig } from './config.ts'
import type { GwClient } from './client.ts'
import { isObj } from './util.ts'

export type ManifestSource = { url: string; headers: Record<string, string>; format: string; height: number; quality: string; clear: boolean; drm: string; live: boolean }
const str = (v: unknown): string => typeof v === 'string' ? v : ''
export function manifestSources(data: Record<string, unknown>): ManifestSource[] {
  const raw = isObj(data.raw) ? data.raw : {}
  const rows = Array.isArray(data.media) ? data.media : Array.isArray(raw.media) ? raw.media : []
  return rows.filter(isObj).filter(m => !m.type || m.type === 'video').map(m => {
    const meta = isObj(m.meta) ? m.meta : {}
    const drm = isObj(m.drm) ? m.drm : isObj(meta.drm) ? meta.drm : isObj(data.drm) ? data.drm : isObj(raw.drm) ? raw.drm : {}
    const h = isObj(m.headers) ? m.headers : isObj(meta.headers) ? meta.headers : isObj(data.headers) ? data.headers : {}
    const headers = Object.fromEntries(Object.entries(h).filter(([k,v]) => typeof v === 'string' && ![k,v].some(s => s.includes(String.fromCharCode(13)) || s.includes(String.fromCharCode(10))))) as Record<string,string>
    const url = str(m.url); let safe = false
    try { const u = new URL(url); safe = ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password } catch {}
    return { url: safe ? url : '', headers, format: str(m.format || meta.format), quality: str(m.quality || meta.quality), height: Number(m.height || meta.height) || 0, clear: drm.clear === true, drm: str(drm.system) || (drm.clear === true ? 'none' : 'unknown'), live: m.isLive === true || data.isLive === true || raw.isLive === true }
  }).filter(m => !!m.url)
}
export function manifestInput(provider: string, cfg: Pick<FileConfig, 'hamiClient'>, id: string, quality = 'auto'): Record<string, unknown> {
  return { id, ...(provider === 'hamivideo' ? { client: cfg.hamiClient || 'tv', quality } : {}) }
}
export async function resolveManifest(cli: Pick<GwClient, 'invoke'>, cfg: Pick<FileConfig, 'hamiClient'>, provider: string, id: string, quality = 'auto'): Promise<ManifestSource[]> {
  const data = await cli.invoke(provider, 'resolve', manifestInput(provider, cfg, id, quality))
  const sources = manifestSources(data)
  if (!sources.length) throw new Error('网关没有返回可用媒体清单')
  return sources
}
export async function probeManifest(cli: GwClient, cfg: FileConfig, provider: string, id: string): Promise<{ qualities: Quality[]; audios: [] }> {
  const sources = await resolveManifest(cli, cfg, provider, id)
  return { qualities: sources.map((s, i) => ({ id: provider === 'hamivideo' && cfg.hamiClient !== 'web' && [480,720,1080,2160].includes(s.height) ? String(s.height) : 'auto', label: s.quality || (s.height ? `${s.height}p` : '自动'), title: s.clear ? '源站明确标记明文 · 本机直连下载' : '受保护媒体 · 当前客户端尚未接入该 DRM 授权处理', size: 0, width: 0, height: s.height, codec: '', drm: s.clear ? 'none' : s.drm, stream: provider === 'hamivideo' && cfg.hamiClient !== 'web' && [480,720,1080,2160].includes(s.height) ? String(s.height) : 'auto', tier: i })), audios: [] }
}
export function requireClearDownload(source: ManifestSource): void {
  if (source.live) throw new Error('直播录制尚未接入；不会启动无限下载')
  if (!source.clear) throw new Error('DRM_CLIENT_UNAVAILABLE：网关当前返回许可证而非可直接使用的内容密钥；尚未接入此授权媒体处理，不会按明文下载，也不会请求设备私钥')
}
export function providerLink(text: string): { provider: 'mewatch' | 'hamivideo'; url: string } | undefined {
  const found = text.match(new RegExp('https://[^ <>]+', 'g')) || []
  for (const value of found) { try { const u = new URL(value.trim()); if (u.username || u.password) continue; if (u.hostname === 'hamivideo.hinet.net') return { provider: 'hamivideo', url: u.href }; if (u.hostname === 'mewatch.sg' || u.hostname === 'www.mewatch.sg') return { provider: 'mewatch', url: u.href } } catch {} }
  return undefined
}
