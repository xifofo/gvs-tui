import type { StreamOptions } from './quality.ts'
import { asString, isObj } from './util.ts'
import { appendFileSync, writeFileSync, linkSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GwClient } from './client.ts'
import type { DlTask } from './jobs.ts'
import { ensureFFmpeg } from './tools.ts'
import { validateVideoDecode } from './ffmpeg.ts'
import { inspectMediaTiming, type TrackTiming } from './media-timing.ts'
import { runIQFFmpeg } from './iq-output.ts'
import { downloadIQCNLocalSegment, iqcnProcessing, type IQCNLocalRuntime } from './iqcn-local.ts'
import { orderedDownload, processingQueue } from './ordered-download.ts'
import { restoreIQCNLocal } from './iqcn-local.ts'
import { iqcnAudios, downloadIQCNAudio } from './iqcn-audio.ts'

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
  return { qualities, audios: iqcnAudios(data) }
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

export async function downloadIQCN(cli: GwClient, task: DlTask, dest: string, work: string, emit: (status: string, pct: number, log: string) => void, signal?: AbortSignal, runtime?: IQCNLocalRuntime, threads = 1): Promise<void> {
  signal?.throwIfAborted()
  const plan = await cli.invoke('iqcn', 'streams', { tvid: task.vid, ...iqcnSelection(task.quality), transport: 'local-v1' }, {}, { timeoutMs: 150000 })
  const video = isObj(plan.video) ? plan.video : {}
  const segments = Array.isArray(video.segments) ? video.segments.filter(isObj) : []
  const planId = asString(plan.planId)
  if (!planId || !segments.length) throw new Error('爱奇艺国内版未返回完整下载计划')
  mkdirSync(work, { recursive: true })
  const transport = join(work, 'iqcn-video.ts'), staged = join(dirname(dest), `.gvs-iqcn-${randomUUID()}${extname(dest)}`)
  writeFileSync(transport, '')
  try {
    const material = iqcnProcessing(plan)
    const process = processingQueue(2)
    const local: IQCNLocalRuntime = {
      fetch: runtime?.fetch ?? ((url, init) => fetch(url, init)),
      restore: (source, destination, value, abort) => process(() => (runtime?.restore ?? restoreIQCNLocal)(source, destination, value, abort), abort),
    }
    const sizes = segments.map(segment => Number(segment.contentlength))
    const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
    let completedBytes = 0
    const started = Date.now()
    emit('本地下载与处理', 0.02, `分片 0/${segments.length}`)
    await orderedDownload({ sizes, threads, signal,
      pull: (index, abort) => downloadIQCNLocalSegment(cli, planId, index, sizes[index]!, material, work, abort, local),
      write: (bytes, index) => {
        appendFileSync(transport, bytes)
        completedBytes += bytes.length
        const speed = completedBytes / Math.max(0.001, (Date.now() - started) / 1000) / 1048576
        emit('本地下载与处理', 0.02 + completedBytes / totalBytes * 0.87, `分片 ${index + 1}/${segments.length} · 平均 ${speed.toFixed(2)} MiB/s`)
      },
    })
    const ffmpeg = await ensureFFmpeg(undefined, signal)
    emit('校验视频', 0.90, '检查还原后的音视频解码')
    const errors = await validateVideoDecode(ffmpeg, transport, signal)
    if (errors.length) throw new Error('爱奇艺国内版还原视频解码失败')
    const videoTiming = await inspectMediaTiming(ffmpeg, transport, signal)
    const available = iqcnAudios(plan)
    const selected = task.audioTracks?.length ? task.audioTracks : available.filter(audio => audio.selected)
    const audioFiles: Array<{ path: string; language: string; title: string; isDefault: boolean }> = []
    for (const [index, audio] of selected.entries()) {
      signal?.throwIfAborted()
      emit('下载独立音轨', 0.90 + 0.03 * index / selected.length, audio.label)
      const path = join(work, `iqcn-audio-${index}.m4a`)
      const matching = available.filter(option => option.id === audio.id)
      if (matching.length !== 1 || !matching[0]!.vid) throw new Error('当前集缺少所选音轨，请重新选择')
      const info = await downloadIQCNAudio(cli, planId, matching[0]!.vid!, path, threads, signal, runtime?.fetch,
        () => runIQFFmpeg(ffmpeg, ['-i', transport, '-map', '0:a:0', '-c', 'copy', '-y', path], '标准音轨提取失败', signal))
      await runIQFFmpeg(ffmpeg, ['-xerror', '-err_detect', 'explode', '-i', path, '-map', '0:a:0', '-f', 'null', '-'], '所选音轨解码校验失败', signal)
      const timing = await inspectMediaTiming(ffmpeg, path, signal)
      if (timing.filter(track => track.type === 'audio').length !== 1) throw new Error('所选独立音轨数量异常')
      assertIQCNCoverage([...videoTiming.filter(track => track.type === 'video'), ...timing], task.duration || 0)
      audioFiles.push({ path, ...info, isDefault: !!audio.isDefault })
    }
    if (!audioFiles.length) assertIQCNCoverage(videoTiming, task.duration || 0)
    const defaultIndex = Math.max(0, audioFiles.findIndex(audio => audio.isDefault))
    audioFiles.forEach((audio, index) => { audio.isDefault = index === defaultIndex })
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
    {
      const args = ['-i', transport, ...audioFiles.flatMap(audio => ['-i', audio.path]), ...subtitles.flatMap(sub => ['-i', sub.path]), '-map', '0:v:0']
      if (audioFiles.length) audioFiles.forEach((_, index) => args.push('-map', `${index + 1}:a:0`))
      else args.push('-map', '0:a')
      subtitles.forEach((_, index) => args.push('-map', `${index + audioFiles.length + 1}:s:0`))
      args.push('-c', 'copy', '-c:s', muxed.endsWith('.mp4') ? 'mov_text' : 'srt')
      audioFiles.forEach((audio, index) => args.push(`-metadata:s:a:${index}`, `language=${audio.language}`, `-metadata:s:a:${index}`, `title=${audio.title}`, `-disposition:a:${index}`, audio.isDefault ? 'default' : '0'))
      subtitles.forEach((sub, index) => args.push(`-metadata:s:s:${index}`, `language=${sub.language}`))
      args.push('-y', muxed)
      await runIQFFmpeg(ffmpeg, args, '爱奇艺国内版音轨与字幕封装失败', signal)
    }
    const finalTiming = await inspectMediaTiming(ffmpeg, muxed, signal)
    assertIQCNCoverage(finalTiming, task.duration || 0)
    if (audioFiles.length && finalTiming.filter(track => track.type === 'audio').length !== audioFiles.length) throw new Error('成品音轨数量与选择不一致')
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
