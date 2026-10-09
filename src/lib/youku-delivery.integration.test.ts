import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from './config.ts'
import { JobHub, type DlTask, type JobEvt } from './jobs.ts'
import type { GwClient } from './client.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip

// Synthetic, clear media on a local CDN. No account, gateway or real programme.
mediaTest('Youku missing TV quality falls back to HQ with default audio; exact TV selection keeps embedded audio', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-youku-delivery-'))
  const run = (bin: string, args: string[]) => {
    const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 20000 })
    if (r.status !== 0) throw new Error(`${bin}: ${r.error ?? r.stderr}`)
    return r.stdout
  }
  const requested: string[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname
    requested.push(path)
    try {
      const bytes = readFileSync(join(root, path))
      res.writeHead(200, { 'Content-Length': bytes.length }).end(bytes)
    } catch { res.writeHead(404).end() }
  })
  const events: JobEvt[] = []
  const hub = new JobHub(e => events.push(e))
  try {
    run('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-g', '25', '-c:a', 'aac', 'source.mp4'])
    for (const [name, map] of [['video', '0:v'], ['audio', '0:a'], ['muxed', '0']] as const) {
      run('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'source.mp4', '-map', map, '-c', 'copy',
        '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', `${name}-init.mp4`,
        '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', `${name}-%d.m4s`, `${name}.m3u8`])
    }
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const cfg = { ...defaultConfig(), outDir: join(root, 'output'), tmpDir: join(root, 'work'), threads: 2, releaseGroup: 'TEST' }
    for (const mode of ['hq-fallback', 'muxed-exact', 'hq-missing-audio'] as const) {
      const id = events.length + 1
      const audioCalls: string[] = []
      const hq = 'cmfv5hd4_sdr_hbr_bit10_hq'
      const payload = {
        drm: { actually_clear: true }, audio_delivery: 'separate',
        video: { stream_type: hq, playlist_url: `${base}/video.m3u8` },
        streams: [{ stream_type: hq, media_type: 'video', playlist_url: `${base}/video.m3u8` },
          ...(mode === 'muxed-exact' ? [{ stream_type: 'mp5hd4', media_type: 'video', playlist_url: `${base}/muxed.m3u8` }] : [])],
        audio_tracks: mode === 'hq-missing-audio' ? [] : [{ stream_type: 'cmfa1hd3', default: true, playlist_url: `${base}/audio.m3u8` }],
      }
      const cli = { extra: () => ({}), invoke: async (_p: string, _a: string, input: { vid: string }) => {
        audioCalls.push(input.vid)
        return payload
      } } as unknown as GwClient
      const t: DlTask = { provider: 'youku', series: 'Fixture', title: mode, vid: mode,
        quality: 'mp5hd4', audioTracks: [], namingVersion: 1, kind: 'show', season: 1, episode: id,
        height: 1080, codec: 'H264', group: 'TEST', tmdbId: 0, nameDots: '', year: 2026, plot: '' }
      const requestStart = requested.length
      hub.enqueue(cfg, cli, id, t)
      const deadline = Date.now() + 20000
      while (!events.some(e => e.id === id && e.done)) {
        if (Date.now() > deadline) throw new Error(`${mode}: timeout`)
        await Bun.sleep(10)
      }
      const done = events.find(e => e.id === id && e.done)!
      if (mode === 'hq-missing-audio') {
        expect(done.status).toBe('失败')
        expect(done.err).toContain('下载的文件中没有音频轨道')
        expect(done.err).not.toContain("Stream map ''")
        continue
      }
      if (done.err) throw new Error(done.err)
      expect(done.status).toBe('完成')
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', done.log]))
      expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video'])
      const requests = requested.slice(requestStart)
      if (mode === 'hq-fallback') {
        expect(requests).toContain('/audio.m3u8')
        expect(audioCalls).toEqual([mode, mode])
        expect(t.namingEvidence?.marker).toBe('HQ')
        expect(done.log).toContain('.WEB-DL.HQ.')
      } else {
        expect(requests).not.toContain('/audio.m3u8')
        expect(audioCalls).toEqual([mode])
        expect(t.namingEvidence?.marker).toBeUndefined()
      }
    }
  } finally {
    await hub.cancelAll()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
