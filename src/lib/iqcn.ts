import type { StreamOptions } from './quality.ts'
import { asString, isObj } from './util.ts'
import { appendFileSync, writeFileSync, linkSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GwClient } from './client.ts'
import type { DlTask } from './jobs.ts'
import { ensureFFmpeg } from './tools.ts'
import { ffmpegRemux, validateVideoDecode } from './ffmpeg.ts'
import { inspectMediaTiming, type TrackTiming } from './media-timing.ts'
import { runIQFFmpeg } from './iq-output.ts'

/** Domestic selection uses source BID/bitrate/frame rate, never guessed tiers. */
export function iqcnOptions(data: Record<string, unknown>): StreamOptions {
  const formats = Array.isArray(data.formats) ? data.formats.filter(isObj) : []
  const counts = new Map<string, number>()
  const qualities = formats.map(raw => {
    const width = Number(raw.width) || 0, height = Number(raw.height) || 0
    const tier = width >= 3800 ? 2160 : width >= 1900 ? 1080 : height
    // Legacy gateways omit names; use the official App tier vocabulary.
    const name = asString(raw.name) || ({ 800: '超高清 4K', 600: '高清 1080P', 500: '准高清 720P', 300: '高清', 200: '标清', 100: '流畅' } as Record<number, string>)[Number(raw.bid)] || '未命名画质'
    const high = Number(raw.br) > 100 ? ' · 高码率' : ''
    const rangeName = ({ 1: '杜比视界', 3: '杜比视界', 2: 'HDR10', 7: 'SDR 10bit' } as Record<number, string>)[Number(raw.dynamic_range_code)] || ''
    const base = asString(raw.name) || name + high + (rangeName ? ` · ${rangeName}` : '')
    const variant = (counts.get(base) || 0) + 1
    counts.set(base, variant)
    return { id: asString(raw.id), stream: asString(raw.id), label: base + (variant > 1 ? ` · 版本 ${variant}` : ''), title: '爱奇艺国内版',
      width, height, tier, size: Number(raw.size) || 0, fps: Number(raw.fr) || 0, codec: ({ 1: 'H265', 2: 'H264' } as Record<number,string>)[Number(raw.codec_code)] || (/^ts$/i.test(asString(raw.codec)) ? '' : asString(raw.codec).toUpperCase()), drm: Number(raw.drm) > 0 ? 'IQCN' : '' }
  }).filter(raw => raw.id)
  return { qualities, audios: [] }
}

export function iqcnSelection(quality: string): Record<string, string> {
  const parts = quality.split('|')
  if (![3, 4].includes(parts.length)) throw new Error('爱奇艺国内版画质选择无效')
  const [bid, br, fr, vid] = parts
  if (![bid, br, fr].every(value => value && /^[1-9]\d*$/.test(value))) throw new Error('爱奇艺国内版画质选择无效')
  if (parts.length === 4 && !/^[A-Za-z0-9]+$/.test(vid || '')) throw new Error('爱奇艺国内版视频标识无效')
  return { bid: bid!, br: br!, fr: fr!, ...(vid ? { vid } : {}) }
}

export function assertIQCNCoverage(tracks: TrackTiming[], expectedSeconds = 0): void {
  const videos = tracks.filter(track => track.type === 'video')
  if (videos.length !== 1 || !videos[0]!.packets) throw new Error('爱奇艺国内版视频轨为空，未生成成品')
  const duration = (videos[0]!.endMs - videos[0]!.firstMs) / 1000
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('爱奇艺国内版视频时长无效')
  const audios = tracks.filter(track => track.type === 'audio')
  if (!audios.length) throw new Error('爱奇艺国内版未取得音轨，未生成成品')
  for (const reference of [expectedSeconds, ...audios.map(track => (track.endMs - track.firstMs) / 1000)]) {
    if (reference > 0 && Math.abs(duration - reference) > Math.max(10, reference * 0.03)) throw new Error('爱奇艺国内版视频或音轨不完整，未生成成品')
  }
}

export async function downloadIQCN(cli: GwClient, task: DlTask, dest: string, work: string, emit: (status: string, pct: number, log: string) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const plan = await cli.invoke('iqcn', 'streams', { tvid: task.vid, ...iqcnSelection(task.quality) }, {}, { timeoutMs: 150000 })
  const video = isObj(plan.video) ? plan.video : {}
  const segments = Array.isArray(video.segments) ? video.segments.filter(isObj) : []
  const planId = asString(plan.planId)
  if (!planId || !segments.length) throw new Error('爱奇艺国内版未返回完整下载计划')
  mkdirSync(work, { recursive: true })
  const transport = join(work, 'iqcn-video.ts'), staged = join(dirname(dest), `.gvs-iqcn-${randomUUID()}${extname(dest)}`)
  writeFileSync(transport, '')
  try {
    for (let index = 0; index < segments.length; index++) {
      signal?.throwIfAborted()
      emit('下载与还原', 0.02 + index / segments.length * 0.87, `分片 ${index + 1}/${segments.length}`)
      const result = await cli.invoke('iqcn', 'download-segment', { planId, index }, {}, { timeoutMs: 150000 })
      signal?.throwIfAborted()
      const bytes = Buffer.from(asString(result.data), 'base64')
      if ((result.restored !== true && result.clearCandidate !== true) || Number(result.index) !== index || !bytes.length || Number(result.bytes) !== bytes.length) throw new Error('爱奇艺国内版分片还原或长度校验失败')
      appendFileSync(transport, bytes)
    }
    const ffmpeg = await ensureFFmpeg(undefined, signal)
    emit('校验视频', 0.90, '检查还原后的音视频解码')
    const errors = await validateVideoDecode(ffmpeg, transport, signal)
    if (errors.length) throw new Error('爱奇艺国内版还原视频解码失败')
    assertIQCNCoverage(await inspectMediaTiming(ffmpeg, transport, signal), task.duration || 0)
    const subtitles: Array<{ path: string; language: string }> = []
    const sourceSubs = Array.isArray(plan.subtitles) ? plan.subtitles.filter(isObj) : []
    for (const sub of sourceSubs) {
      const formats = Array.isArray(sub.formats) ? sub.formats : []
      const format = formats.includes('srt') ? 'srt' : formats.includes('webvtt') ? 'webvtt' : ''
      if (!format) continue
      signal?.throwIfAborted()
      emit('下载字幕', 0.93, `字幕 ${sub.index}`)
      const result = await cli.invoke('iqcn', 'download-subtitle', { planId, index: sub.index, format }, {}, { timeoutMs: 150000 })
      const bytes = Buffer.from(asString(result.data), 'base64')
      if (!bytes.length || Number(result.bytes) !== bytes.length || Number(result.index) !== Number(sub.index) || result.format !== format) throw new Error('爱奇艺国内版字幕响应无效')
      const path = join(work, `iqcn-sub-${sub.index}.${format === 'srt' ? 'srt' : 'vtt'}`)
      writeFileSync(path, bytes)
      subtitles.push({ path, language: Number(sub.language_id) === 1 ? 'zho' : 'und' })
    }
    emit('封装', 0.95, '生成完整成品')
    // Explicit extension lets ffmpeg determine the destination container.
    const muxed = join(work, dest.toLowerCase().endsWith('.mp4') ? 'iqcn-muxed.mp4' : 'iqcn-muxed.mkv')
    if (!subtitles.length) await ffmpegRemux(ffmpeg, transport, muxed, undefined, signal)
    else {
      const args = ['-i', transport, ...subtitles.flatMap(sub => ['-i', sub.path]), '-map', '0:v', '-map', '0:a']
      subtitles.forEach((_, index) => args.push('-map', `${index + 1}:s:0`))
      args.push('-c', 'copy', '-c:s', muxed.endsWith('.mp4') ? 'mov_text' : 'srt')
      subtitles.forEach((sub, index) => args.push(`-metadata:s:s:${index}`, `language=${sub.language}`))
      args.push('-y', muxed)
      await runIQFFmpeg(ffmpeg, args, '爱奇艺国内版字幕封装失败', signal)
    }
    const { copyFileSync } = await import('node:fs')
    copyFileSync(muxed, staged)
    signal?.throwIfAborted()
    // Same-directory hard link publishes atomically and refuses an existing
    // destination, including another concurrent task's completed output.
    linkSync(staged, dest)
    unlinkSync(staged)
  } finally {
    try { unlinkSync(staged) } catch { /* no staged output */ }
    await cli.invoke('iqcn', 'download-finish', { planId }, {}, { timeoutMs: 15000 }).catch(() => undefined)
  }
}
