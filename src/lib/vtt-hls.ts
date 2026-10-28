/**
 * 字幕的 HLS 封装（`.vtt.m3u8`）拼接。
 *
 * 腾讯软字幕给的是 `…f53102000.vtt.m3u8` 这种 HLS playlist，单片是 WebVTT 文本。
 * 直接把 playlist 当字幕写盘会得到一个「内容是 m3u8 的 .vtt 文件」，播放器整轨读不出。
 * 这里只做纯文本处理（不碰网络），拿到的片段由调用方用同一条出口取回。
 *
 * 拼接规则与网关侧 `internal/provider/tencent/subtitle.go` 保持一致：
 *  - cue 时间小于分片起点（#EXTINF 累加）时按相对时间平移；
 *  - 已大于等于起点时按绝对时间原样保留；
 *  - `WEBVTT` 头只保留一个，NOTE/STYLE/REGION 丢弃，重复 cue 去重。
 */

export type HlsSubtitleSegment = { url: string; start: number }

export type VttPart = { start: number; body: string }

const TIMING =
  /^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[.,](\d{3})[ \t]+-->[ \t]+(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[.,](\d{3})(.*)$/

const toSeconds = (h: string, m: string, s: string, ms: string): number =>
  Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000

export const formatVttTime = (sec: number): string => {
  const total = Math.max(0, Math.round(sec * 1000))
  const ms = total % 1000
  const rest = Math.floor(total / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}.${pad(ms, 3)}`
}

export const isHlsPlaylist = (text: string): boolean =>
  text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')

/** 解析字幕 playlist：`#EXTINF` 累加出每个分片的起点，相对 URI 按 playlist 解析。 */
export function parseHlsSubtitlePlaylist(text: string, baseUrl: string): HlsSubtitleSegment[] {
  const base = new URL(baseUrl)
  const out: HlsSubtitleSegment[] = []
  let start = 0
  let pending = -1
  let firstVariant = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF:')) {
      const dur = Number.parseFloat(line.slice('#EXTINF:'.length).split(',')[0]?.trim() ?? '')
      if (Number.isFinite(dur) && dur > 0) pending = dur
      continue
    }
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pending = -2
      continue
    }
    if (line.startsWith('#')) continue
    let url: string
    try {
      url = new URL(line, base).toString()
    } catch {
      continue
    }
    if (pending === -2) {
      if (!firstVariant) firstVariant = url
      pending = -1
      continue
    }
    out.push({ url, start })
    if (pending > 0) start += pending
    pending = -1
  }
  if (!out.length && firstVariant) return [{ url: firstVariant, start: 0 }]
  return out
}

type Cue = { start: number; end: number; settings: string; text: string }

function parseCues(body: string): Cue[] {
  const out: Cue[] = []
  for (const block of body.replace(/\r\n/g, '\n').split('\n\n')) {
    const lines = block.replace(/^\n+|\n+$/g, '').split('\n')
    if (!lines.length) continue
    let idx = -1
    for (let i = 0; i < lines.length && i < 2; i++) {
      if (TIMING.test((lines[i] ?? '').trim())) {
        idx = i
        break
      }
    }
    if (idx < 0) continue
    const m = TIMING.exec((lines[idx] ?? '').trim())
    if (!m) continue
    const start = toSeconds(m[1]!, m[2]!, m[3]!, m[4]!)
    const end = toSeconds(m[5]!, m[6]!, m[7]!, m[8]!)
    if (end <= start) continue
    out.push({ start, end, settings: (m[9] ?? '').trim(), text: lines.slice(idx + 1).join('\n') })
  }
  return out
}

/** 把多个分片拼成单个 WebVTT 文本。 */
export function stitchVttParts(parts: readonly VttPart[]): string {
  const seen = new Set<string>()
  const cues: Cue[] = []
  for (const part of parts) {
    for (const cue of parseCues(part.body.replace(/^\uFEFF/, ''))) {
      const shifted = cue.start + 0.0005 < part.start
        ? { ...cue, start: cue.start + part.start, end: cue.end + part.start }
        : cue
      const key = `${shifted.start.toFixed(3)}|${shifted.end.toFixed(3)}|${shifted.text}`
      if (seen.has(key)) continue
      seen.add(key)
      cues.push(shifted)
    }
  }
  let out = 'WEBVTT\n\n'
  for (const cue of cues) {
    out += `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`
    if (cue.settings) out += ` ${cue.settings}`
    out += '\n'
    if (cue.text) out += `${cue.text}\n`
    out += '\n'
  }
  return out
}

/** WebVTT → SRT（时间戳逗号、加序号、去 settings）。 */
export function vttToSrt(body: string): string {
  const cues = parseCues(body.replace(/^\uFEFF/, ''))
  let out = ''
  cues.forEach((cue, i) => {
    out += `${i + 1}\n`
    out += `${formatVttTime(cue.start).replace('.', ',')} --> ${formatVttTime(cue.end).replace('.', ',')}\n`
    if (cue.text) out += `${cue.text}\n`
    out += '\n'
  })
  return out
}

export type SubtitleFetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * 拉一条 `.vtt.m3u8` 并拼成完整 WebVTT。
 * strict 模式要求每个分片可读取；调用方可换完整 CDN 镜像重试，避免缺失部分字幕仍被当作成功。
 */
export async function fetchHlsVtt(
  fetcher: SubtitleFetcher,
  playlistUrl: string,
  signal?: AbortSignal,
  options: { strict?: boolean } = {},
): Promise<string> {
  const get = async (url: string): Promise<string> => {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(60_000)
    const res = await fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  }
  const checkVtt = (body: string) => {
    if (options.strict && (!/^\s*WEBVTT\b/.test(body) || (body.includes('-->') && !parseCues(body).length))) {
      throw new Error('字幕分片不是有效 WebVTT')
    }
  }
  let first = await get(playlistUrl)
  // A subtitle master can point at a media playlist. Bound nesting and reject loops.
  const visited = new Set([playlistUrl])
  while (isHlsPlaylist(first) && /#EXT-X-STREAM-INF/.test(first) && !/#EXTINF:/.test(first)) {
    const next = parseHlsSubtitlePlaylist(first, playlistUrl)[0]?.url
    if (!next || visited.has(next) || visited.size >= 4) throw new Error('字幕 playlist 嵌套无效')
    visited.add(next)
    playlistUrl = next
    first = await get(next)
  }
  if (!isHlsPlaylist(first)) {
    checkVtt(first)
    if (options.strict && !parseCues(first).length) throw new Error('字幕里没有 cue')
    return first
  }
  const segs = parseHlsSubtitlePlaylist(first, playlistUrl)
  if (!segs.length) throw new Error('字幕 playlist 没有分片')
  const parts: VttPart[] = []
  for (const seg of segs) {
    try {
      const body = await get(seg.url)
      checkVtt(body)
      if (!parseCues(body).length) continue // Valid empty VTT is allowed during a dialogue-free segment.
      parts.push({ start: seg.start, body })
    } catch (e) {
      signal?.throwIfAborted()
      if (options.strict) throw e
      continue
    }
  }
  if (!parts.length) throw new Error('字幕分片里没有 cue')
  signal?.throwIfAborted()
  return stitchVttParts(parts)
}
