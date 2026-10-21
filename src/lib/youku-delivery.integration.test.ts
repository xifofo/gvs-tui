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
mediaTest('Youku exact frame/TV selection keeps matching audio; missing quality or audio stops before downloading', async () => {
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
    run('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'source.mp4', '-map', '0:a', '-c:a', 'eac3', '-b:a', '192k',
      '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'ddp-init.mp4',
      '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'ddp-%d.m4s', 'ddp.m3u8'])
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const cfg = { ...defaultConfig(), outDir: join(root, 'output'), tmpDir: join(root, 'work'), threads: 2, releaseGroup: 'TEST' }
    for (const mode of ['missing-selection', 'hq-default', 'frame-profile-selected', 'frame-ddp', 'muxed-exact', 'hq-missing-audio', 'expired-login', 'expired-exception', 'preview-only', 'declared-short', 'actual-short'] as const) {
      const id = events.length + 1
      const audioCalls: string[] = []
      const hq = 'cmfv5hd4_sdr_hbr_bit10_hq'
      const payload = {
        ...(mode === 'expired-login' ? { needs_relogin:true } : {}),
        ...(mode === 'preview-only' ? { quality_gate:{has_trial:true} } : {}),
        drm: { actually_clear: true }, audio_delivery: 'separate',
        video: { stream_type: hq, playlist_url: `${base}/video.m3u8` },
        streams: [{ stream_type: hq, source: 'frame_xiang', media_type: 'video', playlist_url: `${base}/video.m3u8`, ...(mode === 'declared-short' ? {duration_ms:1000} : {}) },
          ...(mode === 'muxed-exact' ? [{ stream_type: 'mp5hd4', media_type: 'video', playlist_url: `${base}/muxed.m3u8` }] : [])],
        audio_tracks: mode === 'hq-missing-audio' ? [] : mode === 'frame-ddp' ? [{ stream_type:'cmfa4hd4_51', default:true, playlist_url:`${base}/ddp.m3u8` }] : [{ stream_type: 'cmfa1hd3', default: true, playlist_url: `${base}/audio.m3u8` }],
      }
      const cli = { extra: () => ({}), invoke: async (_p: string, _a: string, input: { vid: string; tier?: string; lane?: string }) => {
        audioCalls.push(input.vid)
        if (mode === 'expired-exception') throw Object.assign(new Error('优酷登录已失效，请重新登录'), {errorCode:'RELOGIN_REQUIRED'})
        if (mode === 'frame-profile-selected') {
          expect(input.tier).toBe('single')
          expect(input.lane).toBe('frame_xiang')
          expect((input as Record<string, unknown>).profile).toBe('sdr')
        }
        return payload
      } } as unknown as GwClient
      const t: DlTask = { provider: 'youku', series: 'Fixture', title: mode, vid: mode,
        quality: ['frame-profile-selected', 'frame-ddp', 'hq-missing-audio', 'expired-login', 'expired-exception', 'preview-only', 'declared-short', 'actual-short'].includes(mode) ? `${hq}|frame_xiang` : mode === 'hq-default' ? '' : 'mp5hd4', audioTracks: [], namingVersion: 1, kind: 'show', season: 1, episode: id,
        duration: ['declared-short','actual-short'].includes(mode) ? 3093 : 1, height: 1080, codec: 'H264', group: 'TEST', tmdbId: 0, nameDots: '', year: 2026, plot: '' }
      const requestStart = requested.length
      hub.enqueue(cfg, cli, id, t)
      const deadline = Date.now() + 20000
      while (!events.some(e => e.id === id && e.done)) {
        if (Date.now() > deadline) throw new Error(`${mode}: timeout`)
        await Bun.sleep(10)
      }
      const done = events.find(e => e.id === id && e.done)!
      if (['expired-login','expired-exception','preview-only','declared-short','actual-short'].includes(mode)) {
        expect(done.status).toBe('失败')
        expect(done.err).toContain(['expired-login','expired-exception'].includes(mode) ? '重新登录' : mode === 'preview-only' ? '试看' : '不完整')
        expect(done.requiresReauth === true).toBe(['expired-login','expired-exception'].includes(mode))
        if (mode !== 'actual-short') expect(requested.slice(requestStart)).toHaveLength(0)
        else expect(requested.slice(requestStart)).toContain('/video.m3u8')
        expect(done.completedMedia).toBeUndefined()
        continue
      }
      if (mode === 'missing-selection') {
        expect(done.status).toBe('失败')
        expect(done.err).toContain('所选档位')
        expect(requested.slice(requestStart)).toHaveLength(0)
        continue
      }
      if (mode === 'hq-missing-audio') {
        expect(done.status).toBe('失败')
        expect(done.err).toContain('未返回可下载的独立音轨')
        expect(requested.slice(requestStart)).toHaveLength(0)
        expect(done.err).not.toContain("Stream map ''")
        continue
      }
      if (done.err) throw new Error(done.err)
      expect(done.status).toBe('完成')
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', done.log]))
      expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video'])
      const requests = requested.slice(requestStart)
      if (['hq-default', 'frame-profile-selected', 'frame-ddp'].includes(mode)) {
        expect(requests).toContain(mode === 'frame-ddp' ? '/ddp.m3u8' : '/audio.m3u8')
        expect(probe.streams.find((s: {codec_type:string}) => s.codec_type === 'audio').codec_name).toBe(mode === 'frame-ddp' ? 'eac3' : 'aac')
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
