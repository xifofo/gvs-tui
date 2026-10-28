import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTask, type DlTask, type JobEvt } from './jobs.ts'
import { defaultConfig } from './config.ts'
import { ensureFFmpeg, ensureMkvmerge } from './tools.ts'
import { subtitleDownloadTracks } from './subtitle-selection.ts'
import { tencentSubtitleOptions } from './tencent-subtitles.ts'
import { mkvmergeRemux } from './mkvmerge.ts'
import type { GwClient } from './client.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip
for (const scenario of ['embedded', 'separate-audio', 'hant-only', 'empty', 'hard', 'missing', 'partial', 'refresh', 'pause'] as const) {
  mediaTest(`Tencent subtitle runner: ${scenario}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gvs-tencent-subs-'))
    const oldRecords = process.env.GVS_VERSION_RECORDS_PATH
    process.env.GVS_VERSION_RECORDS_PATH = join(dir, 'versions.jsonl')
    const server = createServer(), stop = new AbortController()
    try {
      const ffmpeg = await ensureFFmpeg(), mkvmerge = await ensureMkvmerge()
      const source = join(dir, 'source.ts'), audio = join(dir, 'audio.ts')
      execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x240:r=25:d=4',
        '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=4', '-t', '4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mpegts', '-y', source])
      execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', source, '-vn', '-c:a', 'copy', '-f', 'mpegts', '-y', audio])
      const videoBytes = readFileSync(source), audioBytes = readFileSync(audio), requests: string[] = []
      server.on('request', (req, res) => {
        const path = req.url!; requests.push(path)
        if (path === '/expired.ts') { res.writeHead(403); res.end(); return }
        if (path === '/source.ts' || path === '/audio.ts') {
          const bytes = path === '/source.ts' ? videoBytes : audioBytes
          res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': bytes.length }); res.end(bytes); return
        }
        if (path === '/audio.m3u8') { res.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\naudio.ts\n#EXT-X-ENDLIST\n'); return }
        expect(req.headers.referer).toContain('v.qq.com')
        if (path.includes('.m3u8')) { res.end('#EXTM3U\n#EXTINF:2,\n0.vtt\n#EXTINF:2,\n1.vtt\n#EXT-X-ENDLIST\n'); return }
        if (path.endsWith('1.vtt') && scenario === 'partial') { res.writeHead(404); res.end(); return }
        if (path.endsWith('1.vtt') && scenario === 'pause') { stop.abort('pause'); res.end(); return }
        res.end(`WEBVTT\n\n00:00:00.100 --> 00:00:00.900\n${path.includes('/hant/') ? '繁體台詞' : '简体台词'}\n`)
      })
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const subtitleRows = (generation: string) => ['hant', 'hans'].map(lang => ({ id: `${generation}-${lang}`,
        lang: lang === 'hans' ? 'zh-cn' : 'zh-tw', name: lang === 'hans' ? '简体中文' : '繁體中文',
        format: 'vtt', url: `${base}/${generation}/${lang}/sub.vtt.m3u8` }))
      let plays = 0
      const cli = { invoke: async () => {
        plays++
        const caption = scenario === 'hard' ? 'hard' : 'soft'
        const url = base + (scenario === 'refresh' && plays === 1 ? '/expired.ts' : '/source.ts')
        return { duration: 4, formats: [{ id: 'current', name: 'fhd', width: 320, height: 240, fps: 25, caption, url }],
          video: { defn: 'fhd', format_id: 'current', caption, url },
          subtitles: scenario === 'missing' ? [] : subtitleRows(plays === 1 ? 'current' : 'fresh'),
          audio_tracks: [{ id: 'aac', cname: '国语', lang: 'zh', codec: 'AAC', playlist_url: base + '/audio.m3u8' }] }
      }, extra: () => ({}), observeTencentTransfer: () => {} } as unknown as GwClient
      const task: DlTask = { provider: 'tencent', title: '字幕测试', series: '字幕测试', vid: 'fixture-episode-2',
        season: 1, episode: 2, duration: 4, height: 240, quality: 'fhd', codec: 'AVC',
        tencentQuality: { formatId: 'current', width: 320, height: 240, fps: 25, captionProbe: scenario === 'hard' ? 'hard' : 'soft' },
        subtitleTracks: subtitleDownloadTracks(tencentSubtitleOptions({ subtitles: subtitleRows('probe-episode-1') })),
        year: 2026, group: 'WF', tmdbId: 0, nameDots: '', plot: '', kind: 'show' }
      if (scenario === 'empty') task.subtitleTracks = []
      if (scenario === 'hant-only') task.subtitleTracks = task.subtitleTracks!.filter(s => s.lang === 'zh-tw')
      if (scenario === 'separate-audio') task.audioTracks = [{ id: 'aac', label: '国语', lang: 'zh', codec: 'AAC', isDefault: true }]
      const selectionBefore = JSON.stringify(task.subtitleTracks)
      const cfg = { ...defaultConfig(), outDir: join(dir, 'library'), tmpDir: join(dir, 'work'), releaseGroup: 'WF', threads: 1 }
      const events: JobEvt[] = []
      await runTask(e => events.push(e), cfg, cli, 1, task, AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]))
      const final = [...events].reverse().find(e => e.done)!
      expect(JSON.stringify(task.subtitleTracks)).toBe(selectionBefore)
      if (scenario === 'missing' || scenario === 'partial' || scenario === 'pause') {
        expect(final.status).toBe(scenario === 'pause' ? '已暂停' : '失败')
        if (scenario === 'missing') { expect(final.err).toContain('所选字幕'); expect(requests).toEqual([]) }
        if (scenario === 'partial') expect(final.err).toContain('字幕下载或封装失败')
        if (scenario === 'pause') expect(final.stopped).toBe('pause')
        expect(readdirSync(cfg.outDir, { recursive: true }).filter(p => String(p).endsWith('.mkv'))).toEqual([])
        return
      }
      expect(final.err).toBe(''); expect(final.status).toBe('完成'); expect(existsSync(final.log)).toBe(true)
      const tracks = JSON.parse(execFileSync(mkvmerge, ['-J', final.log], { encoding: 'utf8' })).tracks
      expect(tracks.filter((t: any) => t.type === 'video')).toHaveLength(1)
      expect(tracks.filter((t: any) => t.type === 'audio')).toHaveLength(1)
      const subtitles = tracks.filter((t: any) => t.type === 'subtitles').map((t: any) => t.properties)
      if (scenario === 'empty' || scenario === 'hard') {
        expect(subtitles).toEqual([])
        expect(requests.some(p => p.includes('.vtt'))).toBe(false)
      } else {
        const hantOnly = scenario === 'hant-only'
        expect(subtitles.map((s: any) => s.language_ietf)).toEqual(hantOnly ? ['zh-Hant'] : ['zh-Hans', 'zh-Hant'])
        expect(subtitles.map((s: any) => s.track_name)).toEqual(hantOnly ? ['繁體中文'] : ['简体中文', '繁體中文'])
        expect(subtitles.map((s: any) => s.default_track)).toEqual(hantOnly ? [true] : [true, false])
        expect(subtitles.every((s: any) => !s.forced_track)).toBe(true)
        const text = execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', final.log, '-map', '0:s:0', '-f', 'webvtt', '-'], { encoding: 'utf8' })
        expect(text).toContain(hantOnly ? '繁體台詞' : '简体台词')
        expect(text).toContain('00:02.100 --> 00:02.900')
        expect(requests.some(p => p.includes('probe-episode-1'))).toBe(false)
        if (scenario === 'refresh') {
          expect(plays).toBe(2)
          expect(requests.some(p => p.startsWith('/fresh/'))).toBe(true)
          expect(requests.some(p => p.startsWith('/current/'))).toBe(false)
        }
      }
      // Compare with the same video/audio remux without subtitles (TS framing changes on remux).
      const baseline = join(dir, 'baseline.mkv')
      await mkvmergeRemux(mkvmerge, source, baseline)
      const hashes = (path: string) => execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', path,
        '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim()
      expect(hashes(final.log)).toBe(hashes(baseline))
      const meta = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', final.log], { encoding: 'utf8' }))
      expect(meta.format.tags.GROUP).toBe('WF')
      if (scenario === 'separate-audio') expect(requests).toContain('/audio.ts')
    } finally {
      if (server.listening) await new Promise<void>(r => server.close(() => r()))
      if (oldRecords === undefined) delete process.env.GVS_VERSION_RECORDS_PATH
      else process.env.GVS_VERSION_RECORDS_PATH = oldRecords
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
}
