import { expect, test } from 'bun:test'
import { matchMeasuredRelease, measuredReleaseVersion, matchRelease, type ReleaseOption } from './release-selection'
import { parseReleaseSpecs, releaseSource, sourceReviewReason } from './release-specs'
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

test('分辨率以文件名为准，裁切像素不拦截匹配或新建；缺失时才回退实测', () => {
  const cropped: MediaSpecs = { ...media, width: 3236, height: 2156, codec: 'hevc', dynamicRange: 'DV', fps: 23.976,
    audio: { status: 'confirmed', codec: 'eac3', channels: 6, atmos: true } }
  const file = 'Primetime.2026.2160p.WEB-DL.AMZN.DV.HEVC.DDP.5.1.Atmos-Ftang.mkv'
  const version = measuredReleaseVersion(cropped, file)
  expect(version.resolution).toBe('2160p')
  expect(version.name).toBe('2160p.AMZN.WEB-DL.DV.HEVC.DDP.5.1.Atmos-Ftang')
  const existing = row({ ...version })
  const other = row({ id: 'b'.repeat(32), name: version.name.replace('2160p', '1440p'), resolution: '1440p', dynamicRange: 'DV' })
  expect(matchMeasuredRelease([other, existing], cropped, file).matchedId).toBe(existing.id)
  expect(matchMeasuredRelease([other], cropped, file).canCreate).toBe(true)
  expect(measuredReleaseVersion(media, 'Show.2160p.YK.WEB-DL.AVC.mkv', 1).resolution).toBe('2160p')
  expect(measuredReleaseVersion(cropped, file.replace('2160p.', '')).resolution).toBe('1440p')
})

test('MPEG 音轨（MP2/MP3）按实测编码自动匹配和新建版本，文件名中的写法识别为音轨规格', () => {
  for (const label of ['MP2', 'MP3']) {
    const mpeg: MediaSpecs = { ...media, audio: { status: 'confirmed', codec: label.toLowerCase(), channels: 2 } }
    const name = measuredReleaseVersion(mpeg, 'show.mkv', 1, preset).name
    expect(name).toBe(`S01.1080p.YOUKU.WEB-DL.SDR.AVC.${label}.2.0`)
    expect(matchMeasuredRelease([row({ name })], mpeg, 'show.mkv', preset).matchedId).toBe('a'.repeat(32))
    expect(matchMeasuredRelease([row()], mpeg, 'show.mkv', preset)).toEqual({ canCreate: true, reason: '未匹配到已有版本' })
    expect(parseReleaseSpecs(`Show.S01E01.1080p.HDTV.AVC.${label}.2.0-GRP`)).toMatchObject({ audio: label, channels: 2, extras: '', group: 'GRP' })
    expect(measuredReleaseVersion(mpeg, `Show.S01E01.1080p.YK.WEB-DL.AVC.${label}.2.0-GRP.mkv`, 1).name).toBe(`S01.1080p.YOUKU.WEB-DL.SDR.AVC.${label}.2.0-GRP`)
    expect(matchMeasuredRelease([], media, `Show.1080p.YK.WEB-DL.AVC.${label}.2.0.mkv`).reason).toContain('实际媒体')
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

test('各类音轨按实测编码自动新建并能从版本名读回，文件名的连写声道不混进特殊规格', () => {
  // ffprobe 编码名、版本名写法、发布名中的常见写法
  const families: Array<[string, string, string]> = [
    ['opus', 'Opus', 'Opus2.0'], ['vorbis', 'Vorbis', 'Vorbis2.0'], ['aac', 'AAC', 'AAC2.0'], ['aac', 'AAC', 'HE-AAC2.0'],
    ['ac3', 'AC3', 'DD2.0'], ['ac3', 'AC3', 'AC-3.2.0'], ['eac3', 'DDP', 'DDP2.0'], ['eac3', 'DDP', 'DD+2.0'], ['ac4', 'AC4', 'AC4.2.0'],
    ['truehd', 'TrueHD', 'TrueHD2.0'], ['dts', 'DTS', 'DTS2.0'], ['flac', 'FLAC', 'FLAC2.0'], ['alac', 'ALAC', 'ALAC2.0'],
    ['pcm_s24le', 'LPCM', 'LPCM2.0'], ['pcm_bluray', 'LPCM', 'PCM.2.0'], ['mp2', 'MP2', 'MP22.0'], ['mp3', 'MP3', 'MP3.2.0'],
    ['wmapro', 'WMA', 'WMA2.0'], ['amr_nb', 'AMR', 'AMR2.0'], ['ape', 'APE', 'APE2.0'], ['wavpack', 'WavPack', 'WavPack2.0'],
    ['tak', 'TAK', 'TAK2.0'], ['tta', 'TTA', 'TTA2.0'], ['dsd_lsbf', 'DSD', 'DSD2.0'], ['mpegh_3d_audio', 'MPEGH', 'MPEG-H.2.0'],
    ['speex', 'Speex', 'Speex2.0'], ['adpcm_ima_wav', 'ADPCM', 'ADPCM2.0'],
  ]
  for (const [codec, label, spelling] of families) {
    const specs: MediaSpecs = { ...media, audio: { status: 'confirmed', codec, channels: 2 } }
    const name = measuredReleaseVersion(specs, 'show.mkv', 1, preset).name
    expect(name).toBe(`S01.1080p.YOUKU.WEB-DL.SDR.AVC.${label}.2.0`)
    expect(matchMeasuredRelease([row({ name })], specs, 'show.mkv', preset).matchedId).toBe('a'.repeat(32))
    const file = `Show.S01E01.1080p.YK.WEB-DL.H.264.${spelling}-GRP.mkv`
    expect(parseReleaseSpecs(file.slice(0, -4))).toMatchObject({ channels: 2, extras: '', group: 'GRP' })
    expect(measuredReleaseVersion(specs, file, 1).name).toBe(`${name}-GRP`)
    const other = codec === 'aac' ? 'opus' : 'aac'
    expect(matchMeasuredRelease([], { ...specs, audio: { status: 'confirmed', codec: other, channels: 2 } }, file).reason).toContain('实际媒体')
  }
  // 表外的编码按编码名保留；ffprobe 认不出的 unknown 和缺声道仍要求选择。
  const cook: MediaSpecs = { ...media, audio: { status: 'confirmed', codec: 'cook', channels: 2 } }
  const name = measuredReleaseVersion(cook, 'show.mkv', 1, preset).name
  expect(name).toBe('S01.1080p.YOUKU.WEB-DL.SDR.AVC.COOK.2.0')
  expect(matchMeasuredRelease([row({ name })], cook, 'show.mkv', preset).matchedId).toBe('a'.repeat(32))
  expect(matchMeasuredRelease([row()], cook, 'show.mkv', preset).canCreate).toBe(true)
  for (const audio of [{ codec: 'unknown', channels: 2 }, { codec: 'opus' }]) {
    expect(matchMeasuredRelease([], { ...media, audio: { status: 'confirmed', ...audio } }, 'show.mkv', preset).reason).toBe('音轨规格无法确定，请选择版本')
  }
})

test('YouTube Opus 成品自动新建版本', () => {
  const youtube: MediaSpecs = { ...media, width: 1280, height: 720, audio: { status: 'confirmed', codec: 'opus', channels: 2 } }
  const file = 'A.Different.Kind.of.Pretty.Man.2014.S01E09.720p.YouTube.WEB-DL.Opus2.0.H.264-PFWEB.mkv'
  expect(matchMeasuredRelease([row()], youtube, file)).toEqual({ canCreate: true, reason: '未匹配到已有版本' })
  const version = measuredReleaseVersion(youtube, file, 1)
  expect(version).toEqual({ name: 'S01.720p.YOUTUBE.WEB-DL.SDR.AVC.Opus.2.0-PFWEB', resolution: '720p', dynamicRange: 'SDR' })
  expect(matchMeasuredRelease([row({ ...version })], youtube, file.replace('S01E09', 'S01E10')).matchedId).toBe('a'.repeat(32))
})

test('DVD 隔行片源：保留 480i/576i，MPEG2 视频可匹配，非方形像素不误判为 360p', () => {
  const dvd: MediaSpecs = { ...media, width: 720, height: 480, codec: 'mpeg2video', fps: 30000 / 1001, audio: { status: 'confirmed', codec: 'eac3', channels: 2 } }
  const file = 'Street.of.Fury.1996.480i.NTSC.DVD5.REMUX.MPEG2.DDP2.0-PF.mkv'
  const version = measuredReleaseVersion(dvd, file)
  expect(version).toEqual({ name: '480i.REMUX.DVD5.NTSC.SDR.MPEG2.DDP.2.0-PF', resolution: '480i', dynamicRange: 'SDR' })
  expect(matchMeasuredRelease([row({ ...version })], dvd, file).matchedId).toBe('a'.repeat(32))
  expect(matchMeasuredRelease([row({ ...version, name: version.name.replace('480i', '480p'), resolution: '480p' })], dvd, file).canCreate).toBe(true)
  expect(matchMeasuredRelease([], { ...dvd, audio: { status: 'confirmed', codec: 'ac3', channels: 2 } }, file).reason).toContain('实际媒体')
  const pal: MediaSpecs = { ...dvd, height: 576, fps: 25, audio: { status: 'confirmed', codec: 'ac3', channels: 2 } }
  expect(measuredReleaseVersion(pal, 'Movie.576i.PAL.DVD9.REMUX.MPEG-2.AC3.2.0-GRP.mkv').name).toBe('576i.REMUX.DVD9.PAL.SDR.MPEG2.AC3.2.0-GRP')
  expect(measuredReleaseVersion(dvd, 'Movie.DVD.REMUX.mkv').resolution).toBe('480p')
  expect(measuredReleaseVersion({ ...dvd, codec: 'mpeg4' }, 'Movie.480p.DVD.XviD.mkv').name).toBe('480p.DVD.SDR.MPEG4.DDP.2.0')
  // 0.1.30 曾把 MPEG-4 Part 2 写成 XviD，已建版本仍能匹配。
  expect(matchMeasuredRelease([row({ name: '480p.DVD.SDR.XviD.DDP.2.0', resolution: '480p' })], { ...dvd, codec: 'mpeg4' }, 'Movie.480p.DVD.XviD.mkv').matchedId).toBe('a'.repeat(32))
  expect(measuredReleaseVersion({ ...media, codec: 'vc1' }, 'Movie.1080i.HDTV.VC-1.mkv').name).toBe('1080i.HDTV.SDR.VC1.AAC.2.0')
})

test('DTS 子格式与 Atmos 的各种写法保留在音轨上，旧版本名中被拆散的规格仍能匹配', () => {
  const dts = (channels: number, codec = 'dts'): MediaSpecs => ({ ...media, audio: { status: 'confirmed', codec, channels } })
  expect(measuredReleaseVersion(dts(6), 'Movie.1080p.BluRay.DTS-HD.MA5.1.AVC-GRP.mkv').name).toBe('1080p.BluRay.SDR.AVC.DTS-HD.MA.5.1-GRP')
  expect(measuredReleaseVersion(dts(8), 'Movie.1080p.BluRay.DTS-X.7.1.AVC-GRP.mkv').name).toBe('1080p.BluRay.SDR.AVC.DTS.X.7.1-GRP')
  expect(measuredReleaseVersion(dts(8, 'dtsx'), 'Movie.1080p.BluRay.DTS-HD.MA.7.1.AVC-GRP.mkv').name).toBe('1080p.BluRay.SDR.AVC.DTS.X.7.1-GRP')
  expect(matchMeasuredRelease([row({ name: '1080p.BluRay.1.5.HD.MA.SDR.AVC.DTS.5.1-GRP' })], dts(6), 'Movie.1080p.BluRay.DTS-HD.MA.5.1.AVC-GRP.mkv').matchedId).toBe('a'.repeat(32))
  const truehd: MediaSpecs = { ...media, audio: { status: 'confirmed', codec: 'truehd', channels: 8 } }
  for (const spelling of ['TrueHD7.1.Atmos', 'TrueHD.Atmos.7.1', 'TrueHD.7.1.Atmos']) {
    expect(measuredReleaseVersion(truehd, `Movie.1080p.BluRay.${spelling}.AVC-GRP.mkv`).name).toBe('1080p.BluRay.SDR.AVC.TrueHD.7.1.Atmos-GRP')
  }
  const ddp: MediaSpecs = { ...media, audio: { status: 'confirmed', codec: 'eac3', channels: 6 } }
  expect(measuredReleaseVersion(ddp, 'Show.S01E01.1080p.NF.WEB-DL.DDPA5.1.H.264-GRP.mkv', 1).name).toBe('S01.1080p.NF.WEB-DL.SDR.AVC.DDP.5.1.Atmos-GRP')
  // 旧引擎把 DDP5.1 拆成 1、DDP5 写进了版本名，新文件仍归到这个版本。
  const legacy = row({ name: 'S01.1080p.NF.WEB-DL.1.DDP5.SDR.AVC.DDP.5.1-GRP' })
  expect(matchMeasuredRelease([legacy], ddp, 'Show.S01E02.1080p.NF.WEB-DL.DDP5.1.H.264-GRP.mkv').matchedId).toBe(legacy.id)
})

test('文件名明确写出的普通帧率保留在动态范围与编码之间', () => {
  expect(measuredReleaseVersion(media, 'Show.1080p.YK.WEB-DL.25fps.AVC.mkv', 1).name)
    .toBe('S01.1080p.YOUKU.WEB-DL.SDR.25fps.AVC.AAC.2.0')
})
