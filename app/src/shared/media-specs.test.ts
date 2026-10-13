import { expect, test } from 'bun:test'
import { audioChannels, audioCodec, hdrKind, resolutionTier, videoCodec } from './media-specs'
import { episodeKey, episodeStates, stateOf } from './episode-status'

test('media: resolution tiers', () => {
    expect(resolutionTier(2160, 3840)).toBe('4K')
    expect(resolutionTier(1600, 3840)).toBe('4K')
    expect(resolutionTier(1440)).toBe('2K')
    expect(resolutionTier(1080)).toBe('1080P')
    expect(resolutionTier(720)).toBe('720P')
    expect(resolutionTier(360)).toBe('360P')
    expect(resolutionTier(0)).toBe('—')
  })
test('media: video codec and hdr', () => {
    expect(videoCodec('1080p|bytevc1|')).toBe('H.265')
    expect(videoCodec('avc1.640028')).toBe('H.264')
    expect(videoCodec('', 'av01')).toBe('AV1')
    expect(videoCodec('mp4')).toBe('')
    expect(hdrKind('dolbyvision_4k')).toBe('杜比视界')
    expect(hdrKind('hdr10')).toBe('HDR10')
    expect(hdrKind('4K HDR Vivid')).toBe('HDR Vivid')
    expect(hdrKind('sdr')).toBe('')
    expect(hdrKind('dvd')).toBe('')
  })
test('media: audio codec and channels', () => {
    expect(audioCodec('杜比全景声')).toBe('Dolby Atmos')
    expect(audioCodec('ec-3')).toBe('E-AC-3')
    expect(audioCodec('ac-3')).toBe('AC-3')
    expect(audioCodec('DTS-HD MA')).toBe('DTS-HD')
    expect(audioCodec('mp4a.40.2')).toBe('AAC')
    expect(audioChannels('杜比 5.1')).toBe('5.1')
    expect(audioChannels('7.1ch')).toBe('7.1')
    expect(audioChannels('Atmos')).toBe('全景声')
    expect(audioChannels('立体声')).toBe('2.0')
    expect(audioChannels('mp4a.40.2')).toBe('')
})

const jobs = [
    { groupId: 'tencent:show1:1', label: 'S01E01', state: 'failed' as const },
    { groupId: 'tencent:show1:2', label: 'S01E01', state: 'done' as const },
    { groupId: 'tencent:show1:2', label: 'S01E02', state: 'queued' as const },
    { groupId: 'tencent:show10:2', label: 'S01E03', state: 'done' as const },
    { groupId: 'youku:show1:2', label: 'S01E03', state: 'done' as const },
    { groupId: 'tencent:movie:3', label: '正片', state: 'running' as const },
  ]
test('episode status: maps jobs to episodes of the same show only, best state wins', () => {
    const s = episodeStates(jobs, 'tencent', 'show1')
    expect(stateOf(s, { number: 1 })).toBe('done')
    expect(stateOf(s, { number: 2, season: 1 })).toBe('queued')
    expect(stateOf(s, { number: 3 })).toBeUndefined()
    expect(episodeKey(12, 2)).toBe('S02E12')
    const renamed = episodeStates([{ groupId: 'iq:s:1', vid: 'v5', label: 'S02E05', state: 'running' }], 'iq', 's')
    expect(stateOf(renamed, { vid: 'v5', number: 5, season: 1 })).toBe('running')
    expect(stateOf(renamed, { number: 50 })).toBeUndefined()
  })
test('episode status: movies match by edition title', () => {
    const s = episodeStates(jobs, 'tencent', 'movie')
    expect(stateOf(s, { number: 1, title: '' }, true)).toBe('running')
})
