import { expect, test } from 'bun:test'
import { createTmdbFilenameTitle } from './tmdb'

const row = (language: string, region: string, name: string) => ({ iso_639_1: language, iso_3166_1: region, data: { name, title: name } })

test('selected TV/movie translations prefer English, share requests, and do not mistake original names for English', async () => {
  const calls: string[] = []
  const title = createTmdbFilenameTitle(async (url, init) => {
    const u = new URL(url)
    calls.push(u.pathname)
    expect(init?.proxy).toBe('http://127.0.0.1:7897')
    return Response.json({ id: 123, original_name: '日本語原名', translations: [
      row('zh', 'CN', '中文名'), row('en', 'GB', 'British Title'), row('ja', 'JP', '日本語原名'), row('en', 'US', 'English Title'),
    ] })
  })
  const options = { proxy: 'http://127.0.0.1:7897' }
  expect(await Promise.all([title('key', 'show', 123, '中文', options), title('key', 'show', 123, '中文', options)]))
    .toEqual(['English Title', 'English Title'])
  expect(await title('key', 'show', 123, '中文', options)).toBe('English Title')
  expect(await title('key', 'movie', 123, '中文', options)).toBe('English Title')
  expect(calls).toEqual(['/3/tv/123/translations', '/3/movie/123/translations'])
})

test.each([
  [[row('zh', 'CN', '中文名'), row('en', 'US', ' '), row('en', 'GB', 'Available English')], 'Available English'],
  [[row('ja', 'JP', '日本語'), row('en', 'US', ''), row('zh', 'TW', '繁體名'), row('zh', 'CN', '中文名')], '中文名'],
  [[row('zh', 'TW', '繁體名')], '繁體名'],
  [[row('ja', 'JP', '日本語')], '平台中文名'],
  [[null, { iso_639_1: 'en', data: { name: 123 } }, row('en', 'US', '...')], '平台中文名'],
] as const)('missing or unusable translations fall back without using another original language: %j', async (translations, expected) => {
  const title = createTmdbFilenameTitle(async () => Response.json({ id: 123, translations }))
  expect(await title('key', 'show', 123, '平台中文名')).toBe(expected)
})

test('missing keys, rejected requests and mismatched IDs preserve the caller title and coalesce failures', async () => {
  let calls = 0
  const denied = createTmdbFilenameTitle(async () => { calls++; return new Response('', { status: 401 }) })
  expect(await denied('', 'show', 123, '平台名')).toBe('平台名')
  expect(calls).toBe(0)
  expect(await Promise.all([denied('key', 'show', 123, '中文名'), denied('key', 'show', 123, '另一个回退名')]))
    .toEqual(['中文名', '另一个回退名'])
  expect(calls).toBe(1)
  const wrong = createTmdbFilenameTitle(async () => Response.json({ id: 999, translations: [row('en', 'US', 'Wrong Work')] }))
  expect(await wrong('key', 'movie', 123, '正确作品')).toBe('正确作品')
})
