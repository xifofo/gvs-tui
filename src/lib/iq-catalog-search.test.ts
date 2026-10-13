import { expect, test } from 'bun:test'
import { createIQCatalogFetch, mergeIQSearchBodies } from './iq-catalog-search.ts'
import { iqCatalogRegion } from './iq-catalog-mode.ts'
import { createIQSourceRoute } from '../../app/src/main/iq-auth-proxy.ts'
import { discoveryRows } from './discovery.ts'

const search = 'https://pcw-api.iq.com/api/search2?key=fixture&langCode=zh_cn&modeCode=intl&pn=2&ps=20'
const page = (mod: string) => `<script id="__NEXT_DATA__">${JSON.stringify({ props: {
  initialState: { language: { modeLangObj: { mod } } },
} })}</script>`
const row = (id: number, name: string) => ({ albumId: id, qipuId: String(id), name })
const body = (epg: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ code: '0', data: {
  code: 0, epg, currentPageNo: 2, total: 80, docs: 80, ...extra,
} })
const response = (epg: Record<string, unknown>[], extra: Record<string, unknown> = {}) => Response.json(body(epg, extra))
const catalog = (options: Parameters<typeof createIQCatalogFetch>[0] = { log: () => {} }) => createIQCatalogFetch(options)

test('catalog union keeps regional metadata and order while retaining distinct editions and standalone films', () => {
  const preferred = body([row(1, '区域标题'), { albumId: 0, qipuId: '11', name: '电影甲' }, row(2, '同名剧')], { marker: 'regional' })
  const supplement = body([row(1, '国际标题'), row(3, '同名剧'), { albumId: '0', qipuId: 12, name: '电影乙' },
    { albumId: 0, qipuId: '11', name: '电影甲' }], { marker: 'international', total: 100, docs: 100 })
  const result = mergeIQSearchBodies(preferred, supplement)
  expect(result.data.epg.map(r => String(r.albumId))).toEqual(['1', '11', '2', '3', '12'])
  expect(result.data.epg.map(r => r.name)).toEqual(['区域标题', '电影甲', '同名剧', '同名剧', '电影乙'])
  expect(result.data.marker).toBe('regional')
  expect(result.data.currentPageNo).toBe(2)
  expect(result.data.total).toBe(100)
  expect(preferred.data.epg[1]!.albumId).toBe(0)
  // The TUI receives distinct film identities from the legacy gateway mapping.
  const normalized = { items: result.data.epg.map(r => ({ id: String(r.albumId), title: r.name })) }
  expect(discoveryRows('iq', normalized)).toHaveLength(5)
})

test('same titles without reliable IDs are retained and unsafe numeric IDs are not invented', () => {
  const result = mergeIQSearchBodies(body([{ albumId: 0, name: '同名' }, { name: '同名' },
    { albumId: 0, qipuId: Number.MAX_SAFE_INTEGER + 1, name: '精度丢失' }]))
  expect(result.data.epg).toHaveLength(3)
  expect(result.data.epg[2]!.albumId).toBe(0)
})

test('Taiwan search requests both catalogs concurrently with the same keyword, pagination, headers and exit', async () => {
  const requests: string[] = [], logs: string[] = []
  let active = 0, peak = 0
  const fetch = catalog({ log: line => logs.push(line) })
  const result = await fetch(search, { headers: { cookie: 'PRIVATE_COOKIE' }, redirect: 'manual' }, 'proxy-a', async (input, init) => {
    requests.push(input)
    const u = new URL(input)
    if (u.pathname === '/') {
      expect(new Headers(init.headers).has('cookie')).toBe(false)
      return new Response(page('ntw'))
    }
    expect(u.searchParams.get('key')).toBe('fixture')
    expect(u.searchParams.get('langCode')).toBe('zh_cn')
    expect(u.searchParams.get('pn')).toBe('2')
    expect(u.searchParams.get('ps')).toBe('20')
    expect(new Headers(init.headers).get('cookie')).toBe('PRIVATE_COOKIE')
    expect(init.redirect).toBe('manual')
    active++; peak = Math.max(peak, active)
    await Bun.sleep(5)
    active--
    return u.searchParams.get('modeCode') === 'ntw' ? response([row(1, '台湾')]) : response([row(2, '国际')])
  })
  expect(requests).toHaveLength(3)
  expect(peak).toBe(2)
  expect((await result.json()).data.epg.map((r: any) => r.albumId)).toEqual([1, 2])
  expect(logs.join('\n')).not.toContain('PRIVATE')
  expect(logs.join('\n')).not.toContain('fixture')
})

test('official current modes outside Taiwan supplement intl, but international mode is fetched once', async () => {
  for (const mod of ['sg', 'hk', 'intl']) {
    const modes: string[] = []
    const result = await catalog()(search, {}, 'proxy', async input => {
      const u = new URL(input)
      if (u.pathname === '/') return new Response(page(mod))
      modes.push(u.searchParams.get('modeCode')!)
      return response([row(1, '节目')])
    })
    expect(modes).toEqual(mod === 'intl' ? ['intl'] : [mod, 'intl'])
    expect((await result.json()).data.epg).toHaveLength(1)
  }
  expect(() => iqCatalogRegion(page('PRIVATE/INVALID'))).toThrow()
})

test('already regional gateway searches supplement intl without rediscovering or overwriting their mode', async () => {
  const modes: string[] = []
  await catalog()(search.replace('modeCode=intl', 'modeCode=ntw'), {}, 'proxy', async input => {
    const u = new URL(input)
    expect(u.pathname).toBe('/api/search2')
    modes.push(u.searchParams.get('modeCode')!)
    return response([row(1, '节目')])
  })
  expect(modes).toEqual(['ntw', 'intl'])
})

test('region detection failures preserve international search and repair zero film IDs', async () => {
  const requests: string[] = []
  const result = await catalog()(search, {}, 'proxy', async input => {
    requests.push(input)
    return new URL(input).pathname === '/' ? new Response('', { status: 302 }) : response([{ albumId: 0, qipuId: '12', name: '电影' }])
  })
  expect(requests).toHaveLength(2)
  expect((await result.json()).data.epg[0].albumId).toBe('12')
})

test('an HTTP or source business error in the primary catalog falls back to the successful international result', async () => {
  for (const failure of [new Response('', { status: 503 }), Response.json({ code: 'E001', data: { epg: [] } }),
    Response.json({ code: '0', data: { code: 'E001', epg: [] } }), new Response('{bad json')]) {
    const result = await catalog()(search, {}, 'proxy', async input => {
      const u = new URL(input)
      if (u.pathname === '/') return new Response(page('ntw'))
      return u.searchParams.get('modeCode') === 'ntw' ? failure : response([row(2, '国际')])
    })
    expect((await result.json()).data.epg[0].albumId).toBe(2)
  }
})

test('a timed out supplement or primary keeps the other successful catalog', async () => {
  for (const failedMode of ['ntw', 'intl']) {
    const result = await catalog({ log: () => {}, searchTimeoutMs: 20 })(search, {}, 'proxy', async (input, init) => {
      const u = new URL(input)
      if (u.pathname === '/') return new Response(page('ntw'))
      if (u.searchParams.get('modeCode') === failedMode) return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      })
      return response([row(1, '可用目录')])
    })
    expect((await result.json()).data.epg).toHaveLength(1)
  }
})

test('both failed catalogs retain the preferred HTTP error, and parent cancellation remains cancellation', async () => {
  const result = await catalog()(search, {}, 'proxy', async input => {
    return new URL(input).pathname === '/' ? new Response(page('ntw')) : new Response('upstream failure', { status: 503 })
  })
  expect(result.status).toBe(503)
  expect(await result.text()).toBe('upstream failure')
  await expect(catalog()(search.replace('modeCode=intl', 'modeCode=ntw'), {}, 'proxy', async () => {
    throw new Error('transport unavailable')
  })).rejects.toThrow('transport unavailable')
  const controller = new AbortController()
  await expect(catalog()(search, { signal: controller.signal }, 'proxy', async input => {
    if (new URL(input).pathname === '/') return new Response(page('ntw'))
    controller.abort(new Error('cancelled'))
    return response([row(1, '节目')])
  })).rejects.toThrow('cancelled')
})

test('the international pagination bound is preserved when the regional directory has ended', async () => {
  const requests: string[] = []
  const result = await catalog()(search, {}, 'proxy', async input => {
    const u = new URL(input)
    if (u.pathname === '/') return new Response(page('ntw'))
    requests.push(u.searchParams.get('pn')!)
    return u.searchParams.get('modeCode') === 'ntw' ? response([], { total: 20, docs: 20 })
      : response([row(2, '国际目录下一页')], { total: 80, docs: 80 })
  })
  const data = (await result.json()).data
  expect(requests).toEqual(['2', '2'])
  expect(data.epg[0].name).toBe('国际目录下一页')
  expect(data.currentPageNo).toBe(2)
  expect(data.total).toBe(80)
})

test('merged body removes stale wire headers but preserves cookies and other response headers', async () => {
  const result = await catalog()(search, {}, 'proxy', async input => {
    if (new URL(input).pathname === '/') return new Response(page('ntw'))
    return new Response(JSON.stringify(body([row(1, '节目')])), { headers: {
      'content-length': '1', 'content-encoding': 'gzip', etag: 'old', 'content-md5': 'old',
      'set-cookie': 'fixture=1', 'x-fixture': 'preserved',
    } })
  })
  for (const header of ['content-length', 'content-encoding', 'etag', 'content-md5']) expect(result.headers.has(header)).toBe(false)
  expect(result.headers.get('set-cookie')).toBe('fixture=1')
  expect(result.headers.get('x-fixture')).toBe('preserved')
})

test('unknown response schemas and oversized rebuilt unions are forwarded without inventing a result shape', async () => {
  const unknown = '{"code":"0","data":{"newSchema":[1]}}'
  const result = await catalog()(search.replace('modeCode=intl', 'modeCode=ntw'), {}, 'proxy', async () => new Response(unknown))
  expect(await result.text()).toBe(unknown)
  const large = JSON.stringify(body([row(1, 'x'.repeat(4 << 20))]))
  const overflow = await catalog()(search.replace('modeCode=intl', 'modeCode=ntw'), {}, 'proxy', async input => {
    return new Response(new URL(input).searchParams.get('modeCode') === 'ntw' ? large : JSON.stringify(body([row(2, 'y'.repeat(4 << 20))])))
  })
  expect(await overflow.text()).toBe(large)
})

test('signed search, playback, login and Taiwan episode lists keep their own existing routing', async () => {
  for (const input of [search + '&vf=PRIVATE_SIGNATURE', search + '&authKey=PRIVATE_AUTH',
    'https://cache-video.iq.com/dash?modeCode=intl', 'https://passport.iq.com/login?modeCode=intl']) {
    const requests: string[] = []
    await catalog()(input, {}, 'proxy', async url => { requests.push(url); return new Response('fixture') })
    expect(requests).toEqual([input])
  }
  const requests: string[] = []
  await catalog()('https://pcw-api.iq.com/api/v2/episodeListSource/12?modeCode=intl', {}, 'proxy', async input => {
    requests.push(input)
    return new URL(input).pathname === '/' ? new Response(page('ntw')) : new Response('fixture')
  })
  expect(requests).toEqual(['https://www.iq.com/', 'https://pcw-api.iq.com/api/v2/episodeListSource/12?modeCode=ntw'])
})

test('desktop source route returns the merged JSON through the same configured proxy', async () => {
  const route = createIQSourceRoute({ configuredProxy: () => 'http://localhost:7897', log: () => {},
    resolveProxy: async () => { throw new Error('unexpected PAC') },
    fetch: async (input, init, proxy) => {
      expect(proxy).toBe('http://localhost:7897')
      if (new URL(input).pathname === '/') return new Response(page('ntw'))
      expect(new Headers(init.headers).get('cookie')).toBe('PRIVATE_COOKIE')
      expect(init.credentials).toBe('omit')
      return response([row(new URL(input).searchParams.get('modeCode') === 'ntw' ? 1 : 2, '节目')])
    },
  })
  const fetcher = await route(new URL(search))
  expect((await (await fetcher!(search, { headers: { cookie: 'PRIVATE_COOKIE' } })).json()).data.epg).toHaveLength(2)
})
