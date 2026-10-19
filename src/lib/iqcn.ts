import type { StreamOptions } from './quality.ts'
import { asString, isObj } from './util.ts'
import { appendFileSync, writeFileSync, linkSync, unlinkSync, mkdirSync, lstatSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GwClient } from './client.ts'
import type { DlTask } from './jobs.ts'
import { ensureFFmpeg } from './tools.ts'
import type { TrackTiming } from './media-timing.ts'
import { runIQFFmpeg } from './iq-output.ts'
import { downloadIQCNLocalSegment, iqcnProcessing, type IQCNLocalRuntime } from './iqcn-local.ts'
import { orderedDownload, processingQueue } from './ordered-download.ts'
import { restoreIQCNLocal } from './iqcn-local.ts'
import { iqcnAudios, selectIQCNAudios, prepareIQCNAudio, downloadIQCNAudio, type IQCNAudioPlan } from './iqcn-audio.ts'
import { prepareIQCNSubtitles } from './iqcn-subtitles.ts'
import { defaultIQSubtitleIndex } from './iq-subtitles.ts'
import { iqcnNamingEvidence, usesMeasuredNaming } from './completed-naming.ts'
import { iqcnRendition, resolveIQCNSelection } from './iqcn-quality-selection.ts'
import { runLog } from './runlog.ts'
import { orderedMuxAudios } from './audio-selection.ts'
import { clearIQCNDescriptors } from './iqcn-control.ts'
export { iqcnSelection } from './iqcn-quality-selection.ts'

/** Domestic selection uses source BID/bitrate/frame rate, never guessed tiers. */
export function iqcnOptions(data: Record<string, unknown>, sourceTvid = ''): StreamOptions {
  const formats = Array.isArray(data.formats) ? data.formats.filter(isObj) : []
  const counts = new Map<string, number>()
  const qualities = formats.map(raw => {
    const width = Number(raw.width) || 0, height = Number(raw.height) || 0
    const tier = width >= 3800 ? 2160 : width >= 1900 ? 1080 : height
    // Legacy gateways omit names; use the official App tier vocabulary.
    const name = asString(raw.name) || ({ 800: '超高清 4K', 600: '高清 1080P', 500: '准高清 720P', 300: '高清', 200: '标清', 100: '流畅' } as Record<number, string>)[Number(raw.bid)] || '未命名画质'
    const high = Number(raw.br) > 100 ? ' · 高码率' : ''
    const rangeName = ({ 1: '杜比视界', 3: '杜比视界', 2: 'HDR10', 4: 'EDR', 7: 'SDR 10bit', 8: 'EDR 10bit' } as Record<number, string>)[Number(raw.dynamic_range_code)] || ''
    const base = asString(raw.name) || name + high + (rangeName ? ` · ${rangeName}` : '')
    const variant = (counts.get(base) || 0) + 1
    counts.set(base, variant)
    return { id: asString(raw.id), stream: asString(raw.id), label: base + (variant > 1 ? ` · 版本 ${variant}` : ''), title: '爱奇艺国内版',
      width, height, tier, size: Number(raw.size) || 0, fps: Number(raw.fr) || 0, codec: ({ 1: 'H265', 2: 'H264' } as Record<number,string>)[Number(raw.codec_code)] || (/^ts$/i.test(asString(raw.codec)) ? '' : asString(raw.codec).toUpperCase()), drm: Number(raw.drm) > 0 ? 'IQCN' : '',
      iqcnQuality: iqcnRendition(raw, sourceTvid || asString(data.tvid)) }
  }).filter(raw => raw.id)
  return { qualities, audios: iqcnAudios(data) }
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

/** The gateway lost or expired the download plan (restart, 6h limit). */
export const isPlanExpired = (error: unknown): boolean => (error as { errorCode?: unknown } | null)?.errorCode === 'PLAN_EXPIRED'

export async function downloadIQCN(cli: GwClient, task: DlTask, dest: string, work: string, emit: (status: string, pct: number, log: string) => void, signal?: AbortSignal,
  runtime?: IQCNLocalRuntime, threads = 1, options: { reservedOutput?: boolean } = {}): Promise<string> {
  signal?.throwIfAborted()
  if (usesMeasuredNaming(task)) task.namingEvidence = undefined
  // The shared measured-naming runner claims an empty provisional path.
  // Only that unchanged reservation may be removed when publishing the mux.
  const reservation = options.reservedOutput ? lstatSync(dest) : undefined
  if (reservation && (!reservation.isFile() || reservation.size !== 0)) throw new Error('爱奇艺国内版输出占位已改变，未覆盖现有文件')
  emit('匹配画质', 0.01, '按本集匹配所选码率、帧率、编码和动态范围')
  const selection = await resolveIQCNSelection(cli, task, signal)
  signal?.throwIfAborted()
  // 'local-copy' declares that this client can store a whole-file (progressive
  // MP4) rendition directly. Gateways without that declaration keep refusing
  // such plans instead of returning ranges the TS-only helper cannot read.
  const requestPlan = () => cli.invoke('iqcn', 'streams', { tvid: task.vid, ...selection, transport: 'local-v1', 'local-copy': '1' }, {}, { timeoutMs: 150000 })
  let plan = await requestPlan()
  const video = isObj(plan.video) ? plan.video : {}
  let segments = Array.isArray(video.segments) ? video.segments.filter(isObj) : []
  let planId = asString(plan.planId)
  if (!planId || !segments.length) throw new Error('爱奇艺国内版未返回完整下载计划')
  const firstPlanId = planId
  let material: ReturnType<typeof iqcnProcessing> | undefined
  // On PLAN_EXPIRED re-call streams once (single flight) and continue from the
  // checkpoint: written segments stay, only the remaining ones use the new plan.
  // The new plan must describe the identical segment layout, otherwise resuming
  // would splice two different renditions.
  let renewing: Promise<void> | undefined
  const renew = (stale: string) => {
    if (planId !== stale) return Promise.resolve()
    renewing ??= (async () => {
      runLog(`iqcn plan expired tvid=${task.vid}; renewing and resuming`)
      const next = await requestPlan()
      const nextVideo = isObj(next.video) ? next.video : {}
      const nextSegments = Array.isArray(nextVideo.segments) ? nextVideo.segments.filter(isObj) : []
      const nextId = asString(next.planId)
      if (!nextId || nextSegments.length !== segments.length || nextSegments.some((s, i) => Number(s.contentlength) !== Number(segments[i]!.contentlength)))
        throw new Error('爱奇艺国内版下载计划已过期，重新取流后分片布局不同，无法断点续传，请重新下载')
      clearIQCNDescriptors(cli, planId)
      plan = next; segments = nextSegments; planId = nextId; material = iqcnProcessing(next)
    })().finally(() => { renewing = undefined })
    return renewing
  }
  const withPlan = async <T>(run: (id: string, fresh: boolean) => Promise<T>): Promise<T> => {
    const id = planId
    try { return await run(id, id === firstPlanId) }
    catch (error) {
      signal?.throwIfAborted()
      if (!isPlanExpired(error)) throw error
      await renew(id)
      return run(planId, false)
    }
  }
  const transport = join(work, 'iqcn-video.ts'), staged = join(dirname(dest), `.gvs-iqcn-${randomUUID()}${extname(dest)}`)
  try {
    const selected = orderedMuxAudios(selectIQCNAudios(plan, task.audioTracks))
    const audioPlans: IQCNAudioPlan[] = []
    emit('检查音轨', 0.01, '确认所选音轨可用')
    for (const audio of selected) {
      try { audioPlans.push(await withPlan(id => prepareIQCNAudio(cli, id, audio.vid!, signal))) }
      catch (error) {
        signal?.throwIfAborted()
        runLog(`iqcn audio preflight failed tvid=${task.vid} choice=${audio.id}: ${error instanceof Error ? error.message : String(error)}`)
        throw new Error(`“${audio.label}”暂时无法获取，请返回音轨列表选择其他音轨；本次尚未下载视频。`, { cause: error })
      }
    }
    mkdirSync(work, { recursive: true })
    writeFileSync(transport, '')
    material = iqcnProcessing(plan)
    const process = processingQueue(2)
    const metrics={count:0,bytes:0,descriptorMs:0,networkMs:0,restoreMs:0,readMs:0,descriptorRequests:0,fetchAttempts:0}
    const reportMetrics=()=>runLog(`iqcn performance ${JSON.stringify({...metrics,threads,processingWorkers:2,wallMs:Date.now()-started})}`)
    const local: IQCNLocalRuntime = {
      fetch: runtime?.fetch ?? ((url, init) => fetch(url, init)),
      restore: (source, destination, value, abort) => process(() => (runtime?.restore ?? restoreIQCNLocal)(source, destination, value, abort), abort),
      onTiming: timing=>{
        metrics.count++;metrics.bytes+=timing.bytes
        for(const key of ['descriptorMs','networkMs','restoreMs','readMs','descriptorRequests','fetchAttempts'] as const)metrics[key]+=Math.round(timing[key])
        try{runtime?.onTiming?.(timing)}catch{/* observer only */}
        if(metrics.count%20===0)reportMetrics()
      },
    }
    const sizes = segments.map(segment => Number(segment.contentlength))
    const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
    let completedBytes = 0
    const started = Date.now()
    emit('本地下载与处理', 0.02, `分片 0/${segments.length}`)
    await orderedDownload({ sizes, threads, signal,
      pull: (index, abort) => withPlan(id => {
        const segment = segments[index]!
        const initial = Array.isArray(segment.urls) && segment.urls.length
          ? { transport: 'local-v1', index, bytes: sizes[index]!, urls: segment.urls } : undefined
        return downloadIQCNLocalSegment(cli, id, index, sizes[index]!, material!, work, abort, local, initial)
      }),
      write: (bytes, index) => {
        appendFileSync(transport, bytes)
        completedBytes += bytes.length
        const speed = completedBytes / Math.max(0.001, (Date.now() - started) / 1000) / 1048576
        emit('本地下载与处理', 0.02 + completedBytes / totalBytes * 0.87, `分片 ${index + 1}/${segments.length} · 平均 ${speed.toFixed(2)} MiB/s`)
      },
    })
    reportMetrics()
    const ffmpeg = await ensureFFmpeg(undefined, signal)
    const notes: string[] = []
    const copyOptions = { onCodecDiagnostic: () => {
      const note = '封装有可恢复的编码探测提示，已保留下载结果'
      notes.push(note)
      runLog(`iqcn mux probe warning tvid=${task.vid} ${note}`)
    } }
    const audioFiles: Array<{ path: string; language: string; title: string; isDefault: boolean }> = []
    for (const [index, audio] of selected.entries()) {
      signal?.throwIfAborted()
      emit('下载独立音轨', 0.90 + 0.03 * index / selected.length, audio.label)
      const path = join(work, `iqcn-audio-${index}.m4a`)
      // A renewed plan invalidates the audio descriptors prepared for the old one.
      const info = await withPlan((id, fresh) => downloadIQCNAudio(cli, id, audio.vid!, path, threads, signal, runtime?.fetch,
        () => runIQFFmpeg(ffmpeg, ['-i', transport, '-map', '0:a:0', '-c', 'copy', '-y', path], '标准音轨提取失败', signal, copyOptions), fresh ? audioPlans[index] : undefined))
      audioFiles.push({ path, ...info, isDefault: !!audio.isDefault })
    }
    const defaultIndex = Math.max(0, audioFiles.findIndex(audio => audio.isDefault))
    audioFiles.forEach((audio, index) => { audio.isDefault = index === defaultIndex })
    emit('下载字幕', 0.93, '优先原生简繁字幕，缺失时用 OpenCC 补齐')
    const prepared = await withPlan(id => prepareIQCNSubtitles(cli, plan, id, work, signal))
    const subtitles = prepared.subtitles
    const subtitleDefault = defaultIQSubtitleIndex(subtitles)
    if (prepared.note) emit('字幕处理', 0.94, prepared.note)
    emit('封装', 0.95, '生成完整成品')
    // Explicit extension lets ffmpeg determine the destination container.
    const muxed = join(work, dest.toLowerCase().endsWith('.mp4') ? 'iqcn-muxed.mp4' : 'iqcn-muxed.mkv')
    {
      const args = ['-i', transport, ...audioFiles.flatMap(audio => ['-i', audio.path]), ...subtitles.flatMap(sub => ['-i', sub.path]), '-map', '0:v:0']
      if (audioFiles.length) audioFiles.forEach((_, index) => args.push('-map', `${index + 1}:a:0`))
      else args.push('-map', '0:a')
      subtitles.forEach((_, index) => args.push('-map', `${index + audioFiles.length + 1}:s:0`))
      args.push('-c', 'copy', '-c:s', muxed.endsWith('.mp4') ? 'mov_text' : 'srt', '-metadata:s:a', 'title=', '-metadata:s:a', 'handler_name=')
      audioFiles.forEach((audio, index) => args.push(`-metadata:s:a:${index}`, `language=${audio.language}`, `-disposition:a:${index}`, audio.isDefault ? 'default' : '0'))
      if (!audioFiles.length) args.push('-disposition:a', '0', '-disposition:a:0', 'default')
      subtitles.forEach((sub, index) => args.push(`-metadata:s:s:${index}`, `language=${sub.language}`, `-metadata:s:s:${index}`, `title=${sub.title}`, `-disposition:s:${index}`, index === subtitleDefault ? 'default' : '0'))
      args.push('-y', muxed)
      await runIQFFmpeg(ffmpeg, args, '爱奇艺国内版音轨与字幕封装失败', signal, copyOptions)
    }
    const { copyFileSync } = await import('node:fs')
    copyFileSync(muxed, staged)
    signal?.throwIfAborted()
    if (reservation) {
      const current = lstatSync(dest)
      if (!current.isFile() || current.size !== 0 || current.ino !== reservation.ino || current.dev !== reservation.dev)
        throw new Error('爱奇艺国内版输出占位已改变，未覆盖现有文件')
      unlinkSync(dest)
    }
    // Same-directory hard link publishes atomically and refuses an existing
    // destination, including another concurrent task's completed output.
    linkSync(staged, dest)
    unlinkSync(staged)
    if (usesMeasuredNaming(task)) task.namingEvidence = {
      ...iqcnNamingEvidence(plan),
      ...(audioFiles.length ? { muxAudio: { index: defaultIndex, count: audioFiles.length } } : {}),
    }
    return [...new Set([...notes, prepared.note].filter(Boolean))].join('；')
  } finally {
    clearIQCNDescriptors(cli,planId)
    try { unlinkSync(staged) } catch { /* no staged output */ }
    await cli.invoke('iqcn', 'download-finish', { planId }, {}, { timeoutMs: 15000 }).catch(() => undefined)
  }
}
