import type { Quality } from '../types.ts'
import type { FileConfig } from './config.ts'
import type { GwClient } from './client.ts'
import { isObj } from './util.ts'
import { tierHeight } from './name.ts'

export type ManifestSource = { url: string; headers: Record<string, string>; format: string; height: number; quality: string; clear: boolean; drm: string; live: boolean; contentKeys: string[]; manifest?: string }
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
    const contentKeys = parseContentKeys(drm.contentKeys)
    const manifest = str(data.manifest || raw.manifest) || undefined
    return { url: safe ? url : '', headers, format: str(m.format || meta.format), quality: str(m.quality || meta.quality), height: Number(m.height || meta.height) || 0, clear: drm.clear === true, drm: str(drm.system) || (drm.clear === true ? 'none' : 'unknown'), live: m.isLive === true || data.isLive === true || raw.isLive === true, contentKeys, manifest }
  }).filter(m => !!m.url)
}
export function manifestInput(provider: string, cfg: Pick<FileConfig, 'hamiClient'>, id: string, quality = 'auto'): Record<string, unknown> {
  // Disney+: a title page is entity-…; an episode/movie plays by its mediaId (resourceId). The default tier is L1 (ctr-high); no level is sent, so no downgrade.
  if (provider === 'dsnp') return id.startsWith('entity-') ? { id } : { mediaId: id }
  return { ...(provider === 'appletvplus' && id.startsWith('https://') ? {url:id} : {id}), ...(provider === 'hamivideo' ? { client: cfg.hamiClient || 'tv', quality } : provider === 'friday' || provider === 'appletvplus' ? { quality } : {}) }
}
export async function resolveManifest(cli: Pick<GwClient, 'invoke'>, cfg: Pick<FileConfig, 'hamiClient'>, provider: string, id: string, quality = 'auto'): Promise<ManifestSource[]> {
  const data = await cli.invoke(provider, 'resolve', manifestInput(provider, cfg, id, quality))
  const sources = manifestSources(data)
  if (!sources.length) throw new Error('网关没有返回可用媒体清单')
  return sources
}
export async function probeManifest(cli: GwClient, cfg: FileConfig, provider: string, id: string): Promise<{ qualities: Quality[]; audios: [] }> {
  if (provider === 'appletvplus') {
    const data = await cli.invoke(provider, 'probe', manifestInput(provider, cfg, id))
    const rows = Array.isArray(data.qualities) ? data.qualities.filter(isObj) : []
    const qualities: Quality[] = rows.filter(q => str(q.id) && Number(q.height) > 0).map(q => ({ id: str(q.id), label: str(q.label), title: str(q.label), size: 0, width: Number(q.width) || 0, height: Number(q.height), codec: str(q.codec), drm: 'playready', stream: str(q.id), hdr: str(q.hdr), fps: Number(q.fps) || undefined, tier: tierHeight(Number(q.width) || 0, Number(q.height)) }))
    if (!qualities.length) throw new Error('Apple TV 没有返回可用画质')
    return { qualities, audios: [] }
  }
  if (provider === 'dsnp') return probeDsnp(cli, cfg, id)
  const sources = await resolveManifest(cli, cfg, provider, id)
  return { qualities: sources.map(s => {
    const selectable = provider === 'friday' ? [1080,2160].includes(s.height) : provider === 'hamivideo' && cfg.hamiClient !== 'web' && [480,720,1080,2160].includes(s.height)
    return { id: selectable ? String(s.height) : 'auto', label: s.quality || (s.height ? `${s.height}p` : '自动'), title: s.clear ? '源站明确标记明文 · 本机直连下载' : ['hamivideo', 'friday', 'dsnp'].includes(provider) ? '网关授权取内容密钥 · 本机下载解密' : '受保护媒体 · 当前客户端尚未接入该 DRM 授权处理', size: 0, width: 0, height: s.height, codec: '', drm: s.clear ? 'none' : s.drm, stream: selectable ? String(s.height) : 'auto', tier: tierHeight(0, s.height) }
  }), audios: [] }
}

/** Disney+ HLS master variants → one selectable quality per height (best range/codec wins inside N_m3u8DL-RE's res filter). */
export function hlsMasterQualities(text: string): Quality[] {
  const byHeight = new Map<number, { width: number; height: number; codecs: Set<string>; ranges: Set<string>; fps: number }>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const res = line.match(/RESOLUTION=(\d+)x(\d+)/)
    if (!res) continue
    const width = Number(res[1]), height = Number(res[2])
    const row = byHeight.get(height) ?? { width, height, codecs: new Set<string>(), ranges: new Set<string>(), fps: 0 }
    const codec = (line.match(/CODECS="([^"]+)"/)?.[1] ?? '').split(',').map(c => c.trim()).find(c => /^(hvc1|hev1|dvh1|dvhe|avc1)/.test(c))
    if (codec) row.codecs.add(/^(dvh1|dvhe)/.test(codec) ? 'Dolby Vision' : /^(hvc1|hev1)/.test(codec) ? 'HEVC' : 'H.264')
    const range = line.match(/VIDEO-RANGE=([A-Z]+)/)?.[1]
    if (range) row.ranges.add(range === 'PQ' ? 'HDR' : range)
    row.fps = Math.max(row.fps, Number(line.match(/FRAME-RATE=([\d.]+)/)?.[1]) || 0)
    row.width = Math.max(row.width, width)
    byHeight.set(height, row)
  }
  return [...byHeight.values()].sort((a, b) => b.height - a.height).map(r => {
    const label = `${r.height >= 2160 ? '4K' : r.height + 'p'}${r.ranges.has('HDR') ? ' HDR' : ''}`
    return { id: String(r.height), label, title: `网关授权取内容密钥 · 本机下载解密 · ${[...r.codecs].join(' / ') || '未知编码'}`, size: 0, width: r.width, height: r.height, codec: [...r.codecs].join('/'), drm: 'widevine', stream: String(r.height), hdr: r.ranges.has('HDR') ? 'HDR' : '', fps: r.fps || undefined, tier: tierHeight(r.width, r.height) }
  })
}
async function probeDsnp(cli: GwClient, cfg: FileConfig, id: string): Promise<{ qualities: Quality[]; audios: [] }> {
  // One billed resolve (the gateway bills one charge per title per 6h, so the download that follows in the same window is not charged again).
  const source = (await resolveManifest(cli, cfg, 'dsnp', id))[0]!
  let qualities: Quality[] = []
  try {
    const res = await fetch(source.url, { headers: source.headers, signal: AbortSignal.timeout(20_000) })
    if (res.ok) qualities = hlsMasterQualities(await res.text())
  } catch {}
  if (!qualities.length) qualities = [{ id: 'auto', label: '最高画质', title: '网关授权取内容密钥 · 本机下载解密', size: 0, width: 0, height: 0, codec: '', drm: 'widevine', stream: 'auto', tier: tierHeight(0, 0) }]
  return { qualities, audios: [] }
}

export function parseContentKeys(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 128) throw new Error('网关返回的内容密钥集合无效')
  const keys = new Map<string, string>()
  for (const row of value) {
    if (!isObj(row) || !/^[a-f\d]{32}$/i.test(str(row.kid)) || !/^[a-f\d]{32}$/i.test(str(row.key))) throw new Error('网关返回的内容密钥格式无效')
    const kid = str(row.kid).toLowerCase(), key = str(row.key).toLowerCase()
    if (keys.has(kid) && keys.get(kid) !== key) throw new Error('网关返回了互相冲突的内容密钥')
    keys.set(kid, key)
  }
  return [...keys].map(([kid, key]) => `${kid}:${key}`)
}

export async function resolveManifestDownload(cli: Pick<GwClient, 'invoke'>, cfg: Pick<FileConfig, 'hamiClient'>, provider: string, id: string, quality = 'auto'): Promise<ManifestSource[]> {
  const input = manifestInput(provider, cfg, id, quality)
  if (provider === 'hamivideo' || provider === 'friday' || provider === 'appletvplus' || provider === 'dsnp') input.download = true
  const sources = manifestSources(await cli.invoke(provider, 'resolve', input, undefined, { timeoutMs: 120_000 }))
  if (!sources.length) throw new Error('网关没有返回可用媒体清单')
  for (const source of sources) {
    if (source.live) throw new Error('直播录制尚未接入；不会启动无限下载')
    if (source.clear) continue
    const supported = provider === 'appletvplus' ? ['playready', 'widevine'].includes(source.drm) && source.format.toLowerCase() === 'hls' : provider === 'dsnp' ? source.drm === 'widevine' && source.format.toLowerCase() === 'hls' : ['hamivideo', 'friday'].includes(provider) && source.drm === 'widevine' && source.format.toLowerCase() === 'dash'
    if (!supported || !source.contentKeys.length) {
      requireClearDownload(source)
    }
  }
  return sources
}
export function requireClearDownload(source: ManifestSource): void {
  if (source.live) throw new Error('直播录制尚未接入；不会启动无限下载')
  if (!source.clear) throw new Error('DRM_CLIENT_UNAVAILABLE：网关当前返回许可证而非可直接使用的内容密钥；尚未接入此授权媒体处理，不会按明文下载，也不会请求设备私钥')
}
export function providerLink(text: string): { provider: 'mewatch' | 'hamivideo' | 'friday' | 'linetv' | 'appletvplus' | 'dsnp'; url: string } | undefined {
  const dsnp = text.match(/https:\/\/(?:www\.|apps\.)?disneyplus\.com\/[^ <>]*?(entity-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (dsnp) return { provider: 'dsnp', url: dsnp[1]!.toLowerCase() }
  if (/^umc\.cmc\.[a-z0-9]+$/.test(text.trim())) return {provider:'appletvplus',url:text.trim()}
  const found = text.match(new RegExp('https://[^ <>]+', 'g')) || []
  for (const value of found) { try { const u = new URL(value.trim()); if (u.username || u.password) continue; if (u.hostname === 'tv.apple.com' && !u.port && /\/(show|movie|episode)\//.test(u.pathname)) return {provider:'appletvplus',url:u.href}; if (u.hostname === 'hamivideo.hinet.net') return { provider: 'hamivideo', url: u.href }; if (u.hostname === 'mewatch.sg' || u.hostname === 'www.mewatch.sg') return { provider: 'mewatch', url: u.href }; if (u.hostname === 'video.friday.tw') return { provider: 'friday', url: u.href }; if (u.hostname === 'linetv.tw' || u.hostname === 'www.linetv.tw') return { provider: 'linetv', url: u.href } } catch {} }
  return undefined
}
