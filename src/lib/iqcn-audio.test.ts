import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iqcnAudios, downloadIQCNAudio } from './iqcn-audio.ts'
import type { GwClient } from './client.ts'

test('audio catalog retains codecs and one source default with stable episode selectors', () => {
  const audios = [
    { aid: 'a', name: '普通话', language_id: 1, ct: 1, bid: 100, cf: 'aac' },
    { aid: 'b', name: '普通话', language_id: 1, ct: 2, bid: 500, cf: 'dolby' },
    { aid: 'c', name: '普通话', language_id: 1, ct: 5, bid: 300, cf: 'aac', selected: true },
  ]
  const rows = iqcnAudios({ audios })
  expect(rows).toHaveLength(3)
  expect(rows.filter(a => a.selected).map(a => a.vid)).toEqual(['c'])
  expect(rows[1]!.label).toContain('DOLBY')
  expect(rows[2]!.label).toContain('高码率')
  expect(iqcnAudios({ audios: audios.map(a => ({ ...a, aid: a.aid + '-episode2' })) }).map(a => a.id)).toEqual(rows.map(a => a.id))
})

test('wrong audio identity never starts a CDN request', async () => {
  const cli = { invoke: async () => ({ transport: 'local-audio-v1', audioId: 'wrong', parts: [] }) } as unknown as GwClient
  let fetched = false
  await expect(downloadIQCNAudio(cli, 'plan', 'chosen', join(tmpdir(), 'unused-iq-audio'), 8, undefined, async () => { fetched = true; return new Response('') })).rejects.toThrow('所选音轨')
  expect(fetched).toBe(false)
})

test('dispatcher cannot redirect local audio download to another host or file', async () => {
  for (const target of ['https://example.com/videos/v0/a', 'https://audio.ptqy.gitv.tv/other']) {
    const dest = join(mkdtempSync(join(tmpdir(), 'iqcn-audio-reject-')), 'audio.m4a')
    const cli = { invoke: async () => ({ transport: 'local-audio-v1', audioId: 'chosen', parts: [{ index: 0, dispatch: 'https://data.video.ptqy.gitv.tv/videos/v0/a' }] }) } as unknown as GwClient
    let media = false
    await expect(downloadIQCNAudio(cli, 'plan', 'chosen', dest, 8, undefined, async url => {
      if (!url.startsWith('https://data.video.ptqy.gitv.tv/')) media = true
      return Response.json({ e: '0', l: target })
    })).rejects.toThrow('分段下载失败')
    expect(media).toBe(false)
    expect(existsSync(dest)).toBe(false)
  }
})
