import { expect, test } from 'bun:test'
import { mediaKindFromMetadata, movieEdition } from './media-kind'
import { discoveryRows } from './discovery'

test('recognizes explicit movie/TV metadata from normalized and raw platform fields', () => {
  for (const data of [
    { category: '电影' }, { kind: 'movie' }, { media_type: 'movie' },
    { raw: { category: '电影 / 犯罪' } }, { meta: { type: 'film' } },
    { show: { channel: { name: '电影' } } }, { tags: ['犯罪', '电影'] },
  ]) expect(mediaKindFromMetadata(data)).toBe('movie')
  expect(mediaKindFromMetadata({ media_type: 'tv', category: '电影' })).toBe('show')
  expect(mediaKindFromMetadata({ raw: { type_name: '电视剧' } })).toBe('show')
})

test('a single episode or a generic video/animation label is not a movie classification', () => {
  expect(mediaKindFromMetadata({ title: '追凶者也', kind: 'video', episode_count: 1, episodes: [{ title: '追凶者也', kind: '正片' }] })).toBeUndefined()
  expect(mediaKindFromMetadata({ title: '电影人生', category: '动漫', episodes: [{}] })).toBeUndefined()
  expect(mediaKindFromMetadata({ type: 1 })).toBeUndefined()
})

test('search and discovery keep content type for a detail response that lacks it', () => {
  const [row] = discoveryRows('tencent', { items: [{ id: 'cid', title: '追凶者也', kind: 'video', meta: { media_type: 'movie' } }] })
  expect(row?.mediaKind).toBe('movie')
})

test('movie naming keeps real versions without duplicating the feature title', () => {
  expect(movieEdition('追凶者也', '追凶者也')).toBe('')
  expect(movieEdition('正片', '追凶者也')).toBe('')
  expect(movieEdition('国语版', '第九区')).toBe('国语版')
})
