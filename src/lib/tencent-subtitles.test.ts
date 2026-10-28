import { describe, expect, test } from 'bun:test'
import { tencentSubtitleOptions, resolveTencentSubtitles } from './tencent-subtitles.ts'
import { subtitleDownloadTracks } from './subtitle-selection.ts'
import { probeOptions } from './quality.ts'
import { defaultConfig } from './config.ts'
import type { GwClient } from './client.ts'

const row = (id: string | number, lang: string, name = lang) => ({ id, lang, name, format: 'vtt', url: `https://cdn.example/${id}.vtt.m3u8` })
const data = { subtitles: [row('en', 'en-US', '英语'), row('hant', 'zh', '繁體中文'), row(53102, 'zh-cn', '简体中文')] }

describe('Tencent subtitle selection', () => {
  test('probe exposes downloadable tracks and Chinese defaults without persisting URLs', async () => {
    const cli = { invoke: async () => data, extra: () => ({}) } as unknown as GwClient
    const result = await probeOptions(cli, defaultConfig(), 'tencent', 'episode')
    expect(result.subtitles).toEqual([
      { id: '53102', lang: 'zh-cn', label: '简体中文', forced: false, sdh: false, selected: true, isDefault: true },
      { id: 'hant', lang: 'zh', label: '繁體中文', forced: false, sdh: false, selected: true, isDefault: false },
      { id: 'en', lang: 'en-US', label: '英语', forced: false, sdh: false, selected: false, isDefault: false },
    ])
    expect(JSON.stringify(result.subtitles)).not.toContain('https:')
    expect(tencentSubtitleOptions({ subtitles: [row('h', 'zh-tw')] })[0]?.isDefault).toBe(true)
    expect(tencentSubtitleOptions({ subtitles: [row('fr', 'fr'), row('en', 'en-US')] }).filter(s => s.selected).map(s => s.id)).toEqual(['en'])
    expect(tencentSubtitleOptions({ subtitles: [row('fr', 'fr')] }).some(s => s.selected)).toBe(false)
  })

  test('each episode rebinds changed IDs by script and uses its current names and URLs', () => {
    const selected = subtitleDownloadTracks(tencentSubtitleOptions(data))
    const current = { subtitles: [row('next-hant', 'zh-tw', '繁体中文'), row('next-hans', 'zh-Hans', '简体中文')] }
    const resolved = resolveTencentSubtitles(current, selected)
    expect(resolved.map(s => [s.sub.id, s.isDefault])).toEqual([['next-hans', true], ['next-hant', false]])
    expect(resolved[0]!.sub.url).toContain('/next-hans.vtt.m3u8')
    expect(selected.map(s => s.id)).toEqual(['53102', 'hant'])
  })

  test('deselecting the default chooses the first remaining subtitle; empty or legacy selection downloads none', () => {
    const selected = subtitleDownloadTracks(tencentSubtitleOptions(data)).filter(s => s.id === 'hant')
    expect(resolveTencentSubtitles(data, selected).map(s => [s.sub.id, s.isDefault])).toEqual([['hant', true]])
    expect(resolveTencentSubtitles(data, [])).toEqual([])
    expect(resolveTencentSubtitles(data, undefined)).toEqual([])
  })

  test('missing or ambiguous languages fail rather than silently omitting selected subtitles', () => {
    const selected = subtitleDownloadTracks(tencentSubtitleOptions(data))
    expect(() => resolveTencentSubtitles({ subtitles: [row('hant', 'zh-tw')] }, selected)).toThrow('所选字幕')
    expect(() => resolveTencentSubtitles({ subtitles: [row('a', 'zh-cn'), row('b', 'zh-Hans')] }, selected.slice(0, 1))).toThrow('无法确认')
    expect(() => resolveTencentSubtitles({ subtitles: [row('53102', 'en-US')] }, selected.slice(0, 1))).toThrow('所选字幕')
  })
})
