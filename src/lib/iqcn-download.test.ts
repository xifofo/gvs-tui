import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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
  const bytes = readFileSync(source), split = Math.floor(bytes.length / 188 / 2) * 188
  const parts = [bytes.subarray(0, split), bytes.subarray(split)]
  let restored = 0, released = false
  const cli = { invoke: async (_p: string, action: string, input: Record<string, unknown>) => {
    if (action === 'streams') {
      expect(input.transport).toBe('local-v1')
      return { planId: 'fixture-plan', transport: 'local-v1', localProcessing: { version: 1, ticket: 'fixture', identity: 'fixture' }, video: { segments: parts.map(p => ({ contentlength: p.length })) }, subtitles: [{ index: 0, language_id: 1, formats: ['srt'] }] }
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
  const task = { vid: '123', quality: '600|100|25' } as DlTask
  const dest = join(dir, 'result.mkv')
  await downloadIQCN(cli, task, dest, join(dir, 'work'), () => {}, undefined, {
    fetch: async url => new Response(parts[Number(new URL(url).pathname.slice(1))]!),
    restore: async (source, destination) => {
      copyFileSync(source, destination)
      return { version: 1, bytes: readFileSync(source).length, restored: false, clearCandidate: true }
    },
  })
  expect(restored).toBe(2)
  expect(released).toBe(true)
  expect(existsSync(dest)).toBe(true)
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
