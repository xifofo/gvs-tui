import { expect, test } from 'bun:test'
import { requiresTencentEncodingIdentity, selectedTencentQuality, tencentDownloadSelection, tencentSelectedPlayInput } from './tencent-quality-selection.ts'
import type { Quality } from '../types.ts'

const q: Quality = { id: 'suhd|hard|322157|2741517771455_硬', stream: 'suhd', caption: 'hard', formatId: '322157', persona: '2741517771455_硬', group: 'encode', label: '臻彩MAX · HEVC·A', title: 'suhd', width: 3840, height: 1636, size: 1128670539, codec: '4', drm: '' }

test('selected HEVC identity survives persistence while play uses compatible parameters', () => {
  const task = JSON.parse(JSON.stringify({ quality: q.stream, caption: q.caption, group: 'WF', tencentQuality: selectedTencentQuality(q) }))
  expect(task.tencentQuality).toEqual({ formatId: '322157', persona: '2741517771455_硬', group: 'encode', width: 3840, height: 1636 })
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

test('default encoding in new and restored queues uses normal download acceptance', () => {
  for (const persona of ['default', 'default_硬', 'default_soft']) {
    const saved = JSON.parse(JSON.stringify({ group: 'encode', persona, formatId: '322093', width: 3840, height: 2160 }))
    expect(requiresTencentEncodingIdentity(saved)).toBe(false)
  }
  expect(requiresTencentEncodingIdentity({ group: 'encode', persona: '2741517771455_硬' })).toBe(true)
  expect(requiresTencentEncodingIdentity({ group: 'encode', persona: 'h264_soft' })).toBe(true)
  expect(requiresTencentEncodingIdentity({ group: 'encode' })).toBe(true)
  expect(requiresTencentEncodingIdentity({ group: 'main' })).toBe(false)
})
