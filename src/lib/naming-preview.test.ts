import { expect, test } from 'bun:test'
import type { Quality } from '../types.ts'
import { Runtime } from '../runtime.ts'
import { selectAudioTracks } from './audio-selection.ts'
import { completedFilename, filename, folder, type Naming } from './name.ts'
import { jobNaming } from './jobs.ts'
import { namingPreviewFilename } from './naming-preview.ts'

const naming: Naming = { kind: 'show', title: '此处通往繁星', nameDots: '此处通往繁星', year: 2026,
  season: 1, episode: 1, height: 2160, codec: 'DVH1', source: 'YK', group: 'FPWeb', tmdbId: 296203, container: 'mp4' }
const quality = (patch: Partial<Quality> = {}): Quality => ({
  id: 'cmfv5hd4_dolbyvision_hfr_hbr_hq|frame_xiang', label: '杜比视界 · 帧享', title: 'dolbyvision',
  width: 3840, height: 2160, fps: 60, codec: 'DVH1', size: 0, drm: '', ...patch,
})
const audios = [
  { id: 'ep1|cmfa1hd3', label: 'AAC', codec: 'cmfa1hd3', isDefault: true },
  { id: 'ep1|cmfa4hd5_atmos51', label: '杜比全景声', codec: 'cmfa4hd5_atmos51' },
  { id: 'ep1|cmfa3hd5_dtsc51', label: 'DTS', codec: 'cmfa3hd5_dtsc51' },
]

test('pinned English title is shared by preview, fallback and completed names while the folder stays Chinese', () => {
  const n = { ...naming, filenameTitle: 'The Road to the Stars', episodeTitle: '雨夜重逢' }
  for (const name of [filename(n), namingPreviewFilename(n, 'youku', quality()), completedFilename(n, { status: 'unavailable' })]) {
    expect(name).toStartWith('The.Road.to.the.Stars.S01E01.雨夜重逢.2026.')
  }
  expect(folder(n, '/Downloads')).toContain('此处通往繁星 (2026)')
  const restored = JSON.parse(JSON.stringify({ ...n, series: n.title, title: '雨夜重逢', provider: 'youku' }))
  expect(jobNaming(restored, {} as any).filenameTitle).toBe(n.filenameTitle)
  expect(completedFilename({ ...n, kind: 'movie' }, { status: 'unavailable' })).toStartWith('The.Road.to.the.Stars.2026.')
  expect(completedFilename({ ...n, episodeTitle: n.filenameTitle }, { status: 'unavailable' })).not.toContain('.S01E01.The.Road')
  expect(completedFilename({ ...n, filenameTitle: undefined }, { status: 'unavailable' })).toStartWith('此处通往繁星.')
})

test('screenshot preview includes the selected HQ, Dolby Vision, fps, normalized codec and default audio', () => {
  const tracks = selectAudioTracks(audios, audios.map(a => a.id), audios[1]!.id)
  const before = JSON.stringify({ quality: quality(), tracks })
  const name = namingPreviewFilename(naming, 'youku', quality(), tracks)
  expect(name).toBe('此处通往繁星.S01E01.2026.2160p.YOUKU.WEB-DL.HQ.DV.60fps.HEVC.DDP.5.1.Atmos-FPWeb.mp4')
  expect(JSON.stringify({ quality: quality(), tracks })).toBe(before)
  expect(name).toBe(completedFilename(naming, { status: 'probed', width: 3840, height: 2160,
    codec: 'hevc', fps: 60, dynamicRange: 'DV', audio: { status: 'confirmed', codec: 'eac3', channels: 6, atmos: true } }, 'HQ'))
})

test('automatic and manually changed defaults preview the same track that will be muxed', () => {
  const ids = audios.map(a => a.id)
  expect(namingPreviewFilename(naming, 'youku', quality(), selectAudioTracks(audios, ids)))
    .toEndWith('.HEVC.DTS.5.1-FPWeb.mp4')
  const aac = namingPreviewFilename(naming, 'youku', quality(), selectAudioTracks(audios, ids, ids[0]))
  expect(aac).toEndWith('.HEVC.AAC-FPWeb.mp4')
  expect(aac).not.toContain('2.0') // No stereo metadata was supplied.
  expect(aac).not.toContain('Atmos')
})

test('switching to a lower SDR tier clears premium tags and normal fps, including letterboxed sources', () => {
  const name = namingPreviewFilename(naming, 'youku', quality({ id: 'mp4hd3|tv', label: '1080P', title: 'mp4hd3',
    width: 1920, height: 808, fps: 25, codec: 'AVC1.640028', hdr: 'sdr' }))
  expect(name).toBe('此处通往繁星.S01E01.2026.1080p.YOUKU.WEB-DL.SDR.AVC-FPWeb.mp4')
  expect(namingPreviewFilename(naming, 'youku', quality({ hdr: 'sdr' }))).not.toContain('.DV.')
  expect(namingPreviewFilename(naming, 'youku', quality({ hdr: 'sdr' }))).toContain('.SDR.')
})

test('Good Night preview and finished filename retain confirmed SDR, but never infer it when unknown', () => {
  const n: Naming = { ...naming, filenameTitle: 'Good Night', namingOrder: 'title-year', height: 360 }
  const q = quality({ id: 'mp4sd', label: '360P', title: '', width: 640, height: 360, fps: 25, codec: 'HEVC', hdr: 'sdr' })
  const specs = { status: 'probed' as const, width: 640, height: 360, fps: 25, codec: 'hevc', dynamicRange: 'SDR' }
  const expected = 'Good.Night.2026.S01E01.360p.YOUKU.WEB-DL.SDR.HEVC-FPWeb.mp4'
  expect(namingPreviewFilename(n, 'youku', q)).toBe(expected)
  expect(completedFilename(n, specs)).toBe(expected)
  expect(namingPreviewFilename(n, 'youku', { ...q, hdr: undefined })).not.toContain('.SDR.')
  expect(completedFilename(n, { ...specs, dynamicRange: undefined })).not.toContain('.SDR.')
})

test.each(['HEVC', 'H265', 'H.265', 'HVC1.2.4.L153', 'HEV1', 'DVHE', 'DVH1'])('normalizes selected %s to the final HEVC tag', codec => {
  expect(namingPreviewFilename(naming, 'youku', quality({ codec }))).toContain('.HEVC-')
})

test('selected Tencent MAXPLUS and domestic EDR use final marker order', () => {
  expect(namingPreviewFilename({ ...naming, source: 'TX' }, 'tencent', quality({ id: '123', stream: 'maxplus', hdr: 'hdr' })))
    .toContain('.TX.WEB-DL.MAXPLUS.HDR.60fps.HEVC-')
  expect(namingPreviewFilename({ ...naming, source: 'IQIYI' }, 'iqcn', quality({ id: '800|200|60|edrVideo',
    label: 'EDR 10bit', title: '', codec: 'H265', iqcnQuality: { sourceTvid: 'ep1', dynamicRangeCode: 8 } })))
    .toContain('.IQIYI.WEB-DL.EDR.60fps.HEVC-')
  expect(namingPreviewFilename(naming, 'iqcn', quality({ label: 'EDR', title: '', codec: 'H265',
    iqcnQuality: { sourceTvid: 'ep1', dynamicRangeCode: 7 } }))).not.toContain('.EDR.')
  expect(namingPreviewFilename(naming, 'youku', quality({ id: 'mp4hd3|tv', label: '4K 高码率', title: '4K' })))
    .not.toContain('.HQ.')
})

test('unknown specs are omitted while known stereo and mono labels are retained', () => {
  const q = quality({ id: 'unknown', label: '', title: '', codec: '—', width: 0, height: 0, fps: 0 })
  expect(namingPreviewFilename(naming, 'youku', q, [{ id: 'vidAAC|unknown', label: '音轨（编码未确认）' }]))
    .toBe('此处通往繁星.S01E01.2026.2160p.YOUKU.WEB-DL-FPWeb.mp4')
  expect(namingPreviewFilename(naming, 'youku', quality(), [{ id: 'stereo', codec: 'AAC', label: '立体声' }]))
    .toEndWith('.AAC.2.0-FPWeb.mp4')
  expect(namingPreviewFilename(naming, 'youku', quality(), [{ id: 'mono', codec: 'AC3', label: '单声道' }]))
    .toEndWith('.AC3.1.0-FPWeb.mp4')
  // A catalog-only audio hint must still be excluded from a completed name.
  expect(completedFilename(naming, { status: 'probed', codec: 'hevc', audio: { status: 'ambiguous', codec: 'aac', channels: 2 } }))
    .not.toContain('AAC')
})

test('terminal confirmation uses selected specs and preserves S00 and edited episode numbering', () => {
  const runtime = new Runtime({ simulate: true }), state = runtime as any
  try {
    state.cfg.releaseGroup = 'FPWeb'
    state.cfg.includeEpisodeTitle = false
    state.detailProv = 'youku'
    state.detailTitle = naming.title
    state.detailInfo = { kind: 'show', year: 2026 }
    state.eps = [{ vid: 'ep1', title: naming.title, season: 0, number: 298, selected: true, languages: [] }]
    state.pending = [state.taskFromEp(0)]
    state.qualities = [quality()]
    state.audios = audios.map(a => ({ ...a, lang: '普通话', selected: true }))
    state.qIdx = 0
    state.applyOptions()
    state.scene = 'confirm'
    state.emit()
    expect(runtime.snapshot.confirmation?.name)
      .toBe('此处通往繁星.2026.S00E298.2160p.YOUKU.WEB-DL.HQ.DV.60fps.HEVC.DTS.5.1-FPWeb.mp4')
    expect(runtime.snapshot.confirmation?.note).toContain('封装后按实际规格')
  } finally { runtime.close() }
})
