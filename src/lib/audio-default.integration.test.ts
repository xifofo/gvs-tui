import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkvmergeMux } from './mkvmerge.ts'
import { mp4boxMux } from './mp4box.ts'

// Opt in on a host with ffmpeg, ffprobe, mkvmerge and MP4Box installed.
const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip
mediaTest('MKV and MP4 both retain all tracks and mark the second audio as the only default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-audio-default-'))
  const run = (bin: string, args: string[]) => {
    const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000 })
    if (result.status !== 0) throw new Error(`${bin}: ${result.error ?? result.stderr}`)
    return result.stdout
  }
  try {
    const video = join(dir, 'video.mp4')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=1', '-c:v', 'libx264', video])
    const audios = [440, 660, 880].map((frequency, i) => {
      const path = join(dir, `audio-${i}.mp4`)
      run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=1`, '-c:a', 'aac', path])
      return { path, title: ['普通话', '闽南', '其他'][i], lang: i === 1 ? '闽南' : '普通话', isDefault: i === 1 }
    })
    for (const container of ['mkv', 'mp4']) {
      const out = join(dir, `output.${container}`)
      if (container === 'mkv') await mkvmergeMux('mkvmerge', video, audios, out)
      else await mp4boxMux('MP4Box', video, audios, out)
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_streams', '-of', 'json', out]))
      expect(probe.streams).toHaveLength(3)
      expect(probe.streams.map((s: { disposition: { default: number } }) => s.disposition.default)).toEqual([0, 1, 0])
      expect(probe.streams.map((s: { codec_name: string }) => s.codec_name)).toEqual(['aac', 'aac', 'aac'])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 60000)
