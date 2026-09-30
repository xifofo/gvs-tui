import { expect, test } from 'bun:test'
import { createTmdbSearch, normalizeTmdbProxy } from './tmdb'

const results = [
  { id: 10, media_type: 'person', name: '演员' },
  { id: 415634, media_type: 'movie', title: '追凶者也', release_date: '2016-09-14' },
  { id: 415634, media_type: 'tv', name: '灵境行者', first_air_date: '2026-08-01' },
]

test('searches movies and TV together, excludes people, and retains their distinct types', async () => {
  const search = createTmdbSearch(async (url, init) => {
    const u = new URL(url)
    expect(u.pathname).toBe('/3/search/multi')
    expect(u.searchParams.get('api_key')).toBe('test-key')
    expect(u.searchParams.get('query')).toBe('追凶者也')
    expect(u.searchParams.get('language')).toBe('zh-CN')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    return Response.json({ results })
  })
  const hits = await search(' test-key ', 'zh-CN', ' 追凶者也 ')
  expect(hits.map(h => [h.kind, h.name, h.year])).toEqual([
    ['movie', '追凶者也', 2016], ['show', '灵境行者', 2026],
  ])
})

test('network failures try the alternate host and remember the working host', async () => {
  const hosts: string[] = []
  const search = createTmdbSearch(async (url) => {
    hosts.push(new URL(url).hostname)
    if (hosts.length === 1) throw new Error('connection failed')
    return Response.json({ results: [] })
  })
  await search('key', '', '电影')
  await search('key', '', '剧集')
  expect(hosts).toEqual(['api.tmdb.org', 'api.themoviedb.org', 'api.themoviedb.org'])
})

test('timeout covers response body and falls back when headers arrive but body stalls', async () => {
  let calls = 0
  const search = createTmdbSearch(async (_url, init) => {
    if (++calls > 1) return Response.json({ results })
    return new Response(new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
      },
    }))
  }, 20)
  expect(await search('key', '', '电影')).toHaveLength(2)
  expect(calls).toBe(2)
})

test('invalid credentials fail clearly without retrying or exposing the key', async () => {
  let calls = 0
  const search = createTmdbSearch(async () => { calls++; return new Response('denied', { status: 401 }) })
  await expect(search('private-key', '', '电影')).rejects.toThrow('凭证无效')
  expect(calls).toBe(1)
})

test('both network failures produce a safe actionable error', async () => {
  const search = createTmdbSearch(async (url) => { throw new Error(`failed ${url}`) })
  try {
    await search('private-key', '', '电影')
    throw new Error('should fail')
  } catch (e) {
    expect(String(e)).toContain('两个 API 地址')
    expect(String(e)).not.toContain('private-key')
    expect(String(e)).not.toContain('api_key=')
  }
})

test('read access tokens use the Authorization header, never the query string', async () => {
  const search = createTmdbSearch(async (url, init) => {
    expect(new URL(url).searchParams.has('api_key')).toBe(false)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer header.payload.signature')
    return Response.json({ results: [] })
  })
  await search(' Bearer header.payload.signature ', '', '电影')
})

test('a TMDB-specific proxy is scoped to each search and remains set for alternate hosts', async () => {
  const routes: Array<string | undefined> = []
  const search = createTmdbSearch(async (_url, init) => {
    routes.push(init?.proxy)
    if (routes.length === 1) throw new Error('first host unavailable')
    return Response.json({ results })
  })
  await search('key', '', '电影', { proxy: ' http://127.0.0.1:7897/ ' })
  await search('key', '', '电影')
  expect(routes).toEqual(['http://127.0.0.1:7897', 'http://127.0.0.1:7897', undefined])
})

test('explicit proxy failures never cause an unproxied attempt or expose credentials', async () => {
  const routes: Array<string | undefined> = []
  const search = createTmdbSearch(async (url, init) => {
    routes.push(init?.proxy)
    throw new Error(`${url} via ${init?.proxy}`)
  })
  const proxy = 'http://user:private-password@localhost:7897'
  let message = ''
  try { await search('private-key', '', '电影', { proxy }) }
  catch (e) { message = String(e) }
  expect(routes).toEqual([proxy, proxy])
  expect(message).toContain('通过代理连接 TMDB')
  expect(message).not.toContain('private-password')
  expect(message).not.toContain('private-key')
})

test('proxy setting accepts HTTP(S) endpoints and rejects PAC URLs or invalid protocols', () => {
  expect(normalizeTmdbProxy('  ')).toBe('')
  expect(normalizeTmdbProxy(' http://127.0.0.1:7897/ ')).toBe('http://127.0.0.1:7897')
  expect(normalizeTmdbProxy('https://proxy.example:8443')).toBe('https://proxy.example:8443')
  for (const value of ['127.0.0.1:7897', 'socks5://127.0.0.1:7897', 'http://localhost:52882/commands/pac']) {
    expect(() => normalizeTmdbProxy(value)).toThrow('HTTP/HTTPS')
  }
})
