import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iqcnAudios, selectIQCNAudios, prepareIQCNAudio, downloadIQCNAudio } from './iqcn-audio.ts'
import type { GwClient } from './client.ts'

// Same shape as the failing episode: six AIDs represent three user choices.
const duplicateCatalog = [
  { aid: 'aac-dash', name: '普通话', language_id: 1, ct: 5, bid: 300, cf: 'aac', ff: 'dash', aat: 0, amt: 0, selected: true, has_independent_files: true },
  { aid: 'dolby-amp4', name: '普通话', language_id: 1, ct: 2, bid: 500, cf: 'dolby', ff: 'amp4', aat: 0, amt: 0 },
  { aid: 'standard-dash', name: '普通话', language_id: 1, ct: 1, bid: 100, cf: 'aac', ff: 'dash', aat: 0, amt: 0 },
  { aid: 'standard-amp4', name: '普通话', language_id: 1, ct: 1, bid: 100, cf: 'aac', ff: 'amp4', aat: 0, amt: 0 },
  { aid: 'dolby-dash', name: '普通话', language_id: 1, ct: 2, bid: 500, cf: 'dolby', ff: 'dash', aat: 0, amt: 0 },
  { aid: 'aac-amp4', name: '普通话', language_id: 1, ct: 5, bid: 300, cf: 'aac', ff: 'amp4', aat: 0, amt: 0 },
]

test('DASH and AMP4 become three unique choices without transport labels', () => {
  const rows = iqcnAudios({ audios: duplicateCatalog })
  expect(rows).toHaveLength(3)
  expect(new Set(rows.map(row => row.id)).size).toBe(3)
  expect(rows.map(row => row.vid)).toEqual(['aac-dash', 'dolby-dash', 'standard-dash'])
  expect(rows.filter(row => row.isDefault || row.selected)).toHaveLength(1)
  expect(rows.map(row => row.label).join(' ')).not.toMatch(/DASH|AMP4/i)
  const reversed = iqcnAudios({ audios: [...duplicateCatalog].reverse() })
  for (const row of rows) expect(reversed.find(candidate => candidate.id === row.id)?.vid).toBe(row.vid)
})

test('old duplicate selections bind once to current episode sources and keep one Dolby default', () => {
  const requested = duplicateCatalog.map(row => ({ id: `iqcn:${row.language_id}:${row.ct}:${row.bid}:${row.cf}`, isDefault: row.cf === 'dolby' }))
  const rows = selectIQCNAudios({ audios: duplicateCatalog.map(row => ({ ...row, aid: `next-${row.aid}` })) }, requested)
  expect(rows).toHaveLength(3)
  expect(rows.map(row => row.vid)).toEqual(['next-aac-dash', 'next-dolby-dash', 'next-standard-dash'])
  expect(rows.filter(row => row.isDefault).map(row => row.codec)).toEqual(['DOLBY'])
})

test('available independent files outrank transport preference without deleting AMP4-only tracks', () => {
  const rows = iqcnAudios({ audios: [duplicateCatalog[4], { ...duplicateCatalog[1], has_independent_files: true, selected: true }] })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.vid).toBe('dolby-amp4')
  expect(iqcnAudios({ audios: [duplicateCatalog[1]] })[0]!.vid).toBe('dolby-amp4')
})

test('different languages, qualities and channel/content types are not collapsed', () => {
  const base = duplicateCatalog[0]!
  const audios = [base, { ...base, aid: 'other-language', language_id: 2 }, { ...base, aid: 'other-bitrate', bid: 400 }, { ...base, aid: 'other-channel', amt: 1 }, { ...base, aid: 'description', aat: 1 }]
  expect(iqcnAudios({ audios })).toHaveLength(5)
  const ambiguous = { audios: [{ ...base, amt: 1 }, { ...base, aid: 'second', amt: 2 }] }
  expect(() => selectIQCNAudios(ambiguous, [{ id: 'iqcn:1:5:300:aac' }])).toThrow('多个不同版本')
  expect(() => selectIQCNAudios({ audios: duplicateCatalog }, [{ id: 'iqcn:2:5:300:aac' }])).toThrow('暂不提供')
})

test('prepared descriptors are reused and cannot cross plans or audio identities', async () => {
  let calls = 0
  const cli = { invoke: async () => { calls++; return { transport: 'local-audio-v1', audioId: 'selected', name: '普通话', codec: 'aac', language_id: 1, embedded: true } } } as unknown as GwClient
  const plan = await prepareIQCNAudio(cli, 'plan', 'selected')
  let extracted = 0
  await downloadIQCNAudio(cli, 'plan', 'selected', 'unused', 1, undefined, undefined, async () => { extracted++ }, plan)
  expect(calls).toBe(1)
  expect(extracted).toBe(1)
  await expect(downloadIQCNAudio(cli, 'other-plan', 'selected', 'unused', 1, undefined, undefined, async () => {}, plan)).rejects.toThrow('音轨已变更')
})

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
