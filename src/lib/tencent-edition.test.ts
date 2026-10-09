import { expect, test } from 'bun:test'
import { parseEpisodes } from './episodes.ts'
import { moviePlayables, probeOptions, tencentCatalogProbeInput } from './quality.ts'
import { selectedTencentQuality, tencentSelectedPlayInput } from './tencent-quality-selection.ts'
import { tencentPlayInput } from './tencent-qr.ts'
import { tencentEpisodePlayParams } from './tencent-edition.ts'
import type { GwClient } from './client.ts'
import type { FileConfig } from './config.ts'

const cid = 'mzc00200b7ftiew'
const detail = { title: '飞驰人生3（IMAX）', edition: 'imax', cid, kind: 'movie', episodes: [
  { vid: 'q4102hyb9yc', title: '国语', duration: 7550, edition: 'imax', play_params: { vid: 'q4102hyb9yc', cid, edition: 'imax', defn: 'imax', session_type: 'tv', cookie: 'must-not-persist', encode: 'all' } },
  { vid: 'a1234567890', title: '另一版本', duration: 7550 },
] }
const cfg = { tencentMode: 'web', tencentEncodeAll: true, tencentProbeSource: true, tencentCaptionAll: false } as FileConfig

test('IMAX detail survives episode/movie mapping, IPC and a queued download without ordinary encoding presets', async () => {
  const parsed = parseEpisodes(detail)
  const episodes = JSON.parse(JSON.stringify(moviePlayables(detail))) as typeof parsed
  expect(episodes.map(e => e.vid)).toEqual(['q4102hyb9yc', 'a1234567890'])
  expect(episodes[0].tencentPlayParams).toEqual({ edition: 'imax', defn: 'imax', session_type: 'tv', cid })
  expect(episodes[1].tencentPlayParams).toEqual(episodes[0].tencentPlayParams)
  const calls: Record<string, unknown>[] = []
  const cli = { extra: () => ({}), invoke: async (_provider: string, action: string, input: Record<string, unknown>) => {
    expect(action).toBe('play'); calls.push(input)
    return { has_url: true, edition: 'imax', formats: [
      { name: 'imax', id: '320311', width: 3840, height: 2160 },
      { name: 'fhd', id: '3', width: 1920, height: 1080 },
    ] }
  } } as unknown as GwClient
  const options = await probeOptions(cli, cfg, 'tencent', episodes[0].vid, { tencentPlayParams: episodes[0].tencentPlayParams })
  expect(calls).toEqual([{ vid: 'q4102hyb9yc', caption: 'soft', edition: 'imax', defn: 'imax', session_type: 'tv', cid }])
  expect(options.qualities.map(q => q.stream)).toEqual(['imax'])
  const quality = options.qualities[0]
  const task = JSON.parse(JSON.stringify({ vid: episodes[0].vid, quality: quality.stream, tencentPlayParams: episodes[0].tencentPlayParams, tencentQuality: selectedTencentQuality(quality) }))
  const downloadInput = { vid: task.vid, ...tencentPlayInput(cfg, task.tencentPlayParams), ...tencentSelectedPlayInput(task) }
  expect(downloadInput).toMatchObject({ vid: 'q4102hyb9yc', defn: 'imax', edition: 'imax', session_type: 'tv', cid, format_id: '320311' })
  expect(downloadInput).not.toHaveProperty('encode')
  expect(downloadInput).not.toHaveProperty('rendition_persona')
})

test('ordinary episodes retain existing preferences; edition requests are never inferred from title alone', () => {
  expect(tencentEpisodePlayParams({ title: 'IMAX documentary' })).toBeUndefined()
  expect(tencentCatalogProbeInput(cfg, 'ordinary')).toEqual({ vid: 'ordinary', caption: 'soft', session_type: 'web', tier: 'h5', encode: 'all', source: '1' })
  expect(tencentSelectedPlayInput({ quality: 'imax', persona: 'h264_soft', group: 'encode' })).toEqual({ defn: 'imax', edition: 'imax', session_type: 'tv' })
})

test('IMAX unavailable response has an actionable error and never offers an ordinary format', async () => {
  const cli = { extra: () => ({}), invoke: async () => ({ has_url: false, msg: 'SUCCESS', formats: [{ name: 'fhd' }] }) } as unknown as GwClient
  await expect(probeOptions(cli, cfg, 'tencent', 'q4102hyb9yc', { tencentPlayParams: parseEpisodes(detail)[0].tencentPlayParams })).rejects.toThrow('IMAX 片源暂未返回可用画质')
})
