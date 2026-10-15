import type { Audio, Quality } from '../types.ts'
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
  if (provider === 'dsnp') {
    if (id.startsWith('entity-')) return { id }
    const m = id.match(/^(.+)\|(imax|widescreen)$/)
    return m ? { mediaId: m[1], version: m[2] } : { mediaId: id }
  }
  return { ...(provider === 'appletvplus' && id.startsWith('https://') ? {url:id} : {id}), ...(provider === 'hamivideo' ? { client: cfg.hamiClient || 'tv', quality } : provider === 'friday' || provider === 'appletvplus' ? { quality } : {}) }
}
export async function resolveManifest(cli: Pick<GwClient, 'invoke'>, cfg: Pick<FileConfig, 'hamiClient'>, provider: string, id: string, quality = 'auto'): Promise<ManifestSource[]> {
  const data = await cli.invoke(provider, 'resolve', manifestInput(provider, cfg, id, quality))
  const sources = manifestSources(data)
  if (!sources.length) throw new Error('网关没有返回可用媒体清单')
  return sources
}
export async function probeManifest(cli: GwClient, cfg: FileConfig, provider: string, id: string): Promise<{ qualities: Quality[]; audios: Audio[] }> {
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

type HlsAttrs = Record<string, string>
function hlsAttrs(line: string): HlsAttrs {
  const out: HlsAttrs = {}
  for (const m of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]!] = m[2]!.replace(/^"|"$/g, '')
  return out
}
const uriKey = (uri: string): string => uri.split('?')[0]!.split('/').pop() || ''
type DsnpVideoKind = 'dv' | 'hdr' | 'sdr'
const KIND_LABEL: Record<DsnpVideoKind, string> = { dv: 'DV', hdr: 'HDR10', sdr: 'SDR' }
/** RE --select-video codecs filter per kind (the master tags DV as dvh1, HDR10 as hvc1, SDR as avc1). */
export const DSNP_VIDEO_CODECS: Record<DsnpVideoKind, string> = { dv: 'dvh1|dvhe', hdr: 'hvc1|hev1', sdr: 'avc1' }
/** Active picture inside the 16:9 container (Disney+ letterboxes 2.39 and IMAX 1.90 into 3840x2160). */
export function activePicture(width: number, height: number, ratio: number): { width: number; height: number } | undefined {
  if (!(ratio > 0) || !width || !height || Math.abs(width / height - ratio) < 0.02) return undefined
  return ratio > width / height ? { width, height: Math.round(width / ratio / 2) * 2 } : { width: Math.round(height * ratio / 2) * 2, height }
}

/** Disney+ HLS master → one quality per height × dynamic range (DV / HDR10 / SDR). Size = video bitrate × duration (estimate). */
export function hlsMasterQualities(text: string, opts: { durationSec?: number; aspectRatio?: number; audioBitrate?: number } = {}): Quality[] {
  const lines = text.split(/\r?\n/)
  // Per video playlist: the lowest AVERAGE-BANDWIDTH across its variants is video + the smallest audio group.
  const rows = new Map<string, { width: number; height: number; kind: DsnpVideoKind; codec: string; fps: number; avg: number; minAudio: number }>()
  const audioKbps = new Map<string, number>()
  for (const line of lines) if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line)) {
    const a = hlsAttrs(line); const k = Number(/_(\d+)k_/.exec(a.URI || '')?.[1]) || 0
    if (a['GROUP-ID'] && k) audioKbps.set(a['GROUP-ID'], Math.min(audioKbps.get(a['GROUP-ID']) ?? Infinity, k))
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue
    const a = hlsAttrs(line)
    const res = /^(\d+)x(\d+)$/.exec(a.RESOLUTION || '')
    const tag = (a.CODECS || '').split(',').map(c => c.trim()).find(c => /^(hvc1|hev1|dvh1|dvhe|avc1)/.test(c))
    if (!res || !tag) continue
    const width = Number(res[1]), height = Number(res[2])
    const kind: DsnpVideoKind = /^(dvh1|dvhe)/.test(tag) ? 'dv' : a['VIDEO-RANGE'] === 'PQ' || a['VIDEO-RANGE'] === 'HLG' ? 'hdr' : 'sdr'
    const avg = Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || 0
    const audio = (audioKbps.get(a.AUDIO || '') ?? 0) * 1000
    const video = Math.max(0, avg - audio)
    const key = `${height}:${kind}:${uriKey(lines[i + 1] || '')}`
    const prev = rows.get(key)
    if (!prev || video < prev.avg) rows.set(key, { width, height, kind, codec: tag.split('.')[0]!, fps: Number(a['FRAME-RATE']) || 0, avg: video, minAudio: audio })
  }
  // Best (highest bitrate) playlist per height × kind; that is what RE's for=best picks inside the filter.
  const best = new Map<string, { width: number; height: number; kind: DsnpVideoKind; codec: string; fps: number; avg: number }>()
  for (const r of rows.values()) {
    const k = `${r.height}:${r.kind}`
    if (!best.has(k) || r.avg > best.get(k)!.avg) best.set(k, r)
  }
  const order: DsnpVideoKind[] = ['dv', 'hdr', 'sdr']
  return [...best.values()].sort((a, b) => b.height - a.height || order.indexOf(a.kind) - order.indexOf(b.kind)).map(r => {
    const tier = r.height >= 2160 ? '4K' : `${r.height}p`
    const pic = activePicture(r.width, r.height, opts.aspectRatio || 0)
    const imax = (opts.aspectRatio || 0) > 1.85 && (opts.aspectRatio || 0) < 1.95
    const ratio = opts.aspectRatio ? `${opts.aspectRatio.toFixed(2)}:1${imax ? ' IMAX' : ''}` : ''
    const size = opts.durationSec ? Math.round((r.avg + (opts.audioBitrate || 0)) * opts.durationSec / 8) : 0
    const codecName = r.kind === 'dv' ? 'Dolby Vision (HEVC)' : r.codec === 'avc1' ? 'H.264' : 'HEVC'
    return { id: `${r.height}:${r.kind}`, label: `${tier} ${KIND_LABEL[r.kind]}${imax ? ' · IMAX' : ''}`,
      title: `网关授权取内容密钥 · 本机下载解密 · ${codecName} · 平均 ${(r.avg / 1e6).toFixed(1)} Mbps${pic ? ` · 实际画面 ${pic.width}×${pic.height}（${ratio}，片源上下黑边）` : ratio ? ` · ${ratio}` : ''}${size ? ' · 体积按平均码率估算' : ''}`,
      size, width: r.width, height: r.height, codec: r.codec, drm: 'widevine', stream: `${r.height}:${r.kind}`, hdr: r.kind === 'dv' ? 'DV' : r.kind === 'hdr' ? 'HDR' : '', fps: r.fps || undefined, tier: tierHeight(r.width, r.height) }
  })
}

const LANG_NAME: Record<string, string> = { cmn: '国语', yue: '粤语', zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', it: '意大利语', pt: '葡萄牙语', th: '泰语' }
/** Disney+ master EXT-X-MEDIA audio → selectable tracks (id = the rendition playlist file, unique across groups). */
export function hlsMasterAudios(text: string): Audio[] {
  const seen = new Map<string, Audio & { kbps: number; primary: boolean }>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/.test(line)) continue
    const a = hlsAttrs(line)
    const id = uriKey(a.URI || '')
    if (!id || seen.has(id)) continue
    const lang = a.LANGUAGE || ''
    const atmos = /JOC/i.test(a.CHANNELS || '')
    const ch = atmos ? 6 : Number.parseInt(a.CHANNELS || '', 10) || 2
    const kbps = Number(/_(\d+)k_/.exec(id)?.[1]) || 0
    const codec = /dtsx/i.test(id) ? 'DTS:X' : /ec-3/i.test(id) ? 'E-AC-3' : /mp4a/i.test(id) ? 'AAC' : (a['GROUP-ID'] || '')
    const chText = codec === 'DTS:X' ? '' : ch >= 8 ? '7.1' : ch >= 6 ? '5.1' : ch === 1 ? '1.0' : '2.0'
    const ad = /NARRATION|describes-video/i.test(`${id} ${a.CHARACTERISTICS || ''}`)
    const base = lang.split('-')[0]!
    const label = `${LANG_NAME[lang] || LANG_NAME[base] || a.NAME || lang}${ad ? '（口述影像）' : ''} · ${codec}${chText ? ` ${chText}` : ''}${atmos ? ' Atmos' : ''}${kbps ? ` · ${kbps}k` : ''}`
    seen.set(id, { id, label, lang, codec, isDefault: false, selected: false, kbps, primary: !ad })
  }
  const rows = [...seen.values()]
  const score = (r: { codec: string; label: string; kbps: number }) => (/Atmos/.test(r.label) ? 4e6 : r.codec === 'E-AC-3' ? 3e6 : r.codec === 'AAC' ? 2e6 : 1e6) + r.kbps
  // Original language: the language of the richest primary track (Atmos/DTS:X are only mastered for the original mix).
  const top = rows.filter(r => r.primary).sort((a, b) => score(b) - score(a))[0]
  const want = new Set([top?.lang, 'cmn', 'yue', 'zh', 'zh-Hans', 'zh-Hant', 'zh-HK', 'zh-TW'].filter(Boolean) as string[])
  for (const lang of want) {
    const pick = rows.filter(r => r.primary && r.lang === lang && r.codec !== 'DTS:X').sort((a, b) => score(b) - score(a))[0]
    if (pick) pick.selected = true
  }
  const chinese = rows.find(r => r.selected && /^(cmn|yue|zh)/.test(r.lang))
  const def = chinese ?? rows.find(r => r.selected)
  if (def) def.isDefault = true
  return rows.sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.primary) - Number(a.primary) || a.lang.localeCompare(b.lang) || score(b) - score(a))
    .map(({ kbps: _k, primary: _p, ...r }) => r)
}

async function hlsDurationSec(master: string, base: string, headers: Record<string, string>): Promise<number> {
  // The smallest video playlist lists the same timeline as every rendition.
  const lines = master.split(/\r?\n/)
  const i = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF:'))
  if (i < 0 || !lines[i + 1]) return 0
  const res = await fetch(new URL(lines[i + 1]!, base), { headers, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return 0
  let total = 0
  for (const m of (await res.text()).matchAll(/^#EXTINF:([\d.]+)/gm)) total += Number(m[1])
  return total
}

async function probeDsnp(cli: GwClient, cfg: FileConfig, id: string): Promise<{ qualities: Quality[]; audios: Audio[] }> {
  // One billed resolve per title (and version) per 6h; the download in the same window is not charged again.
  // The version travels in the id (mediaId|imax), so each version is probed from its own playlist.
  const data = await cli.invoke('dsnp', 'resolve', manifestInput('dsnp', cfg, id))
  const sources = manifestSources(data)
  if (!sources.length) throw new Error('网关没有返回可用媒体清单')
  const source = sources[0]!
  const raw = isObj(data.raw) ? data.raw : {}
  const aspectRatio = Number(data.imageAspectRatio ?? raw.imageAspectRatio) || 0
  let qualities: Quality[] = [], audios: Audio[] = []
  try {
    const res = await fetch(source.url, { headers: source.headers, signal: AbortSignal.timeout(20_000) })
    if (res.ok) {
      const text = await res.text()
      audios = hlsMasterAudios(text)
      let durationSec = 0
      try { durationSec = await hlsDurationSec(text, source.url, source.headers) } catch {}
      const audioBitrate = audios.filter(a => a.selected).reduce((n, a) => n + (Number(/· (\d+)k$/.exec(a.label)?.[1]) || 0) * 1000, 0)
      qualities = hlsMasterQualities(text, { durationSec, aspectRatio, audioBitrate })
    }
  } catch {}
  if (!qualities.length) qualities = [{ id: 'auto', label: '最高画质', title: '网关授权取内容密钥 · 本机下载解密', size: 0, width: 0, height: 0, codec: '', drm: 'widevine', stream: 'auto', tier: tierHeight(0, 0) }]
  return { qualities, audios }
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
