import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkvmergeMux, mkvmergeRemux, mkvmergeTrackFiles } from './mkvmerge.ts'
import { ensureFFmpeg, ensureMkvmerge } from './tools.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip

mediaTest('MKV release group preserves other tags, track flags and coded media in all local mux paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-group-mux-'))
  try {
    const ffmpeg = await ensureFFmpeg(), mkvmerge = await ensureMkvmerge()
    const run = (bin: string, args: string[]) => {
      const p = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000, windowsHide: true })
      if (p.status !== 0) throw new Error(p.stderr || String(p.error))
      return p.stdout
    }
    const source = join(root, 'source.mkv'), video = join(root, 'video.mkv'), audio = join(root, 'audio.mka')
    run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=0.4',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.4', '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-c:a', 'aac', '-metadata', 'COMMENT=keep me',
      '-metadata:s:a', 'language=zho', '-disposition:a', 'default', source])
    run(ffmpeg, ['-nostdin', '-v', 'error', '-i', source, '-map', '0:v', '-c', 'copy', video])
    run(ffmpeg, ['-nostdin', '-v', 'error', '-i', source, '-map', '0:a', '-c', 'copy', audio])
    const hash = (file: string) => run(ffmpeg, ['-nostdin', '-v', 'error', '-i', file,
      '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-']).trim()
    const expectedHash = hash(source)
    const verify = (file: string, group: string) => {
      const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]))
      expect(info.format.tags.GROUP).toBe(group)
      expect(info.format.tags.COMMENT).toBe('keep me')
      expect(info.streams.map((s: { codec_type: string }) => s.codec_type)).toEqual(['video', 'audio'])
      expect(info.streams[1].disposition.default).toBe(1)
      expect(info.streams[1].tags.language).toBe('chi')
      expect(hash(file)).toBe(expectedHash)
    }
    const remuxed = join(root, 'remuxed.mkv')
    await mkvmergeRemux(mkvmerge, source, remuxed, undefined, undefined, '', 'WF & 组')
    verify(remuxed, 'WF & 组')
    const muxed = join(root, 'muxed.mkv')
    await mkvmergeMux(mkvmerge, video, [{ path: audio, lang: 'zh', isDefault: true }], muxed,
      undefined, undefined, undefined, '', 'WF')
    verify(muxed, 'WF')
    const independent = join(root, 'independent.mkv')
    await mkvmergeTrackFiles(mkvmerge, [video, audio], independent, undefined, undefined, '', 'WF')
    verify(independent, 'WF')
    const blank = join(root, 'blank.mkv')
    await mkvmergeRemux(mkvmerge, source, blank)
    expect(JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', blank])).format.tags.GROUP).toBeUndefined()
    expect(readdirSync(root).some(p => p === '.gvs-tmp')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 60000)
