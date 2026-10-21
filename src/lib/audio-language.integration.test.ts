import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkvmergeMux, mkvmergeRemux, type MuxAudio } from './mkvmerge.ts'
import { mp4boxMux, readMp4Tracks } from './mp4box.ts'
import { firstPresentationMs } from './media-timing.ts'
import { mainlandAudioLanguage } from './audio-language.ts'
import { youkuAudioLanguage } from './youku-audio.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip
const run = (bin: string, args: string[]) => {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true })
  if (result.status !== 0) throw new Error(`${bin}: ${result.error ?? result.stderr}`)
  return result.stdout
}

mediaTest('Youku original-language correction replaces generic eng in MKV and MP4 while keeping an explicit English dub', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-youku-language-'))
  try {
    const video = join(dir, 'video.mp4'), audio = join(dir, 'eng-source.mp4')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=0.3', '-c:v', 'libx264', video])
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.3',
      '-c:a', 'aac', '-metadata:s:a:0', 'language=eng', audio])
    const audios = [
      { path: audio, lang: youkuAudioLanguage('原声', 'zh'), isDefault: true },
      { path: audio, lang: youkuAudioLanguage('英语', 'zh'), isDefault: false },
    ]
    for (const container of ['mp4', 'mkv']) {
      const out = join(dir, `corrected.${container}`)
      if (container === 'mp4') {
        await mp4boxMux('MP4Box', video, audios, out, undefined, undefined, 'zh')
        expect((await readMp4Tracks('MP4Box', out)).filter(t => t.type === 'soun').map(t => [t.language, t.enabled]))
          .toEqual([['zho', true], ['eng', false]])
      } else {
        await mkvmergeMux('mkvmerge', video, audios, out, undefined, undefined, undefined, 'zh')
        const tracks = JSON.parse(run('mkvmerge', ['-J', out])).tracks.filter((t: {type: string}) => t.type === 'audio')
        expect(tracks.map((t: {properties: {language: string; default_track: boolean}}) => [t.properties.language, t.properties.default_track]))
          .toEqual([['chi', true], ['eng', false]])
      }
      expect(JSON.parse(readFileSync(`${out}.timing.json`, 'utf8')).verified).toBe(true)
    }
    expect((await readMp4Tracks('MP4Box', audio))[0]!.language).toBe('eng')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 60_000)

mediaTest('MKV and MP4 tag unknown video and audio from the same TMDB fallback, preserving defaults, timing and samples', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-audio-language-'))
  try {
    const video = join(dir, 'video.mp4')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=1', '-c:v', 'libx264', video])
    const audios: MuxAudio[] = ['und', 'eng', 'und', 'und'].map((lang, i) => {
      const path = join(dir, `audio-${i}.mp4`)
      run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 110}:sample_rate=48000:duration=1`,
        '-c:a', 'aac', '-metadata:s:a:0', `language=${lang}`, path])
      return { path, lang: i === 2 ? '粤语' : i === 3 ? '闽南' : '原声', title: `audio-${i}`, isDefault: i === 1 }
    })
    for (const container of ['mkv', 'mp4']) {
      const out = join(dir, `output.${container}`)
      const fallback = mainlandAudioLanguage({ id: 1793262, kind: 'movie', countries: [], originalLanguage: 'zh' })
      if (container === 'mkv') await mkvmergeMux('mkvmerge', video, audios, out, undefined, undefined, undefined, fallback)
      else await mp4boxMux('MP4Box', video, audios, out, undefined, undefined, fallback)
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out]))
      expect(probe.streams.slice(1).map((s: { disposition: { default: number } }) => s.disposition.default)).toEqual([1, 0, 0, 0])
      expect(probe.streams.slice(1).map((s: { codec_name: string }) => s.codec_name)).toEqual(['aac', 'aac', 'aac', 'aac'])
      if (container === 'mkv') {
        const tracks = JSON.parse(run('mkvmerge', ['-J', out])).tracks
        expect(tracks[0].properties.language).toBe('chi')
        expect(tracks[0].properties.language_ietf).toBe('zh')
        // MKV's legacy ISO 639-2 field groups Chinese dialects under chi;
        // the IETF field retains their specific language codes.
        expect(tracks.slice(1).map((t: { properties: { language_ietf: string } }) => t.properties.language_ietf)).toEqual(['en', 'zh', 'yue', 'nan'])
      } else {
        expect((await readMp4Tracks('MP4Box', out)).map(t => t.language)).toEqual(['zho', 'eng', 'zho', 'yue', 'nan'])
      }
      expect(JSON.parse(readFileSync(`${out}.timing.json`, 'utf8')).verified).toBe(true)
      const videoBefore = await firstPresentationMs('ffmpeg', video, 'v:0')
      const videoAfter = await firstPresentationMs('ffmpeg', out, 'v:0')
      const hashes = (path: string, stream: string) => JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', stream,
        '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', path])).packets.map((p: { data_hash: string }) => p.data_hash)
      expect(hashes(out, 'v:0')).toEqual(hashes(video, 'v:0'))
      // Compare coded audio samples as well as their starts; adding labels must not transcode.
      for (const [i, sourceIndex] of [1, 0, 2, 3].entries()) {
        const audio = audios[sourceIndex]!
        expect(hashes(out, `a:${i}`)).toEqual(hashes(audio.path, 'a:0'))
        const before = await firstPresentationMs('ffmpeg', audio.path, 'a:0')
        const after = await firstPresentationMs('ffmpeg', out, `a:${i}`)
        expect(Math.abs((before - videoBefore) - (after - videoAfter))).toBeLessThanOrEqual(2)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 60_000)

mediaTest('a TMDB fallback preserves explicit video language and an unmatched download keeps unknown video language', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-video-language-preserve-'))
  try {
    const audio = join(dir, 'audio.mp4')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.3', '-c:a', 'aac', audio])
    for (const scenario of [{ source: 'eng', fallback: 'zh' }, { source: 'und', fallback: '' }]) {
      const video = join(dir, `video-${scenario.source}.mp4`)
      run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=0.3',
        '-c:v', 'libx264', '-metadata:s:v:0', `language=${scenario.source}`, video])
      for (const container of ['mkv', 'mp4']) {
        const out = join(dir, `${scenario.source}.${container}`)
        if (container === 'mkv') {
          await mkvmergeMux('mkvmerge', video, [{ path: audio, lang: 'eng' }], out, undefined, undefined, undefined, scenario.fallback)
          const tracks = JSON.parse(run('mkvmerge', ['-J', out])).tracks
          expect(tracks[0].properties.language).toBe(scenario.source)
          const remuxed = join(dir, `${scenario.source}-remuxed.mkv`)
          await mkvmergeRemux('mkvmerge', out, remuxed, undefined, undefined, scenario.fallback)
          expect(JSON.parse(run('mkvmerge', ['-J', remuxed])).tracks[0].properties.language).toBe(scenario.source)
        } else {
          await mp4boxMux('MP4Box', video, [{ path: audio, lang: 'eng' }], out, undefined, undefined, scenario.fallback)
          expect((await readMp4Tracks('MP4Box', out))[0]!.language).toBe(scenario.source)
        }
      }
    }
    // Track IDs need not start with video: fill the actual video ID while the
    // source's embedded audio is dropped and the selected audio stays English.
    const mixed = join(dir, 'audio-first.mkv'), out = join(dir, 'audio-first-tagged.mkv')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', audio, '-i', join(dir, 'video-und.mp4'),
      '-map', '0:a:0', '-map', '1:v:0', '-c', 'copy', mixed])
    expect(JSON.parse(run('mkvmerge', ['-J', mixed])).tracks.find((t: { type: string }) => t.type === 'video').id).toBe(1)
    await mkvmergeMux('mkvmerge', mixed, [{ path: audio, lang: 'eng' }], out, undefined, undefined, undefined, 'zh')
    const tracks = JSON.parse(run('mkvmerge', ['-J', out])).tracks
    expect(tracks.find((t: { type: string }) => t.type === 'video').properties.language_ietf).toBe('zh')
    expect(tracks.find((t: { type: string }) => t.type === 'audio').properties.language).toBe('eng')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 60_000)

mediaTest('embedded-audio MKV remux fills unknown video and audio tags and leaves names/foreign audio intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-embedded-language-'))
  try {
    const input = join(dir, 'embedded.mkv'), out = join(dir, 'domestic.mkv'), unchanged = join(dir, 'unmatched.mkv')
    run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=1',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1',
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', '-metadata:s:v:0', 'title=视频说明',
      '-metadata:s:a:0', 'language=und', '-metadata:s:a:0', 'title=普通话 · AAC', '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=英语 · AAC', input])
    await mkvmergeRemux('mkvmerge', input, out, undefined, undefined, 'zh')
    let tracks = JSON.parse(run('mkvmerge', ['-J', out])).tracks
    expect(tracks.map((t: { properties: { language: string } }) => t.properties.language)).toEqual(['chi', 'chi', 'eng'])
    expect(tracks[0].properties.language_ietf).toBe('zh')
    expect(tracks[1].properties.language_ietf).toBe('zh')
    expect(tracks[0].properties.track_name).toBe('视频说明')
    expect(tracks.slice(1).every((t: { properties: { track_name?: string } }) => !t.properties.track_name)).toBe(true)
    await mkvmergeRemux('mkvmerge', input, unchanged)
    tracks = JSON.parse(run('mkvmerge', ['-J', unchanged])).tracks
    expect(tracks.map((t: { properties: { language: string } }) => t.properties.language)).toEqual(['und', 'und', 'eng'])
    expect(tracks[0].properties.track_name).toBe('视频说明')
    expect(tracks.slice(1).every((t: { properties: { track_name?: string } }) => !t.properties.track_name)).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 60_000)
