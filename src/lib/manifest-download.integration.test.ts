import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobHub, type DlTask, type JobEvt } from './jobs.ts'
import type { FileConfig } from './config.ts'
import type { GwClient } from './client.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip

// Synthesized media and a local CDN exercise the actual shared job pipeline.
// No provider login, signed URL or downloaded programme is used by this test.
mediaTest('manifest jobs produce real MKV with audio from HLS, master HLS and DASH', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-manifest-download-'))
  const run = (bin: string, args: string[]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 20000 })
    if (result.status !== 0) throw new Error(`${bin}: ${result.error ?? result.stderr}`)
    return result.stdout
  }
  const server = createServer((req, res) => {
    if (req.headers['x-fixture-key'] !== 'fixture') { res.writeHead(403).end(); return }
    try {
      const file = readFileSync(join(root, new URL(req.url || '/', 'http://localhost').pathname))
      res.writeHead(200, { 'Content-Length': String(file.length) }).end(file)
    } catch { res.writeHead(404).end() }
  })
  const events: JobEvt[] = []
  const hub = new JobHub(e => events.push(e))
  try {
    run('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '10', '-c:a', 'aac', 'source.mp4'])
    run('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'source.mp4', '-c', 'copy', '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'single_%d.ts', 'single.m3u8'])
    run('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'source.mp4', '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'hls', '-var_stream_map', 'v:0 a:0,agroup:audio,default:yes', '-master_pl_name', 'master.m3u8', '-hls_segment_type', 'fmp4', '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'stream_%v_%d.m4s', 'stream_%v.m3u8'])
    run('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'source.mp4', '-map', '0', '-c', 'copy', '-f', 'dash', '-seg_duration', '1', 'manifest.mpd'])
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const cfg = { outDir: join(root, 'output'), tmpDir: join(root, 'work'), threads: 2, releaseGroup: 'TEST' } as FileConfig
    for (const [i, path] of ['single.m3u8', 'master.m3u8', 'manifest.mpd'].entries()) {
      const cli = { invoke: async () => ({ media: [{ type: 'video', url: `${base}/${path}`, format: path.endsWith('.mpd') ? 'dash' : 'hls', drm: { clear: true }, headers: { 'X-Fixture-Key': 'fixture' } }] }) } as unknown as GwClient
      const task: DlTask = { provider: i === 1 ? 'hamivideo' : 'mewatch', title: 'Fixture', series: 'Fixture', vid: path, quality: 'auto', season: 1, episode: i + 1, height: 1080, codec: 'H264', group: 'TEST', tmdbId: 0, nameDots: '', year: 2026, plot: '' }
      hub.enqueue(cfg, cli, i + 1, task)
      const deadline = Date.now() + 20000
      while (!events.some(e => e.id === i + 1 && e.done)) {
        if (Date.now() > deadline) throw new Error(`manifest ${path}: timeout`)
        await Bun.sleep(10)
      }
      const done = events.find(e => e.id === i + 1 && e.done)!
      if (done.err) throw new Error(done.err)
      expect(done.status).toBe('完成')
      expect(readFileSync(done.log).subarray(0, 4).toString('hex')).toBe('1a45dfa3')
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', done.log]))
      expect(probe.format.format_name).toContain('matroska')
      expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video'])
      expect(Number(probe.format.duration)).toBeGreaterThan(2.8)
    }
  } finally {
    await hub.cancelAll()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
