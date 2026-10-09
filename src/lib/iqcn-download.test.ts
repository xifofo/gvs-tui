import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { downloadIQCN } from './iqcn.ts'
import { ensureFFmpeg } from './tools.ts'
import type { GwClient } from './client.ts'
import type { DlTask } from './jobs.ts'

test('domestic job publishes only after every segment is restored and decoded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-iqcn-download-'))
  const ffmpeg = await ensureFFmpeg()
  const source = join(dir, 'source.ts')
  const generated = spawnSync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', source], { windowsHide: true, timeout: 30000 })
  expect(generated.status).toBe(0)
  const audioSources = ['aac', 'eac3'].map((codec, index) => {
    const path = join(dir, `independent-${index}.m4a`)
    const result = spawnSync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${600 + index * 500}:sample_rate=48000`, '-t', '2', '-c:a', codec, '-f', 'mp4', path], { windowsHide: true, timeout: 30000 })
    expect(result.status).toBe(0)
    const data = readFileSync(path), split = Math.floor(data.length / 2)
    return [gzipSync(data.subarray(0, split)), data.subarray(split)]
  })
  const audioCatalog = [
    { aid: 'current-aac', name: '普通话', cf: 'aac', ct: 5, bid: 300, language_id: 1, selected: true, has_independent_files: true },
    { aid: 'current-dolby', name: '普通话', cf: 'dolby', ct: 2, bid: 500, language_id: 1 },
    { aid: 'current-standard', name: '普通话', cf: 'aac', ct: 1, bid: 100, language_id: 1 },
  ]
  const requestedAudios: string[] = []
  const bytes = readFileSync(source), split = Math.floor(bytes.length / 188 / 2) * 188
  const parts = [bytes.subarray(0, split), bytes.subarray(split)]
  let restored = 0, released = false
  const cli = { invoke: async (_p: string, action: string, input: Record<string, unknown>) => {
    if (action === 'streams') {
      expect(input.transport).toBe('local-v1')
      return { planId: 'fixture-plan', transport: 'local-v1', localProcessing: { version: 1, ticket: 'fixture', identity: 'fixture' }, video: { segments: parts.map(p => ({ contentlength: p.length })) }, audios: audioCatalog, subtitles: [{ index: 0, language_id: 1, formats: ['srt'] }] }
    }
    if (action === 'audio') {
      const track = audioCatalog.findIndex(a => a.aid === input.audioId)
      expect(track).toBeGreaterThanOrEqual(0)
      requestedAudios.push(String(input.audioId))
      if (track === 2) return { transport: 'local-audio-v1', audioId: input.audioId, embedded: true, language_id: 1, name: '普通话', codec: 'aac' }
      return { transport: 'local-audio-v1', audioId: input.audioId, language_id: 1, name: '普通话', codec: audioCatalog[track]!.cf,
        parts: [0, 1].map(index => ({ index, dispatch: `https://data.video.ptqy.gitv.tv/videos/v0/${track}-${index}.amp4` })) }
    }
    if (action === 'download-finish') { released = true; return {} }
    if (action === 'download-subtitle') {
      const text = Buffer.from('1\n00:00:00,000 --> 00:00:01,500\n验收字幕\n')
      return { index: 0, format: 'srt', bytes: text.length, data: text.toString('base64') }
    }
    expect(action).toBe('download-segment')
    expect(input.index).toBe(restored++)
    const part = parts[Number(input.index)]!
    return { transport: 'local-v1', index: input.index, bytes: part.length, urls: [`https://fixture.ptqy.gitv.tv/${input.index}`] }
  } } as unknown as GwClient
  const task = { vid: '123', quality: '600|100|25', audioTracks: [
    { id: 'iqcn:1:5:300:aac', vid: 'previous-episode-aac', label: '普通话 AAC', isDefault: false },
    { id: 'iqcn:1:2:500:dolby', vid: 'previous-episode-dolby', label: '普通话 DOLBY', isDefault: true },
    { id: 'iqcn:1:1:100:aac', vid: 'previous-episode-standard', label: '普通话 标准', isDefault: false },
  ] } as DlTask
  const dest = join(dir, 'result.mkv')
  await downloadIQCN(cli, task, dest, join(dir, 'work'), () => {}, undefined, {
    fetch: async url => {
      const parsed = new URL(url)
      if (parsed.hostname === 'data.video.ptqy.gitv.tv') return Response.json({ e: '0', l: `https://audio.ptqy.gitv.tv${parsed.pathname}` })
      if (parsed.hostname === 'audio.ptqy.gitv.tv') {
        const [, track, part] = /\/(\d)-(\d).amp4$/.exec(parsed.pathname)!
        if (part === '0') await Bun.sleep(20)
        return new Response(audioSources[Number(track)]![Number(part)]!)
      }
      const index = Number(new URL(url).pathname.slice(1))
      // A later segment finishes first; the assembled video must stay ordered.
      if (index === 0) await Bun.sleep(30)
      return new Response(parts[index]!)
    },
    restore: async (source, destination) => {
      copyFileSync(source, destination)
      return { version: 1, bytes: readFileSync(source).length, restored: false, clearCandidate: true }
    },
  }, 8)
  expect(restored).toBe(2)
  expect(released).toBe(true)
  expect(existsSync(dest)).toBe(true)
  expect(requestedAudios).toEqual(['current-aac', 'current-dolby', 'current-standard'])
  const metadata = spawnSync(ffmpeg, ['-hide_banner', '-i', dest], { windowsHide: true, timeout: 30000 }).stderr.toString()
  const audioLines = metadata.split('\n').filter(line => /Stream #.*Audio:/.test(line))
  expect(audioLines).toHaveLength(3)
  expect(audioLines[0]).toContain('aac')
  expect(audioLines[0]).not.toContain('(default)')
  expect(audioLines[1]).toContain('eac3')
  expect(audioLines[1]).toContain('(default)')
  expect(audioLines[2]).toContain('aac')
  expect(audioLines[2]).not.toContain('(default)')
  expect(metadata).toContain('普通话 · DOLBY')
  const decoded = spawnSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', dest, '-map', '0:v', '-map', '0:a', '-f', 'null', '-'], { windowsHide: true, timeout: 30000 })
  expect(decoded.status).toBe(0)
  expect(decoded.stderr.toString().trim()).toBe('')
  const subtitle = spawnSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', dest, '-map', '0:s:0', '-f', 'srt', '-'], { windowsHide: true, timeout: 30000 })
  expect(subtitle.status).toBe(0)
  expect(subtitle.stdout.toString()).toContain('验收字幕')
}, 60000)

test('failed restoration preserves an existing output and releases the private plan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-iqcn-failed-')), dest = join(dir, 'existing.mkv')
  writeFileSync(dest, 'original-output')
  let released = false
  const cli = { invoke: async (_p: string, action: string) => {
    if (action === 'streams') return { planId: 'fixture-plan', transport: 'local-v1', localProcessing: { version: 1, ticket: 'fixture', identity: 'fixture' }, video: { segments: [{ contentlength: 188 }] } }
    if (action === 'download-finish') { released = true; return {} }
    return { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/0'] }
  } } as unknown as GwClient
  await expect(downloadIQCN(cli, { vid: '123', quality: '600|100|25' } as DlTask, dest, join(dir, 'work'), () => {}, undefined, {
    fetch: async () => new Response(Buffer.alloc(188)),
    restore: async () => { throw new Error('本地还原失败') },
  })).rejects.toThrow('还原')
  expect(readFileSync(dest, 'utf8')).toBe('original-output')
  expect(released).toBe(true)
  expect(existsSync(dest + '.iqcn-part')).toBe(false)
})
