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
    return { can_play: true, streams: input.tier === 'multi' && !input.lane ? [dv, hdr] : [dv] }
  } } as unknown as GwClient
  const options = await probeOptions(cli, defaultConfig(), 'youku', 'episode-2')
  const selected = options.qualities.find(q => q.id === `${hdr.stream_type}|frame_xiang`)!
  expect(selected).toBeDefined()
  const input = youkuPlayInput('episode-2', selected.id)
  const data = await cli.invoke('youku', 'play', input)
  expect(youkuVideoPlaylist(data, selected.id)).toBe(hdr.playlist_url)
  expect(calls[1]!.tier).toBe('multi')
  expect(calls[1]!.lane).toBeUndefined()
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

test('legacy selections keep the complete multi-tier catalog', () => {
  expect(youkuPlayInput('episode-1', 'cmfv5hd4_hdr_hfr_hbr_hq').tier).toBe('multi')
  expect(youkuPlayInput('episode-1').tier).toBe('single')
})
