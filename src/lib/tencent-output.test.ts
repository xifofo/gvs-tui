import { expect, test } from 'bun:test'
import { assertTencentCoverage, assertTencentSpecs, tencentSpecsFromFFmpeg, verifyTencentCoverage } from './tencent-output.ts'
import type { TrackTiming } from './media-timing.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { lookBundledFFmpeg } from './tools.ts'

function track(type: string, seconds: number, firstMs = 0): TrackTiming {
  return { id: type === 'video' ? 0 : 1, type, firstMs, endMs: firstMs + seconds * 1000, packets: 10, maxGapMs: 0, maxOverlapMs: 0 }
}

test('three-minute video plus 46-minute audio fails even without an episode duration', () => {
  expect(() => assertTencentCoverage([track('video', 207.72), track('audio', 2765)])).toThrow('不完整')
  expect(() => assertTencentCoverage([track('video', 206.24)], 2765)).toThrow('不完整')
  expect(() => assertTencentCoverage([track('audio', 2765)])).toThrow('视频轨')
})

test('actual short episodes, packet offsets and small encoder padding are accepted', () => {
  expect(() => assertTencentCoverage([track('video', 200, 90000), track('audio', 201, 89970)], 200)).not.toThrow()
  expect(() => assertTencentCoverage([track('video', 2765), track('audio', 2765.032)], 2765)).not.toThrow()
})

test('1080p/25fps video cannot satisfy selected 4K/60fps/HDR specs', () => {
  const specs = tencentSpecsFromFFmpeg('  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt709), 1920x1080, 25 fps, 25 tbr')
  expect(specs).toEqual({ width: 1920, height: 1080, fps: 25, hdr: false })
  expect(() => assertTencentSpecs(specs, { width: 3840, height: 2160, fps: 60, hdr: 'hdr' })).toThrow('画质不符')
  expect(() => assertTencentSpecs({ width: 3840, height: 1608, fps: 60, hdr: true }, { width: 3840, height: 1608, fps: 60, hdr: 'hdr' })).not.toThrow()
  expect(() => assertTencentSpecs({ width: 3840, height: 1608, fps: 25, hdr: false }, {}, 2160)).not.toThrow()
})

test.skipIf(process.env.GVS_MEDIA_TESTS !== '1')('real MKV with longer audio fails packet-based completion', async () => {
  const ffmpeg = lookBundledFFmpeg() || 'ffmpeg'
  const dir = mkdtempSync(join(tmpdir(), 'gvs-tencent-duration-'))
  try {
    const dest = join(dir, 'short-video.mkv')
    execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=25:d=1',
      '-f', 'lavfi', '-i', 'sine=duration=15', '-c:v', 'mpeg4', '-c:a', 'aac', '-y', dest], { windowsHide: true })
    await expect(verifyTencentCoverage(ffmpeg, dest)).rejects.toThrow('不完整')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
