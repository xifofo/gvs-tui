import { expect, test } from 'bun:test'
import { publicationVersion } from './publication-version.ts'
import type { PublicationDraft } from './publication-types.ts'

const draft = (output: string, patch: Partial<PublicationDraft> = {}): PublicationDraft => ({
  output, seasonNumber: 1,
  measured: { media: { status: 'probed', width: 640, height: 360, codec: 'hevc', dynamicRange: 'SDR' }, file: { size: 1024 } },
  ...patch,
} as PublicationDraft)

test('截图中的旧文件直接取文件名规格，不补入文件名里没有的 SDR', () => {
  expect(publicationVersion(draft('/movies/Good.Night.2026.S01E01.360p.YOUKU.WEB-DL.HEVC-FPWeb.mp4')))
    .toEqual({ name: 'S01.360p.YOUKU.WEB-DL.HEVC', resolution: '360p', dynamicRange: 'SDR' })
})

test('新版 SDR、HDR、音轨和帧率保留原大小写，名称、年份、单集标题与发布组不进入版本名', () => {
  const result = publicationVersion(draft('/movies/1080p.Show.S00E298.特别篇.2024.2160p.YOUKU.WEB-DL.HQ.DV.60fps.HEVC.DDP.5.1.Atmos-Team.Web-Release.mkv',
    { seasonNumber: 0, naming: { source: 'YK', group: 'Team.Web-Release' } }))
  expect(result.name).toBe('S00.2160p.YOUKU.WEB-DL.HQ.DV.60fps.HEVC.DDP.5.1.Atmos')
  expect(publicationVersion(draft('Good.Night.2026.S01E01.360p.YOUKU.WEB-DL.SDR.HEVC-FPWeb.mp4')).name)
    .toBe('S01.360p.YOUKU.WEB-DL.SDR.HEVC')
  expect(publicationVersion(draft('Movie.2026.1080P.WEB-DL.AVC.AAC.2.0.mp4', { seasonNumber: undefined, naming: { source: '', group: '' } })).name)
    .toBe('1080P.WEB-DL.AVC.AAC.2.0')
})

test('分集不同仍产生同一版本名称，不改发布身份或文件路径', () => {
  const first = draft('剧名.2026.S02E01.第一集.1080p.TX.WEB-DL.HDR.HEVC-GVS.mkv', { seasonNumber: 2, releaseKey: 'stable' })
  const next = { ...first, output: '剧名.2026.S02E02.第二集.1080p.TX.WEB-DL.HDR.HEVC-GVS.mkv' }
  const before = JSON.stringify(first)
  expect(publicationVersion(first).name).toBe(publicationVersion(next).name)
  expect(JSON.stringify(first)).toBe(before)
})

test('简短平台文件名使用成品规格与统一编码标签，不显示小写探测编码', () => {
  const file = draft('E01.mkv', { naming: { source: 'HG', group: '' }, measured: {
    media: { status: 'probed', width: 1080, height: 1920, codec: 'h264', dynamicRange: 'SDR', audio: { status: 'confirmed', codec: 'aac', channels: 2 } },
    file: { size: 1234 },
  } })
  expect(publicationVersion(file).name).toBe('S01.1080p.HG.WEB-DL.SDR.AVC.AAC.2.0')
})

test('已确认的新版本快照用于登记，重试不会被原文件名缺失规格改变', () => {
  const version = { name: 'S01.1080p.WEB-DL.SDR.AVC.AAC.2.0', resolution: '1080p', dynamicRange: 'SDR' }
  const result = publicationVersion(draft('Show.S01E02.mp4', { version }))
  expect(result).toEqual(version)
  result.name = 'changed'
  expect(version.name).toBe('S01.1080p.WEB-DL.SDR.AVC.AAC.2.0')
})
