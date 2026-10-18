import { expect, test } from 'bun:test'
import { iqEpisodeAudioCatalog, iqSelectedAudioResponse, selectIQEpisodeAudios } from './iq-audio-selection.ts'

const fallback = () => ({ audios: [
  { id: '1:1:500', lid: 1, lang: '普通话', language: 'zho', label: '普通话 · 杜比 5.1', codec: 'eac3', default: true },
  { id: '1:2:100', lid: 1, lang: '普通话', language: 'zho', label: '普通话 · AAC', codec: 'aac', default: false },
] })
const japanese = (aacDefault = false) => [
  { id: '6:1:500', lang: '日语', label: '日语 · 杜比 5.1', codec: 'eac3', isDefault: !aacDefault },
  { id: '6:2:100', lang: '日语', label: '日语 · AAC', codec: 'aac', isDefault: aacDefault },
]
const erroneousFrench = () => ({ audios: [
  { id: '6:1:500', lid: 6, lang: '法语', language: 'fra', label: '法语 · 杜比 5.1', codec: 'eac3', default: true },
  { id: '6:2:100', lid: 6, lang: '法语', language: 'fra', label: '法语 · AAC', codec: 'aac' },
] })

test('IQ Korean ID 5 repairs saved Japanese labels and refreshed audio without changing stream identity or default', () => {
  const data = { source: 'international', audios: [
    { id: '5:1:500', lid: 5, lang: '日语', language: 'jpn', label: '日语 · 杜比 5.1', codec: 'eac3', default: true },
    { id: '5:2:100', lid: 5, lang: '日语', language: 'jpn', label: '日语 · AAC', codec: 'aac', default: false },
  ] }
  const episode = { title: '第1期 地娛室四姊妹履行懲罰，挑戰爆笑打工生活', audioTracks: [
    { id: '5:1:500', lang: '日语', label: '日语 · 杜比 5.1', codec: 'eac3', isDefault: false },
    { id: '5:2:100', lang: '日语', label: '日语 · AAC', codec: 'aac', isDefault: true },
  ] }
  const before = JSON.stringify({ data, episode })
  const selected = selectIQEpisodeAudios(data, episode)
  expect(selected.map(a => [a.requestedId, a.id, a.language, a.isDefault])).toEqual([
    ['5:1:500', '5:1:500', 'kor', false], ['5:2:100', '5:2:100', 'kor', true],
  ])
  for (const choice of selected) {
    expect(iqSelectedAudioResponse({ id: choice.id, codec: choice.row.codec, language: 'jpn', title: '日语', clear: true }, choice))
      .toMatchObject({ id: choice.id, language: 'kor', title: '韩语', clear: true })
    expect(iqSelectedAudioResponse({ language: 'jpn', codec: choice.row.codec }, choice)).toMatchObject({ language: 'kor' })
  }
  expect(JSON.stringify({ data, episode })).toBe(before)
  expect(selectIQEpisodeAudios(data, { title: episode.title })[0]).toMatchObject({ id: '5:1:500', language: 'kor', isDefault: true })
  expect(() => iqSelectedAudioResponse({ id: '6:1:500', codec: 'eac3', language: 'jpn' }, selected[0]!)).toThrow('不同版本')
  expect(() => iqSelectedAudioResponse({ id: '5:1:500', codec: 'aac', language: 'jpn' }, selected[0]!)).toThrow('不同版本')
})

test('IQ domestic Cookie catalogs retain source languages through selection and refreshed responses', () => {
  for (const sourceOnRow of [false, true]) {
    const rows = [{ id: '6:2:100', lid: 6, language: 'zho', lang: '普通话', codec: 'aac', default: true,
      ...(sourceOnRow ? { source: 'domestic' } : {}) }]
    const data = { ...(sourceOnRow ? {} : { source: 'domestic' }), audios: rows }
    const episode = { title: '作品（日文版）', audioTracks: [{ id: '6:2:100', lang: '普通话', codec: 'aac', isDefault: true }] }
    expect(iqEpisodeAudioCatalog(data, episode.title)[0]?.language).toBe('zho')
    const selected = selectIQEpisodeAudios(data, episode)[0]!
    expect(selected).toMatchObject({ id: '6:2:100', language: 'zho', editionFallback: false, isDefault: true })
    expect(iqSelectedAudioResponse({ id: selected.id, language: 'zho', codec: 'aac' }, selected)).toMatchObject({ language: 'zho', source: 'domestic' })
  }
})

test('IQ confirmed Chinese edition corrects the unreliable ID 6 French catalog without changing stream IDs or defaults', () => {
  const data = erroneousFrench(), audioTracks = japanese(true)
  const original = JSON.stringify({ data, audioTracks })
  for (const title of ['真珠美人魚（中文版）第1集', '作品 (國語版) 第1集', '作品【普通話版】']) {
    expect(iqEpisodeAudioCatalog(data, title).map(a => [a.id, a.language, a.lang, a.label])).toEqual([
      ['6:1:500', 'zho', '普通话', '普通话 · 杜比 5.1'], ['6:2:100', 'zho', '普通话', '普通话 · AAC'],
    ])
    const selected = selectIQEpisodeAudios(data, { title, audioTracks })
    expect(selected.map(a => [a.requestedId, a.id, a.language, a.isDefault, a.editionFallback, a.reportedLanguage])).toEqual([
      ['6:1:500', '6:1:500', 'zho', false, true, 'jpn'], ['6:2:100', '6:2:100', 'zho', true, true, 'jpn'],
    ])
    // Initial and refreshed audio endpoints repeat the gateway's French label.
    for (const choice of selected) {
      expect(iqSelectedAudioResponse({ id: choice.id, codec: choice.row.codec, language: 'fra', title: '法语', clear: true }, choice))
        .toMatchObject({ id: choice.id, language: 'zho', clear: true })
      expect(iqSelectedAudioResponse({ codec: choice.row.codec, language: 'fra', clear: true }, choice)).toMatchObject({ language: 'zho' })
    }
  }
  expect(JSON.stringify({ data, audioTracks })).toBe(original)
})

test('IQ Chinese edition supports new corrected selections and legacy default-only queues', () => {
  const data = erroneousFrench(), title = '真珠美人魚（中文版）第1集'
  const selected = selectIQEpisodeAudios(data, { title, audioTracks: [
    { id: '6:2:100', lang: '普通话', codec: 'aac', isDefault: true },
  ] })
  expect(selected.map(a => [a.id, a.language, a.isDefault])).toEqual([['6:2:100', 'zho', true]])
  expect(selectIQEpisodeAudios(data, { title }).map(a => [a.id, a.language])).toEqual([['6:1:500', 'zho']])
})

test('IQ Chinese edition correction never relabels a real Japanese dub, other language, or multilingual catalog', () => {
  const title = '作品（中文版）'
  const japaneseData = { audios: [{ id: '6:2:100', lid: 6, lang: '日语', language: 'jpn', codec: 'aac' }] }
  expect(iqEpisodeAudioCatalog(japaneseData, title)[0]?.language).toBe('jpn')
  const multiple = { audios: [...erroneousFrench().audios, ...fallback().audios] }
  expect(iqEpisodeAudioCatalog(multiple, title).map(a => a.language)).toEqual(['jpn', 'jpn', 'zho', 'zho'])
  expect(iqEpisodeAudioCatalog({ audios: [{ id: '157:2:100', lang: '泰语', language: 'tha' }] }, title)[0]?.language).toBe('tha')
  for (const text of ['真珠美人魚', '中文版教学第1集', '作品（中文版）（日文版）']) {
    expect(iqEpisodeAudioCatalog(erroneousFrench(), text)[0]?.language).toBe('jpn')
  }
  expect(iqEpisodeAudioCatalog(erroneousFrench(), '真珠美人魚（日文版）第1集')[0]?.language).toBe('jpn')
})

test('IQ Chinese correction still rejects changed audio IDs, codecs, bitrates, and duplicate bindings', () => {
  const data = erroneousFrench(), title = '真珠美人魚（中文版）第1集'
  const selected = selectIQEpisodeAudios(data, { title, audioTracks: japanese() })[0]!
  expect(() => iqSelectedAudioResponse({ id: '6:2:100', codec: 'aac', language: 'fra' }, selected)).toThrow('不同版本')
  expect(() => iqSelectedAudioResponse({ id: selected.id, codec: 'aac', language: 'fra' }, selected)).toThrow('不同版本')
  expect(() => selectIQEpisodeAudios(data, { title, audioTracks: [{ id: '6:2:200', codec: 'aac', lang: '日语' }] })).toThrow('缺少所选语言或规格')
  expect(() => selectIQEpisodeAudios(data, { title, audioTracks: [japanese()[0]!, japanese()[0]!] })).toThrow('无法分别匹配')
})

test('IQ episode 6 rebinds saved Japanese Dolby and AAC to this explicit edition, preserving a manual AAC default', () => {
  const data = fallback(), audioTracks = japanese(true)
  const before = JSON.stringify({ data, audioTracks })
  const selected = selectIQEpisodeAudios(data, { title: '真珠美人魚（日文版）第6集', audioTracks })
  expect(selected.map(a => [a.requestedId, a.id, a.language, a.isDefault])).toEqual([
    ['6:1:500', '1:1:500', 'jpn', false], ['6:2:100', '1:2:100', 'jpn', true],
  ])
  const response = { id: '1:1:500', codec: 'eac3', language: 'zho', clear: true, parts: [{ url: 'https://cdn.test/audio' }] }
  expect(iqSelectedAudioResponse(response, selected[0]!)).toMatchObject({ id: '1:1:500', codec: 'eac3', language: 'jpn', clear: true })
  expect(response.language).toBe('zho')
  // Saved IDs also determine the job's cache directory; don't rewrite them.
  expect(JSON.stringify({ data, audioTracks })).toBe(before)
})

test('IQ a new queue from the fallback catalog receives the same explicit-edition language correction', () => {
  const selected = selectIQEpisodeAudios(fallback(), { title: '真珠美人魚（日文版）第6集', audioTracks: [
    { id: '1:2:100', lang: '普通话', codec: 'aac', isDefault: true },
  ] })
  expect(selected).toHaveLength(1)
  expect(selected[0]).toMatchObject({ requestedId: '1:2:100', id: '1:2:100', language: 'jpn', isDefault: true })
})

test('IQ preserves exact Japanese IDs and the requested codec subset', () => {
  const selected = selectIQEpisodeAudios({ audios: [
    { id: '6:1:500', lid: 6, lang: '法语', language: 'fra', codec: 'eac3', default: true },
    { id: '6:2:100', lid: 6, lang: '法语', language: 'fra', codec: 'aac' },
  ] }, { title: '真珠美人魚（日文版）第1集', audioTracks: [japanese()[1]!] })
  expect(selected.map(a => [a.id, a.language])).toEqual([['6:2:100', 'jpn']])
})

test('IQ known language aliases rebind changed IDs only within the same codec and bitrate', () => {
  const selected = selectIQEpisodeAudios({ audios: [
    { id: '20:2:100', lang: 'English', codec: 'AAC' },
    { id: '20:2:200', lang: 'en', codec: 'AAC' },
    { id: '20:1:500', lang: 'eng', codec: 'E-AC-3' },
  ] }, { title: 'Episode 2', audioTracks: [
    { id: '2:2:200', lang: '英语', codec: 'aac', isDefault: true },
    { id: '2:1:500', lang: 'en', codec: 'DDP' },
  ] })
  expect(selected.map(a => [a.id, a.language, a.isDefault])).toEqual([
    ['20:2:200', 'eng', true], ['20:1:500', 'eng', false],
  ])
})

test('IQ refuses an unavailable AAC bitrate instead of silently substituting another AAC', () => {
  expect(() => selectIQEpisodeAudios(fallback(), { title: '剧集', audioTracks: [
    { id: '1:2:200', lang: '普通话', codec: 'aac' },
  ] })).toThrow('缺少所选语言或规格')
  expect(() => selectIQEpisodeAudios({ audios: [fallback().audios[1]!] }, {
    title: '真珠美人魚（日文版）第6集', audioTracks: [japanese()[0]!],
  })).toThrow('缺少所选语言或规格')
})

test('IQ does not infer a Japanese dub from the selection or an unqualified title', () => {
  for (const title of ['真珠美人魚', '韩剧', '故事里的（日语版）与（泰语版）', '日语版教学第6集']) {
    expect(() => selectIQEpisodeAudios(fallback(), { title, audioTracks: japanese() })).toThrow('缺少所选语言或规格')
  }
  expect(iqEpisodeAudioCatalog(fallback(), '我的室友是九尾狐 第1集')[0]?.language).toBe('zho')
})

test('IQ never relabels Mandarin or a real different dub in a multilingual catalog', () => {
  const data = { audios: [...fallback().audios, { id: '157:2:100', lang: '泰语', language: 'tha', codec: 'aac' }] }
  expect(iqEpisodeAudioCatalog(data, '作品（日文版）').map(a => a.language)).toEqual(['zho', 'zho', 'tha'])
  expect(() => selectIQEpisodeAudios(data, { title: '作品（日文版）', audioTracks: japanese() })).toThrow('缺少所选语言或规格')
  expect(() => selectIQEpisodeAudios({ audios: [
    { id: '157:2:100', lang: '泰语', codec: 'aac' },
  ] }, { title: '作品（日文版）', audioTracks: [japanese()[1]!] })).toThrow('缺少所选语言或规格')
})

test('IQ keeps a manually selected dub and default even when the source default is another language', () => {
  const data = { audios: [...fallback().audios,
    { id: '157:1:500', lang: '泰语', codec: 'eac3', default: false },
    { id: '6:2:100', lang: '日语', codec: 'aac', default: false },
  ] }
  const selected = selectIQEpisodeAudios(data, { title: '泰剧', audioTracks: [
    { id: '157:1:500', lang: '泰语', codec: 'eac3', isDefault: false },
    { id: '6:2:100', lang: '日语', codec: 'aac', isDefault: true },
  ] })
  expect(selected.map(a => [a.id, a.language, a.isDefault])).toEqual([
    ['157:1:500', 'tha', false], ['6:2:100', 'jpn', true],
  ])
})

test('IQ missing saved selections use only the episode source default', () => {
  expect(selectIQEpisodeAudios(fallback(), { title: '剧集' }).map(a => [a.id, a.isDefault])).toEqual([['1:1:500', true]])
  expect(selectIQEpisodeAudios(fallback(), { title: '作品（日文版）' })[0]?.language).toBe('jpn')
  expect(() => selectIQEpisodeAudios({ audios: [] }, { title: '剧集' })).toThrow('默认独立音轨')
})

test('IQ rejects ambiguous or duplicate bindings and opaque IDs without a known language', () => {
  expect(() => selectIQEpisodeAudios({ audios: [
    { id: '20:2:100', lang: '英语', codec: 'aac' }, { id: '21:2:100', lang: 'English', codec: 'aac' },
  ] }, { title: '剧集', audioTracks: [{ id: '2:2:100', lang: 'eng', codec: 'aac' }] })).toThrow('多个符合')
  expect(() => selectIQEpisodeAudios(fallback(), { title: '剧集', audioTracks: [
    { id: 'missing', lang: '原声', codec: 'aac' },
  ] })).toThrow('缺少所选语言或规格')
  expect(() => selectIQEpisodeAudios(fallback(), { title: '作品（日文版）', audioTracks: [
    japanese()[1]!, { id: '1:2:100', lang: '普通话', codec: 'aac' },
  ] })).toThrow('无法分别匹配')
})

test('IQ validates the resolved ID and codec again on initial and refreshed audio responses', () => {
  const selected = selectIQEpisodeAudios(fallback(), { title: '作品（日文版）', audioTracks: japanese() })[0]!
  expect(() => iqSelectedAudioResponse({ id: '1:2:100', codec: 'aac', clear: true }, selected)).toThrow('不同版本')
  expect(() => iqSelectedAudioResponse({ id: selected.id, codec: 'aac' }, selected)).toThrow('不同版本')
  // Older audio endpoints may omit ID; the request still binds its language.
  expect(iqSelectedAudioResponse({ language: 'zho', codec: 'DDP', clear: true }, selected)).toMatchObject({ language: 'jpn', clear: true })
  expect(() => iqSelectedAudioResponse({ id: selected.id, codec: 'eac3', language: 'tha' }, selected)).toThrow('不同版本')
  const english = selectIQEpisodeAudios({ audios: [{ id: '20:2:100', language: 'eng', codec: 'aac' }] }, {
    title: '剧集', audioTracks: [{ id: '20:2:100', lang: '英语', codec: 'aac' }],
  })[0]!
  expect(() => iqSelectedAudioResponse({ id: english.id, language: 'zho', codec: 'aac' }, english)).toThrow('不同版本')
})
