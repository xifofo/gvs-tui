import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobHub, type DlTask, type JobEvt } from './jobs.ts'
import { lookPackager, lookBundledFFmpeg } from './tools.ts'
import type { FileConfig } from './config.ts'
import type { GwClient } from './client.ts'

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip

// A real encrypted DASH fixture exercises separate video/audio KIDs, an expired
// manifest URL, native decryption, muxing and decode verification through JobHub.
mediaTest('Hami and Friday protected jobs decrypt separate KIDs and publish playable MKV', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-protected-manifest-'))
  const ffmpeg = lookBundledFFmpeg(), packager = lookPackager()
  const run = (bin: string, args: string[]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 30000 })
    if (result.status !== 0) throw new Error(`${bin}: ${result.error ?? result.stderr}`)
    return result.stdout
  }
  const video = { kid: '00000000000000000000000000000001', key: '11111111111111111111111111111111' }
  const audio = { kid: '00000000000000000000000000000002', key: '22222222222222222222222222222222' }
  const requested: string[] = []
  const server = createServer((req, res) => {
    requested.push(req.url || '')
    if (req.headers['x-fixture-key'] !== 'fixture' || req.url?.startsWith('/manifest.mpd')) { res.writeHead(403).end(); return }
    try {
      const file = readFileSync(join(root, new URL(req.url || '/', 'http://localhost').pathname))
      res.writeHead(200, { 'Content-Length': String(file.length) }).end(file)
    } catch { res.writeHead(404).end() }
  })
  const events: JobEvt[] = []
  const hub = new JobHub(e => events.push(e))
  try {
    run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '10', '-c:a', 'aac', 'source.mp4'])
    run(packager, ['in=source.mp4,stream=video,init_segment=video-init.mp4,segment_template=video-$Number$.m4s,drm_label=VIDEO',
      'in=source.mp4,stream=audio,init_segment=audio-init.mp4,segment_template=audio-$Number$.m4s,drm_label=AUDIO',
      '--enable_raw_key_encryption', '--keys', `label=VIDEO:key_id=${video.kid}:key=${video.key},label=AUDIO:key_id=${audio.kid}:key=${audio.key}`,
      '--protection_scheme', 'cenc', '--protection_systems', 'Widevine', '--generate_static_live_mpd', '--segment_duration', '1', '--mpd_output', 'manifest.mpd'])
    // These providers declare resolution on Representation. RE currently omits
    // inherited AdaptationSet dimensions when applying its resolution filter.
    const manifest = readFileSync(join(root, 'manifest.mpd'), 'utf8')
      .replace('<Representation id="0"', '<Representation width="160" height="90" id="0"')
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const cfg = { outDir: join(root, 'output'), tmpDir: join(root, 'work'), threads: 2, releaseGroup: 'TEST' } as FileConfig
    for (const [i, provider] of ['hamivideo', 'friday'].entries()) {
      const cli = { invoke: async (p: string, action: string, input: Record<string, unknown>) => {
        expect(p).toBe(provider); expect(action).toBe('resolve'); expect(input.download).toBe(true)
        return { manifest, media: [{ type: 'video', url: `${base}/manifest.mpd?expired=true`, format: 'dash', height: 90,
          drm: { system: 'widevine', clear: false, contentKeys: [video, audio] }, headers: { 'X-Fixture-Key': 'fixture' } }] }
      } } as unknown as GwClient
      const task: DlTask = { provider, title: 'Fixture', series: 'Fixture', vid: 'fixture', quality: 'auto', season: 1, episode: i + 1, height: 90, codec: 'H264', group: 'TEST', tmdbId: 0, nameDots: '', year: 2026, plot: '' }
      hub.enqueue(cfg, cli, i + 1, task)
      const deadline = Date.now() + 45000
      while (!events.some(e => e.id === i + 1 && e.done)) {
        if (Date.now() > deadline) throw new Error(`${provider}: timeout`)
        await Bun.sleep(20)
      }
      const done = events.find(e => e.id === i + 1 && e.done)!
      if (done.err) {
        const logs = readdirSync(root, { recursive: true }).filter(path => String(path).endsWith('.download-error.log'))
          .map(path => readFileSync(join(root, String(path)), 'utf8')).join('\n')
        throw new Error(`${done.err}\n${logs}`)
      }
      expect(done.status).toBe('完成')
      expect(readFileSync(done.log).subarray(0, 4).toString('hex')).toBe('1a45dfa3')
      run(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-i', done.log, '-map', '0:v', '-map', '0:a', '-f', 'null', '-'])
    }
    expect(requested.some(path => path.startsWith('/manifest.mpd'))).toBe(false)
    expect(requested.some(path => path.startsWith('/video-'))).toBe(true)
    expect(requested.some(path => path.startsWith('/audio-'))).toBe(true)
    expect(readdirSync(root, { recursive: true }).some(path => String(path).endsWith('content-keys.txt'))).toBe(false)
    expect(JSON.stringify(events)).not.toContain(video.key)
    expect(JSON.stringify(events)).not.toContain(audio.key)
  } finally {
    await hub.cancelAll()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
}, 100000)
