import { expect, test } from 'bun:test'
import { youkuPlayInput } from './youku-play-input'
import { probeOptions } from './quality'
import { youkuVideoPlaylist } from './media'
import { defaultConfig } from './config'
import type { GwClient } from './client'

test('frame HDR10 selected from the probe remains available to the download request', async () => {
  const hdr = { stream_type: 'cmfv5hd4_hdr_hfr_hbr_hq', source: 'frame_xiang', media_type: 'video', playlist_url: 'https://example.com/hdr.m3u8', height: 2160 }
  const dv = { ...hdr, stream_type: 'cmfv5hd4_dolbyvision_hfr_hbr_hq', playlist_url: 'https://example.com/dv.m3u8' }
  const calls: Record<string, unknown>[] = []
  const cli = { extra: () => ({}), invoke: async (_p: string, _a: string, input: Record<string, unknown>) => {
    calls.push(input)
    return { can_play: true, streams: input.tier === 'multi' ? [dv, hdr] : input.lane === 'frame_xiang' && input.profile === 'hdr10' ? [hdr] : [dv] }
  } } as unknown as GwClient
  const options = await probeOptions(cli, defaultConfig(), 'youku', 'episode-2')
  const selected = options.qualities.find(q => q.id === `${hdr.stream_type}|frame_xiang`)!
  expect(selected).toBeDefined()
  const input = youkuPlayInput('episode-2', selected.id)
  const data = await cli.invoke('youku', 'play', input)
  expect(youkuVideoPlaylist(data, selected.id)).toBe(hdr.playlist_url)
  expect(calls[1]!.tier).toBe('single')
  expect(calls[1]!.lane).toBe('frame_xiang')
  expect(calls[1]!.profile).toBe('hdr10')
})

test('TV and App selections stay pinned and never substitute another lane', () => {
  for (const lane of ['tv', 'app']) {
    expect(youkuPlayInput('episode-3', `mp5hd3|${lane}`)).toEqual({ vid:'episode-3', expand:'0', tier:'single', lane, lanes:'0', nocache:'1' })
    const data = { streams: [
      { stream_type:'mp5hd3', source:'frame_xiang', playlist_url:'https://example.com/wrong.m3u8' },
      { stream_type:'mp5hd3', source:lane, playlist_url:'https://example.com/right.m3u8' },
    ] }
    expect(youkuVideoPlaylist(data, `mp5hd3|${lane}`)).toBe('https://example.com/right.m3u8')
    expect(() => youkuVideoPlaylist({ streams: data.streams.slice(0, 1) }, `mp5hd3|${lane}`)).toThrow('所选来源端')
  }
})

test('legacy frame selections pin the same profile while unspecified selections keep auto mode', () => {
  expect(youkuPlayInput('episode-1', 'cmfv5hd4_hdr_hfr_hbr_hq')).toMatchObject({tier:'single', lane:'frame_xiang', profile:'hdr10'})
  expect(youkuPlayInput('episode-1').tier).toBe('single')
})

for (const [stream, profile] of [
  ['cmfv5hd4_dolbyvision_hfr_hbr_hq', undefined],
  ['cmfv5hd4_hdr_hfr_hbr_hq', 'hdr10'],
  ['cmfv5hd4_sdr_hfr_hbr_bit10_hq', 'sdr'],
  ['cmfv5hd4_hdrvivid_hfr_hq', 'vivid'],
] as const) {
  test(`selected frame ${stream} pins its own response`, () => {
    expect(youkuPlayInput('ep06', `${stream}|frame_xiang`)).toMatchObject({ tier:'single', lane:'frame_xiang', lanes:'0' })
    const actualProfile = youkuPlayInput('ep06', `${stream}|frame_xiang`).profile
    if (profile === undefined) expect(actualProfile).toBeUndefined()
    else expect(actualProfile).toBe(profile)
  })
}

test('a missing selected DV rendition cannot fall back to a smaller SDR video', () => {
  const data = { video: { stream_type:'mp5hd3', playlist_url:'https://example.com/sdr.m3u8' }, streams: [
    { stream_type:'mp5hd3', media_type:'video', playlist_url:'https://example.com/sdr.m3u8' },
  ] }
  expect(() => youkuVideoPlaylist(data, 'cmfv5hd4_dolbyvision_hfr_hbr_hq')).toThrow('所选档位')
  expect(() => youkuVideoPlaylist(data, 'cmfv5hd4_dolbyvision_hfr_hbr_hq|frame_xiang')).toThrow('所选来源端')
})

test('legacy gateways can bind an exact selected primary video but cannot invent its stream identity', () => {
  const primary = { stream_type:'cmfv5hd4_dolbyvision_hfr_hbr_hq', playlist_url:'https://example.com/dv.m3u8' }
  expect(youkuVideoPlaylist({ lane:'frame_xiang', video:primary }, `${primary.stream_type}|frame_xiang`)).toBe(primary.playlist_url)
  expect(() => youkuVideoPlaylist({ video:{playlist_url:primary.playlist_url} }, primary.stream_type)).toThrow('所选档位')
  expect(() => youkuVideoPlaylist({ lane:'tv', video:primary }, `${primary.stream_type}|frame_xiang`)).toThrow('所选来源端')
})

test('a DV inventory row cannot borrow the App primary response audio and keys', () => {
  const quality = 'cmfv5hd4_dolbyvision_hfr_hbr_hq|frame_xiang'
  const data = { lane:'app', video:{stream_type:'mp5hd3',playlist_url:'https://example.com/app.m3u8'},
    streams:[{stream_type:quality.split('|')[0],source:'frame_xiang',playlist_url:'https://example.com/dv.m3u8'}],
    audio_tracks:[{stream_type:'cmfa1hd3',playlist_url:'https://example.com/app-aac.m3u8'}] }
  expect(() => youkuVideoPlaylist(data, quality)).toThrow('主响应不一致')
})

// 网关 v3.9.119 起帧享一次给两档帧率：60fps（*_hfr_*）与 25/24 帧母版（无 _hfr_）。
// UPS 的 max_fps 是硬上限，选中 25 帧那一行时必须显式给 dovi=dv25/hdr10_25/…，
// 否则 profile 的 max_fps=60/120 会把请求拉回 60fps 档，下载端按 stream_type 匹配就会找不到。
for (const [stream, preset] of [
  ['cmfv5hd4_dolbyvision_hbr_hq', 'dv25'],
  ['cmfv5hd4_dolbyvision_hfr_hbr_hq', 'dv60'],
  ['cmfv5hd4_hdr_hbr_hq', 'hdr10_25'],
  ['cmfv5hd4_hdr_hfr_hbr_hq', 'hdr10_60'],
  ['cmfv5hd4_sdr_hbr_bit10_hq', 'sdr25'],
  ['cmfv5hd4_sdr_hfr_hbr_bit10_hq', 'sdr60'],
  ['cmfv5hd4_imaxenhanced_hbr_hq', 'imax25'],
  ['cmfv5hd4_imaxenhanced_hfr_hbr_hq', 'imax60'],
] as const) {
  test(`frame selection ${stream} pins ${preset}`, () => {
    expect(youkuPlayInput('ep07', `${stream}|frame_xiang`)).toMatchObject({ tier: 'single', lane: 'frame_xiang', lanes: '0', dovi: preset })
  })
}

test('TV / App selections do not pin a frame-x client preference', () => {
  for (const lane of ['tv', 'app']) {
    expect(youkuPlayInput('ep08', `hls5hd4_hdr_hfr_hbr|${lane}`).dovi).toBeUndefined()
    expect(youkuPlayInput('ep08', `mp5hd3|${lane}`).dovi).toBeUndefined()
  }
})

test('the quality probe asks for both frame-rate ladders explicitly', async () => {
  const calls: Record<string, unknown>[] = []
  const row = { stream_type: 'cmfv5hd4_dolbyvision_hbr_hq', source: 'frame_xiang', media_type: 'video', playlist_url: 'https://example.com/dv25.m3u8', height: 2160, fps: 24 }
  const cli = { extra: () => ({}), invoke: async (_p: string, _a: string, input: Record<string, unknown>) => {
    calls.push(input)
    return { can_play: true, streams: [row] }
  } } as unknown as GwClient
  const options = await probeOptions(cli, defaultConfig(), 'youku', 'episode-9')
  expect(calls[0]).toMatchObject({ tier: 'multi', fps: 'all' })
  expect(options.qualities.map(q => q.id)).toContain(`${row.stream_type}|frame_xiang`)
})

// 60fps 与 25 帧母版同分辨率同 HDR 偏好时，label 会撞名；撞名时补帧率，避免列表里两行一模一样。
test('same-resolution frame-rate variants get distinct labels', async () => {
  const base = { source: 'frame_xiang', media_type: 'video', height: 2160, width: 3840 }
  const hfr = { ...base, stream_type: 'cmfv5hd4_dolbyvision_hfr_hbr_hq', playlist_url: 'https://example.com/dv60.m3u8', fps: 60 }
  const hbr = { ...base, stream_type: 'cmfv5hd4_dolbyvision_hbr_hq', playlist_url: 'https://example.com/dv24.m3u8', fps: 24 }
  const cli = { extra: () => ({}), invoke: async () => ({ can_play: true, streams: [hfr, hbr] }) } as unknown as GwClient
  const options = await probeOptions(cli, defaultConfig(), 'youku', 'episode-10')
  const dv60 = options.qualities.find(q => q.id === `${hfr.stream_type}|frame_xiang`)!
  const dv24 = options.qualities.find(q => q.id === `${hbr.stream_type}|frame_xiang`)!
  expect(dv60.label).not.toBe(dv24.label)
  expect(dv60.label).toContain('60帧')
  expect(dv24.label).toContain('24帧')
})
