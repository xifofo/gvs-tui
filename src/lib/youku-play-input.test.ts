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
