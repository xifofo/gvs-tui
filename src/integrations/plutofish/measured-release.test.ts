import { expect, test } from 'bun:test'
import { matchMeasuredRelease, measuredReleaseVersion, matchRelease, type ReleaseOption } from './release-selection'
import { releaseSource, sourceReviewReason } from './release-specs'
import { completedFilename, type Naming } from '../../lib/name'
import { publicationVersion } from './publication-version'
import type { PublicationDraft } from './publication-types'
import type { MediaSpecs } from '../../lib/actual-version'
const media: MediaSpecs = { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR', fps: 25, audio: { status: 'confirmed', codec: 'aac', channels: 2 } }
const preset = { platform: 'YOUKU', type: 'WEB-DL' }
const row = (patch: Partial<ReleaseOption> = {}): ReleaseOption => ({ id: 'a'.repeat(32), name: 'S01.1080p.YOUKU.WEB-DL.SDR.AVC.AAC.2.0', resolution: '1080p', dynamicRange: 'SDR', status: 'published', ...patch })

test('来源缺失不匹配也不新建，已有候选不能代替来源证据', () => {
  for (const file of ['show.mkv', 'Show.S01E02.1080p.AVC.mkv', 'Show.S01E02.1080p.WEB-DL.AVC.mkv']) {
    const result = matchMeasuredRelease([row()], media, file)
    expect(result.matchedId).toBeUndefined()
    expect(result.canCreate).not.toBe(true)
    expect(result.reason).toContain('来源')
    expect(() => measuredReleaseVersion(media, file)).toThrow('来源')
  }
  expect(matchMeasuredRelease([], media, 'Show.YK.mkv', { platform: 'TX' }).canCreate).not.toBe(true)
})

test('文件名优先，预设补缺；实体片源不套网络平台或 WEB-DL', () => {
  expect(releaseSource('Show.1080p.YK.WEB-DL.AVC', { platform: 'TX', type: 'BluRay' })).toEqual(preset)
  expect(releaseSource('Show.S01E02.YK.WEBRip', { platform: 'TX', type: 'WEB-DL' })).toEqual({ platform: 'YOUKU', type: 'WEBRip' })
  expect(releaseSource('Show.1080p.AVC', preset)).toEqual(preset)
  expect(releaseSource('Show.1080p.BluRay.REMUX.AVC', preset)).toEqual({ platform: undefined, type: 'BluRay' })
  expect(measuredReleaseVersion(media, 'Show.1080p.BluRay.REMUX.AVC.mkv', 1, preset).name).toBe('S01.1080p.BluRay.REMUX.SDR.AVC.AAC.2.0')
  expect(measuredReleaseVersion(media, 'Show.1080p.REMUX.AVC.mkv', 1, preset).name).toBe('S01.1080p.REMUX.SDR.AVC.AAC.2.0')
  expect(sourceReviewReason(releaseSource('Movie.WEB-DL'))).toContain('平台')
  expect(releaseSource('Show.1080p.Custom.WEB-DL.AVC').platform).toBe('CUSTOM')
  expect(measuredReleaseVersion(media, 'Show.S01E02.mkv', 1, preset).name).toBe(row().name)
})

test('实测校验文件名矛盾和未知媒体规格，不自动创建错误版本', () => {
  for (const path of ['Show.2160p.YK.WEB-DL.HEVC.mkv', 'Show.1080p.YK.WEB-DL.60fps.AVC.mkv', 'Show.1080p.YK.WEB-DL.HDR.AVC.mkv']) {
    expect(matchMeasuredRelease([row()], media, path).reason).toContain('实际媒体')
    expect(matchMeasuredRelease([], media, path).canCreate).not.toBe(true)
  }
  for (const patch of [{ fps: undefined }, { audio: { status: 'ambiguous' as const } }]) {
    expect(matchMeasuredRelease([], { ...media, ...patch }, 'show.mkv', preset).canCreate).not.toBe(true)
  }
})

test('两端同一匹配规则兼容旧别名和缺失音轨，不合并已知差异', () => {
  const expected = measuredReleaseVersion(media, 'show.mkv', 1, preset).name
  const cases: Array<[Partial<ReleaseOption>, boolean]> = [
    [{}, true], [{ name: 'S01.1080p.YK.WEB-DL.H264' }, true],
    [{ name: 'S01.1080p.TX.WEB-DL.AVC' }, false], [{ name: 'S01.1080p.YK.WEBRip.AVC' }, false],
    [{ name: 'S01.1080p.YK.WEB-DL.HQ.AVC' }, false], [{ name: 'S01.1080p.YK.WEB-DL.AVC.AAC.5.1' }, false],
    [{ name: 'S01.1080p.YK.WEB-DL.AVC.DDP.2.0' }, false], [{ name: 'S01.1080p.YK.WEB-DL.60fps.AVC' }, false],
    [{ name: 'S01.1080p.YK.WEB-DL.AVC.AAC.2.0.Atmos' }, false], [{ dynamicRange: 'HDR10' }, false],
    [{ status: 'unpublished' }, false], [{ name: '收藏版' }, false],
  ]
  for (const [patch, matches] of cases) {
    const items = [row(patch)]
    const watch = matchMeasuredRelease(items, media, 'show.mkv', preset)
    expect(watch.matchedId).toBe(matchRelease(items, expected).matchedId)
    expect(!!watch.matchedId).toBe(matches)
  }
  const ambiguous = [row(), row({ id: 'b'.repeat(32) })]
  expect(matchMeasuredRelease(ambiguous, media, 'show.mkv', preset).reason).toContain('多个版本')
  expect(matchMeasuredRelease(ambiguous, media, 'show.mkv', preset).canCreate).toBe(false)
  expect(matchRelease(ambiguous, expected).matchedId).toBeUndefined()
})

test('同来源和实测规格两端新版本名称一致，保留制作组并排除片名和分集', () => {
  for (const source of ['YK', 'TX', 'IQ', 'IQIYI', 'HG', 'DSNP']) {
    for (const specs of [media, { ...media, dynamicRange: 'HDR' }, { ...media, dynamicRange: 'HLG', fps: 50 }, { ...media, fps: 120 }, { ...media, dynamicRange: 'DV', fps: 60, codec: 'hevc', audio: { status: 'confirmed' as const, codec: 'eac3', channels: 6, atmos: true } }]) {
      const naming = { title: 'Show', kind: 'show', season: 1, episode: 1, year: 2026, source, group: 'Team.Web', container: 'mkv' } as Naming
      const output = completedFilename(naming, specs, 'HQ')
      const downloader = publicationVersion({ output, seasonNumber: 1, naming: { source, group: 'Team.Web' }, measured: { media: specs, file: { size: 1 } } } as PublicationDraft)
      expect(downloader.name.endsWith('-Team.Web')).toBe(true)
      expect(measuredReleaseVersion(specs, output, 1)).toEqual(downloader)
      const next = completedFilename({ ...naming, title: 'Other', episode: 12 }, specs, 'HQ')
      expect(measuredReleaseVersion(specs, next, 1)).toEqual(downloader)
    }
  }
})

test('旧 HLG 成品的泛 HDR 标签按已确认媒体和目录元数据兼容', () => {
  const hlg = { ...media, dynamicRange: 'HLG', fps: 50 }
  const legacy = 'S01.1080p.YK.WEB-DL.HDR.50fps.AVC.AAC.2.0'
  const item = row({ name: legacy, dynamicRange: 'HLG' })
  const generated = measuredReleaseVersion(hlg, legacy + '.mkv', 1)
  expect(generated.name).toContain('.HLG.50fps.')
  expect(matchMeasuredRelease([item], hlg, legacy + '.mkv').matchedId).toBe(item.id)
  expect(matchRelease([item], generated.name).matchedId).toBe(item.id)
  expect(matchMeasuredRelease([row({ name: legacy, dynamicRange: 'HDR10' })], hlg, legacy + '.mkv').matchedId).toBeUndefined()
})

test('没有分辨率字段时仍保留特殊标签，不把 DTS-HD 当成发布组裁掉', () => {
  expect(measuredReleaseVersion(media, 'Show.YK.WEB-DL.HQ.AVC.mkv', 1).name).toBe('S01.1080p.YOUKU.WEB-DL.HQ.SDR.AVC.AAC.2.0')
  const dts = { ...media, audio: { status: 'confirmed' as const, codec: 'dts', channels: 6 } }
  const version = measuredReleaseVersion(dts, 'Movie.1080p.BluRay.AVC.DTS-HD.MA.5.1-Group.mkv')
  expect(version.name).toContain('HD')
  expect(version.name.endsWith('-Group')).toBe(true)
  expect(matchMeasuredRelease([row({ name: '1080p.BluRay.SDR.AVC.DTS.5.1' })], dts, 'Movie.1080p.BluRay.AVC.DTS-HD.MA.5.1-Group.mkv').matchedId).toBeUndefined()
})

test('自动匹配区分制作组，大小写兼容且明确绑定仍然优先', () => {
  const grouped = row({ name: `${row().name}-Team.Web-Release` })
  const other = row({ id: 'b'.repeat(32), name: `${row().name}-Other` })
  const file = 'Show.1080p.YK.WEB-DL.AVC-team.web-release.mkv'
  const version = measuredReleaseVersion(media, file, 1)
  expect(version.name).toBe(`${row().name}-team.web-release`)
  expect(matchMeasuredRelease([row(), other, grouped], media, file).matchedId).toBe(grouped.id)
  expect(matchRelease([row(), other, grouped], version.name).matchedId).toBe(grouped.id)
  expect(matchMeasuredRelease([row(), other], media, file).canCreate).toBe(true)
  expect(matchRelease([row(), other], version.name).matchedId).toBeUndefined()
  expect(matchRelease([other], version.name, other.id)).toEqual({ matchedId: other.id, match: 'binding' })
  expect(matchMeasuredRelease([grouped], media, 'show.mkv', preset).canCreate).toBe(true)
  expect(measuredReleaseVersion(media, 'Show.YK.WEB-DL.AVC-制作组.mkv', 1).name).toBe(`${row().name}-制作组`)
})

test('文件名明确写出的普通帧率保留在动态范围与编码之间', () => {
  expect(measuredReleaseVersion(media, 'Show.1080p.YK.WEB-DL.25fps.AVC.mkv', 1).name)
    .toBe('S01.1080p.YOUKU.WEB-DL.SDR.25fps.AVC.AAC.2.0')
})
