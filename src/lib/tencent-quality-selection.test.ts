import { expect, test } from 'bun:test'
import { selectedTencentQuality, tencentDownloadSelection, tencentSelectedPlayInput } from './tencent-quality-selection.ts'
import type { Quality } from '../types.ts'
import { qualitiesFromTencentFormats, qualityCaptionText } from './quality.ts'
import { pickTencentDownloadURL } from './media.ts'

test('unknown subtitle display retains the soft probe for selection and queued downloads', () => {
  const [quality] = qualitiesFromTencentFormats([{ name: 'fhd', id: '3', caption_probe: '软' }])
  expect(quality!.caption).toBeUndefined()
  expect(qualityCaptionText(quality!.caption)).toBe('')
  expect(tencentSelectedPlayInput(quality!)).toEqual({ defn: 'fhd', caption: 'soft', format_id: '3' })
  const task = JSON.parse(JSON.stringify({ quality: quality!.stream, tencentQuality: selectedTencentQuality(quality!) }))
  expect(tencentSelectedPlayInput(task)).toEqual({ defn: 'fhd', caption: 'soft', format_id: '3' })
  expect(pickTencentDownloadURL({ formats: [
    { name: 'fhd', id: '3', caption_probe: '硬', url: 'https://example.invalid/hard' },
    { name: 'fhd', id: '3', caption_probe: '软', url: 'https://example.invalid/soft' },
  ] }, { stream: 'fhd', formatId: '3', caption: 'soft' })).toBe('https://example.invalid/soft')
})

const q: Quality = { id: 'suhd|hard|322157|2741517771455_硬', stream: 'suhd', caption: 'hard', formatId: '322157', persona: '2741517771455_硬', group: 'encode', label: '臻彩MAX · HEVC·A', title: 'suhd', width: 3840, height: 1636, size: 1128670539, codec: '4', drm: '' }

test('selected HEVC identity survives persistence while play uses compatible parameters', () => {
  const task = JSON.parse(JSON.stringify({ quality: q.stream, caption: q.caption, group: 'WF', tencentQuality: selectedTencentQuality(q) }))
  expect(task.tencentQuality).toEqual({ formatId: '322157', persona: '2741517771455_硬', captionProbe: 'hard', group: 'encode', width: 3840, height: 1636 })
  expect(tencentSelectedPlayInput(task)).toEqual({ defn: 'suhd', caption: 'hard', format_id: '322157', rendition_persona: '2741517771455_硬' })
  expect(tencentDownloadSelection(task)).toEqual({ stream: 'suhd', caption: 'hard', formatId: '322157' })
  expect(tencentSelectedPlayInput(task).encode).toBeUndefined()
})

test('legacy task without saved selectors keeps its previous request', () => {
  expect(tencentSelectedPlayInput({ quality: 'uhd', caption: 'soft', group: 'WF' })).toEqual({ defn: 'uhd', caption: 'soft' })
  expect(tencentDownloadSelection({ quality: 'uhd' })).toEqual({ stream: 'uhd', caption: undefined, formatId: undefined })
})

test('composite identities and Chinese captions remain usable', () => {
  expect(tencentSelectedPlayInput({ quality: q.id })).toEqual({ defn: 'suhd', caption: 'hard', format_id: '322157', rendition_persona: '2741517771455_硬' })
  expect(tencentSelectedPlayInput({ quality: 'fhd', caption: '软字幕', persona: 'h264_软', formatId: '321004' })).toEqual({ defn: 'fhd', caption: 'soft', format_id: '321004', rendition_persona: 'h264_软' })
})

test('special personas and source hints do not add unsupported play parameters', () => {
  expect(tencentSelectedPlayInput({ quality: 'maxplus', persona: 'l3_hard' })).toEqual({ defn: 'maxplus' })
  expect(tencentSelectedPlayInput({ quality: 'source', tencentQuality: { group: 'source' } })).toEqual({ defn: 'source' })
  expect(selectedTencentQuality({ id: 'uhd|hard|0|main' })).toBeUndefined()
})

test('legacy catalog without format IDs still retains promised HDR and frame rate', () => {
  expect(selectedTencentQuality({ id: 'maxplus', width: 3840, height: 2160, fps: 60, hdr: 'hdr' })).toMatchObject({ width: 3840, height: 2160, fps: 60, hdr: 'hdr' })
})
