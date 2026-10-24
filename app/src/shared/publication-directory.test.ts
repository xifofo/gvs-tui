import { expect, test } from 'bun:test'
import { publicationDirectoryPreview } from './publication-directory'

test('archive previews include category and stable TMDB identity while keeping specials', () => {
  const work = { categoryLabel: '日韩剧集', title: 'Doctor X', tmdbId: 123, kind: 'show' as const, season: 1 }
  expect(publicationDirectoryPreview(work)).toBe('日韩剧集/Doctor X {tmdbid-123}/season 01')
  expect(publicationDirectoryPreview({ ...work, season: 0 }).endsWith('/season 00')).toBe(true)
  expect(publicationDirectoryPreview({ ...work, kind: 'movie' })).toBe('日韩剧集/Doctor X {tmdbid-123}')
  expect(publicationDirectoryPreview({ ...work, tmdbId: undefined })).toBe('')
  expect(publicationDirectoryPreview({ ...work, categoryLabel: '' })).toBe('')
})

test('preview matches server safe segments and preserves identity suffix within 255 UTF-8 bytes', () => {
  const preview = publicationDirectoryPreview({ categoryLabel: '..', title: '片'.repeat(100) + '/名字', tmdbId: 123, kind: 'movie' })
  const [category, title] = preview.split('/')
  expect(category).toBe('_')
  expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(255)
  expect(title.endsWith(' {tmdbid-123}')).toBe(true)
  expect(publicationDirectoryPreview({ categoryLabel: '剧/集', title: 'A\u0000:B', tmdbId: 123, kind: 'movie' })).toBe('剧_集/A__B {tmdbid-123}')
})
