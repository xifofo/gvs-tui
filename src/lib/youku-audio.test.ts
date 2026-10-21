import { expect, test } from 'bun:test'
import { orderedMuxAudios } from './audio-selection.ts'
import { resolveAudioLanguage } from './audio-language.ts'
import { mp4Lang, parseMp4Tracks, type Mp4Track } from './mp4box.ts'
import { youkuAudioLanguage, youkuMuxAudios } from './youku-audio.ts'

const track = (codec: string, channels?: number, language = 'zho'): Mp4Track => ({
  id: 1, type: 'soun', codec, channels, language, enabled: true,
  scale: 48000, movieScale: 1000, edits: [], name: '', duration: 48000,
})
const audios = [
  { path: 'dtsx.mp4', lang: 'zh', isDefault: true },
  { path: 'ddp.mp4', lang: 'zh', isDefault: false },
  { path: 'aac.mp4', lang: 'zh', isDefault: false },
]
const metadata = [[track('dtsx', 10)], [track('ec-3', 6)], [track('mp4a', 2)]]

test('actual ten-channel DTS:X yields the automatic default to selected DDP 5.1, retaining all tracks', () => {
  const output = youkuMuxAudios(audios, metadata)
  expect(orderedMuxAudios(output).map(a => [a.path, a.isDefault])).toEqual([
    ['ddp.mp4', true], ['dtsx.mp4', false], ['aac.mp4', false],
  ])
  expect(audios.map(a => a.isDefault)).toEqual([true, false, false])
  expect(output.every((a, i) => a !== audios[i])).toBe(true)
  expect(youkuMuxAudios(JSON.parse(JSON.stringify(audios)), metadata)).toEqual(output)
  expect(youkuMuxAudios(audios, [[track('dtsy', 10)], ...metadata.slice(1)])).toEqual(output)
})

test('manual DTS:X or AAC defaults survive serialization and actual-file inspection', () => {
  const saved = JSON.parse(JSON.stringify({ audios, manualAudioDefault: true }))
  expect(youkuMuxAudios(saved.audios, metadata, saved.manualAudioDefault)).toEqual(audios)
  const aacDefault = audios.map((a, i) => ({ ...a, isDefault: i === 2 }))
  expect(youkuMuxAudios(aacDefault, metadata)).toEqual(aacDefault)
})

test('ordinary DTS, six-channel DTS:X and unconfirmed specs retain the existing default', () => {
  for (const source of [track('dtsc', 10), track('dtsc', 6), track('dtsx', 6), track('dtsx')]) {
    expect(youkuMuxAudios(audios, [[source], ...metadata.slice(1)])).toEqual(audios)
  }
  for (const ddp of [track('ec-3'), track('ec-3', 2), track('ec-3', 8), track('ac-3', 6)]) {
    expect(youkuMuxAudios(audios, [metadata[0]!, [ddp], metadata[2]!])).toEqual(audios)
  }
  expect(youkuMuxAudios([audios[0]!, audios[2]!], [metadata[0]!, metadata[2]!]).map(a => a.isDefault)).toEqual([true, false])
  expect(youkuMuxAudios(audios, metadata.slice(0, 2))).toEqual(audios)
  expect(youkuMuxAudios(audios, [[track('dtsx', 10), track('mp4a', 2)], ...metadata.slice(1)])).toEqual(audios)
  expect(youkuMuxAudios([], [])).toEqual([])
})

test('a different-language DDP track cannot displace the chosen original language', () => {
  const dubbed = audios.map((a, i) => ({ ...a, lang: i === 1 ? 'en' : a.lang }))
  expect(youkuMuxAudios(dubbed, metadata)).toEqual(dubbed)
  const unspecified = audios.map(a => ({ ...a, lang: '原声' }))
  expect(youkuMuxAudios(unspecified, [[track('dtsx', 10, 'eng')], ...metadata.slice(1)])).toEqual(unspecified)
})

test('MP4 codec configuration distinguishes real DDP 5.1 from sample-entry stereo placeholders', () => {
  const xml = (codec: string, config: string, channels = 2) => `<MovieHeaderBox TimeScale="1000"/>
    <TrackBox><TrackHeaderBox TrackID="2" Flags="1"/><MediaHeaderBox TimeScale="48000" Duration="48000" LanguageCode="zho"/>
    <HandlerBox hdlrType="soun" Name=""/><SampleDescriptionBox>
    <AudioSampleDescriptionBox Type="${codec}" Channels="${channels}">${config}</AudioSampleDescriptionBox>
    </SampleDescriptionBox></TrackBox>`
  const dec3 = '<EC3StreamConfig acmod="7" lfon="1" num_sub_dep="0"/>'
  expect(parseMp4Tracks(xml('dtsx', '<UDTSSpecificBox Type="udts"/>', 10))[0]).toMatchObject({ codec: 'dtsx', channels: 10 })
  expect(parseMp4Tracks(xml('ec-3', dec3))[0]).toMatchObject({ codec: 'ec-3', channels: 6 })
  expect(parseMp4Tracks(xml('ec-3', dec3.replace('acmod="7"', 'acmod="2"')))[0]!.channels).toBe(3)
  expect(parseMp4Tracks(xml('ec-3', dec3.replace('num_sub_dep="0"', 'num_sub_dep="1"')))[0]!.channels).toBeUndefined()
  expect(parseMp4Tracks(xml('ec-3', dec3 + dec3))[0]!.channels).toBeUndefined()
  expect(parseMp4Tracks(xml('ec-3', ''))[0]!.channels).toBeUndefined()
  expect(parseMp4Tracks(xml('mp4a', '', 6))[0]!.channels).toBeUndefined()
})

test('Youku original Chinese uses matched language over generic eng, preserving explicit dub language and other providers', () => {
  for (const unknown of ['原声', '', 'und', 'DTS']) {
    expect(mp4Lang(resolveAudioLanguage(youkuAudioLanguage(unknown, 'zh'), 'eng', 'zh'))).toBe('zho')
  }
  for (const explicit of ['英语', 'eng', '粤语', '闽南', 'ja']) {
    expect(youkuAudioLanguage(explicit, 'zh')).toBe(explicit)
  }
  expect(resolveAudioLanguage(youkuAudioLanguage('原声'), 'eng')).toBe('eng')
  // The shared source-first fallback remains unchanged for all other providers.
  expect(resolveAudioLanguage('原声', 'eng', 'zh')).toBe('eng')
})
