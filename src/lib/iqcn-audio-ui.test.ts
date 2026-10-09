import { expect, test } from 'bun:test'
import { iqcnAudioGroups } from './iqcn-audio-ui'

const choice = (ct: number, codec: string, lang = '普通话') => ({ id: `iqcn:1:${ct}:300:${codec}`, lang, codec, label: `${lang} · ${codec.toUpperCase()}`, isDefault: ct === 5, selected: ct === 5 })

test('domestic audio layout shows language once and keeps real sound-quality choices', () => {
  const data = [choice(5, 'aac'), choice(2, 'dolby'), choice(1, 'aac')]
  const groups = iqcnAudioGroups(data)
  expect(groups).toHaveLength(1)
  expect(groups[0]!.language).toBe('普通话')
  expect(groups[0]!.items.map(row => row.title)).toEqual(['高码率 AAC', '杜比音效', '标准 AAC'])
  expect(groups[0]!.items.map(row => row.audio.id)).toEqual(data.map(row => row.id))
  expect(groups[0]!.items.filter(row => row.recommended)).toHaveLength(1)
  expect(JSON.stringify(groups.map(group => group.items.map(({title,detail}) => ({title,detail}))))).not.toMatch(/DASH|AMP4|普通话|5\.1/i)
})

test('languages and embedded audio remain distinct without losing metadata', () => {
  const data = [choice(5, 'aac'), { ...choice(5, 'aac', '粤语'), id: 'iqcn:2:5:300:aac', embedded: true }]
  const groups = iqcnAudioGroups(data)
  expect(groups.map(group => group.language)).toEqual(['普通话','粤语'])
  expect(groups[1]!.items[0]!.detail).toBe('随视频保留')
  expect(groups[1]!.items[0]!.audio).toBe(data[1]!)
  expect(iqcnAudioGroups([])).toEqual([])
})
