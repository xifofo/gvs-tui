import { inspectMediaTiming, type TrackTiming } from './media-timing.ts'
import { spawn } from 'node:child_process'
import type { TencentQualitySelection } from '../types.ts'

export type TencentSpecs = { width: number; height: number; fps: number; hdr: boolean }
export function tencentSpecsFromFFmpeg(text: string): TencentSpecs | null {
  const line = text.split(/\r?\n/).find(s => /^\s*Stream #0:\d+.*: Video:/.test(s))
  const dims = line?.match(/\b(\d{2,5})x(\d{2,5})\b/)
  if (!line || !dims) return null
  return { width: Number(dims[1]), height: Number(dims[2]),
    fps: Number(line.match(/([\d.]+) fps\b/)?.[1]) || 0, hdr: /smpte2084|arib-std-b67|dovi|dolby vision/i.test(text) }
}

export function assertTencentSpecs(actual: TencentSpecs | null, selected: TencentQualitySelection, fallbackHeight = 0): void {
  if (!actual) throw new Error('腾讯实际视频规格无法确认，未生成成品')
  const width = selected.width || 0, height = selected.height || 0
  // Legacy queues store a resolution tier. Check width for cropped 4K films.
  const tooSmall = width ? actual.width + 16 < width : height ? actual.height + 16 < height :
    fallbackHeight > 0 ? actual.width + 16 < Math.floor(fallbackHeight * 16 / 9) : false
  if (tooSmall || (height && actual.height + 16 < height) ||
    (selected.fps && actual.fps + 2 < selected.fps) ||
    (selected.hdr && selected.hdr.toLowerCase() !== 'sdr' && !actual.hdr))
    throw new Error(`腾讯返回视频与所选画质不符：实际 ${actual.width}×${actual.height} ${actual.fps}fps ${actual.hdr ? 'HDR' : 'HDR 未确认'}；已停止，未生成成品`)
}

export async function verifyTencentSpecs(ffmpeg: string, path: string, selected: TencentQualitySelection, fallbackHeight = 0, signal?: AbortSignal): Promise<TencentSpecs> {
  const specs = await new Promise<TencentSpecs | null>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-i', path], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('腾讯规格检查超时')) }, 15000)
    child.stderr.on('data', (b: Buffer) => { output = (output + b.toString()).slice(-262144) })
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('close', () => { clearTimeout(timer); signal?.aborted ? reject(signal.reason) : resolve(tencentSpecsFromFFmpeg(output)) })
  })
  assertTencentSpecs(specs, selected, fallbackHeight)
  return specs!
}

/** Packet coverage, rather than MKV duration (which may come from a longer audio track). */
export function assertTencentCoverage(tracks: TrackTiming[], expectedSeconds = 0): void {
  const videos = tracks.filter(t => t.type === 'video')
  if (videos.length !== 1 || !videos[0]!.packets) throw new Error('腾讯视频轨为空或无法确认，未生成成品')
  const span = (t: TrackTiming) => (t.endMs - t.firstMs) / 1000
  const video = span(videos[0]!)
  if (!Number.isFinite(video) || video <= 0) throw new Error('腾讯视频时长无效，未生成成品')
  const compare = (reference: number, label: string) => {
    if (!Number.isFinite(reference) || reference <= 0) return
    const tolerance = Math.max(10, reference * 0.03)
    if (Math.abs(video - reference) > tolerance)
      throw new Error(`腾讯视频不完整：视频 ${video.toFixed(2)} 秒，${label} ${reference.toFixed(2)} 秒；可能返回试看或截断流，未生成成品`)
  }
  compare(expectedSeconds, '分集预期')
  for (const audio of tracks.filter(t => t.type === 'audio')) compare(span(audio), `音轨 ${audio.id}`)
}

export async function verifyTencentCoverage(ffmpeg: string, path: string, expectedSeconds = 0, signal?: AbortSignal): Promise<number> {
  const tracks = await inspectMediaTiming(ffmpeg, path, signal)
  assertTencentCoverage(tracks, expectedSeconds)
  const video = tracks.find(t => t.type === 'video')!
  return (video.endMs - video.firstMs) / 1000
}
