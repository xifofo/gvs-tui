import { describe, expect, test } from 'bun:test'
import { fetchHlsVtt, isHlsPlaylist, parseHlsSubtitlePlaylist, stitchVttParts, vttToSrt } from './vtt-hls.ts'

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
seg0.vtt
#EXTINF:6.000,
seg1.vtt
#EXT-X-ENDLIST
`

describe('parseHlsSubtitlePlaylist', () => {
  test('累加 EXTINF 作为分片起点，相对 URI 按 playlist 解析', () => {
    const segs = parseHlsSubtitlePlaylist(PLAYLIST, 'https://cdn.example/sub/x.f53102000.vtt.m3u8?ver=4')
    expect(segs.map(s => [s.start, s.url])).toEqual([
      [0, 'https://cdn.example/sub/seg0.vtt'],
      [6, 'https://cdn.example/sub/seg1.vtt'],
    ])
  })

  test('master playlist 退化为第一个 variant', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nsub.vtt.m3u8\n'
    const segs = parseHlsSubtitlePlaylist(master, 'https://cdn.example/x/master.m3u8')
    expect(segs).toEqual([{ url: 'https://cdn.example/x/sub.vtt.m3u8', start: 0 }])
  })
})

describe('stitchVttParts', () => {
  test('头部只留一个、NOTE 丢弃、相对 cue 平移、绝对 cue 保留', () => {
    const out = stitchVttParts([
      { start: 0, body: 'WEBVTT\n\nNOTE 段0\n\n00:00:00.500 --> 00:00:02.000\n第一句\n' },
      { start: 6, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n第三句\n\n00:00:10.000 --> 00:00:11.000\n第四句\n' },
    ])
    expect(out.match(/WEBVTT/g)?.length).toBe(1)
    expect(out).not.toContain('NOTE 段0')
    expect(out).toContain('00:00:00.500 --> 00:00:02.000')
    expect(out).toContain('00:00:06.000 --> 00:00:07.500')
    expect(out).toContain('00:00:10.000 --> 00:00:11.000')
    expect(out.indexOf('第三句')).toBeLessThan(out.indexOf('第四句'))
  })

  test('重复 cue 去重', () => {
    const seg = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n同一句\n'
    const out = stitchVttParts([
      { start: 0, body: seg },
      { start: 0, body: seg },
    ])
    expect(out.match(/同一句/g)?.length).toBe(1)
  })
})

describe('vttToSrt', () => {
  test('时间戳逗号 + 序号 + 去 settings', () => {
    const srt = vttToSrt('WEBVTT\n\n00:00:01.250 --> 00:00:03.000 align:start\n你好\n世界\n')
    expect(srt).toContain('1\n00:00:01,250 --> 00:00:03,000')
    expect(srt).toContain('你好\n世界')
    expect(srt).not.toContain('WEBVTT')
    expect(srt).not.toContain('align:start')
  })
})

describe('fetchHlsVtt', () => {
  const files: Record<string, string> = {
    'https://cdn.example/sub/x.vtt.m3u8': PLAYLIST,
    'https://cdn.example/sub/seg0.vtt': 'WEBVTT\n\n00:00:00.200 --> 00:00:01.000\n甲\n',
    'https://cdn.example/sub/seg1.vtt': 'WEBVTT\n\n00:00:00.100 --> 00:00:02.000\n乙\n',
  }
  const fetcher = async (url: string) => new Response(files[url] ?? '', { status: url in files ? 200 : 404 })

  test('拉 playlist 再拼分片', async () => {
    const vtt = await fetchHlsVtt(fetcher, 'https://cdn.example/sub/x.vtt.m3u8')
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('甲')
    expect(vtt).toContain('00:00:06.100 --> 00:00:08.000')
  })

  test('已经是完整 WebVTT 时原样返回', async () => {
    const vtt = await fetchHlsVtt(
      async () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n直接\n'),
      'https://cdn.example/plain.vtt',
    )
    expect(vtt).toContain('直接')
  })

  test('分片全失败时报错（而不是写空文件）', async () => {
    const onlyPlaylist = async (url: string) =>
      new Response(url.endsWith('.m3u8') ? PLAYLIST : '', { status: url.endsWith('.m3u8') ? 200 : 500 })
    await expect(fetchHlsVtt(onlyPlaylist, 'https://cdn.example/sub/x.vtt.m3u8')).rejects.toThrow()
  })
})

describe('isHlsPlaylist', () => {
  test('WebVTT 不是 playlist', () => {
    expect(isHlsPlaylist('WEBVTT\n\n')).toBe(false)
    expect(isHlsPlaylist('#EXTM3U\n')).toBe(true)
  })
})
