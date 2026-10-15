import type { Quality } from '../types.ts'
import type { MediaSpecs } from './actual-version.ts'
import { defaultAudioIndex } from './audio-selection.ts'
import { completedFilename, type Naming } from './name.ts'

type PreviewAudio = { id: string; codec?: string; label?: string; isDefault?: boolean }

export const NAMING_PREVIEW_NOTE = '预览按所选画质和默认音轨生成，封装后按实际规格校正。'

function videoCodec(raw: string): string | undefined {
  const codec = raw.trim().toLowerCase().replace(/^h\.(264|265)$/, 'h$1').split('.')[0]!
  if (['h265', 'hevc', 'hvc1', 'hev1', 'dvhe', 'dvh1'].includes(codec)) return 'hevc'
  if (['h264', 'avc', 'avc1', 'avc3'].includes(codec)) return 'h264'
  if (['av1', 'av01'].includes(codec)) return 'av1'
  if (['vp9', 'vp09'].includes(codec)) return 'vp9'
  return undefined
}

function dynamicRange(q: Quality): string | undefined {
  // Explicit range wins over a generic tier/stream name (including SDR).
  const text = (q.hdr || [q.label, q.title, q.stream || q.id, q.codec].join(' ')).toLowerCase()
  if (/\bsdr\b/.test(text)) return 'SDR'
  if (/dolby\s*vision|dolbyvision|dvhe|dvh1|dovi|(?:^|[\s_|])dv(?:[\s_|]|$)|杜比视界/.test(text)) return 'DV'
  if (/hlg/.test(text)) return 'HLG'
  if (/hdr|vivid|菁彩/.test(text)) return 'HDR'
  return undefined
}

function audioSpecs(track: PreviewAudio | undefined): MediaSpecs['audio'] {
  if (!track) return undefined
  const streamIds = track.id.split('|').filter(id => /^cmfa[134]/i.test(id))
  const text = [track.codec, track.label, ...streamIds].filter(Boolean).join(' ').toLowerCase()
  const codec = /truehd|\bmlp\b/.test(text) ? 'truehd'
    : /e-?ac-?3|ec-?3|ddp|dd\+|cmfa4/.test(text) ? 'eac3'
    : /\bac-?3\b/.test(text) ? 'ac3'
    : /dts|\bdca\b|cmfa3/.test(text) ? 'dts'
    : /aac|mp4a|cmfa1/.test(text) ? 'aac'
    : /flac/.test(text) ? 'flac' : undefined
  const layout = /(?:^|[^\d.])([1257])\.([01])(?=$|[^\d.])/.exec(text)
  const youkuLayout = /(?:^|[_|])(?:atmos|dtsc|dtsx)?(10|20|51|71)(?=$|[_|\s])/.exec(text)
  const channels = ({ '1.0': 1, '2.0': 2, '5.1': 6, '7.1': 8 } as Record<string, number>)[layout ? `${layout[1]}.${layout[2]}` : '']
    || ({ '10': 1, '20': 2, '51': 6, '71': 8 } as Record<string, number>)[youkuLayout?.[1] || '']
    || (/\bstereo\b|立体声/.test(text) ? 2 : /\bmono\b|单声道/.test(text) ? 1 : undefined)
  // Catalog metadata is only a preview, never evidence about the finished file.
  return { status: 'ambiguous', codec, channels, atmos: /atmos|全景声/.test(text) || undefined }
}

/** Show all known selected specs using the final filename format, without probing or persisting evidence. */
export function namingPreviewFilename(n: Naming, provider: string, quality?: Quality,
  audioTracks: readonly PreviewAudio[] = []): string {
  const stream = (quality?.stream || quality?.id || '').split('|')[0]!.toLowerCase()
  const rangeCode = quality?.iqcnQuality?.dynamicRangeCode
  const marker = provider === 'youku' && /(?:^|_)hq(?:_|$)/.test(stream) ? 'HQ'
    : provider === 'tencent' && stream === 'maxplus' ? 'MAXPLUS'
    : provider === 'iqcn' && (rangeCode != null ? [4, 8].includes(rangeCode)
      : /(?:^|[^a-z0-9])edr(?:$|[^a-z0-9])/i.test(`${quality?.label || ''} ${quality?.title || ''}`)) ? 'EDR' : undefined
  const media: MediaSpecs = {
    status: 'unavailable',
    width: quality?.width,
    height: quality?.height || quality?.tier || n.height,
    codec: videoCodec(quality ? quality.codec : n.codec),
    dynamicRange: quality ? dynamicRange(quality) : undefined,
    fps: quality?.fps,
    audio: audioSpecs(audioTracks[defaultAudioIndex(audioTracks)]),
  }
  return completedFilename(n, media, marker, { preview: true })
}
