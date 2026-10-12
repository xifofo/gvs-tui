import { expect, test } from 'bun:test'
import { createIQCatalogMode, iqTaiwanCatalog, isIQCatalogRequest } from './iq-catalog-mode.ts'
import { createIQSourceRoute } from '../../app/src/main/iq-auth-proxy.ts'

const page = (mod: string) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { initialState: { language: { modeLangObj: { mod, lang: 'zh_tw' } } } },
})}</script>`
const search = 'https://pcw-api.iq.com/api/search2?key=Dragon+Ball+Super&langCode=zh_cn&modeCode=intl&ps=20'
const episodes = 'https://pcw-api.iq.com/api/v2/episodeListSource/3182693271604201?modeCode=intl&startOrder=1&endOrder=199&langCode=zh_cn'

test('public site catalog detection distinguishes Taiwan from the page language', () => {
  expect(iqTaiwanCatalog(page('ntw'))).toBe(true)
  expect(iqTaiwanCatalog(page('sg'))).toBe(false)
  expect(() => iqTaiwanCatalog('<html>ip_restriction</html>')).toThrow()
  expect(() => iqTaiwanCatalog('<script id="__NEXT_DATA__">{"props":{}}</script>')).toThrow()
})

test('Taiwan exit fixes search and episode catalogs while preserving keyword, language and pagination', async () => {
  const requests: string[] = []
  const logs: string[] = []
  const mode = createIQCatalogMode({ log: line => logs.push(line) })
  const fetcher = async (url: string, init: RequestInit) => {
    requests.push(url)
    expect(url).toBe('https://www.iq.com/')
    expect(new Headers(init.headers).get('cookie')).toBeNull()
    expect(new Headers(init.headers).get('authorization')).toBeNull()
    expect(init.redirect).toBe('manual')
    return new Response(page('ntw'))
  }
  const input = { headers: { cookie: 'PRIVATE_COOKIE', authorization: 'PRIVATE_AUTH' } }
  const [first, second] = await Promise.all([
    mode(search, input, 'proxy-a', fetcher), mode(episodes, input, 'proxy-a', fetcher),
  ])
  expect(requests).toHaveLength(1)
  expect(new URL(first).searchParams.get('modeCode')).toBe('ntw')
  expect(new URL(first).searchParams.get('key')).toBe('Dragon Ball Super')
  expect(new URL(first).searchParams.get('langCode')).toBe('zh_cn')
  expect(new URL(first).searchParams.get('ps')).toBe('20')
  expect(new URL(second).searchParams.get('modeCode')).toBe('ntw')
  expect(new URL(second).searchParams.get('startOrder')).toBe('1')
  expect(logs.join('\n')).not.toContain('PRIVATE')
})

test('source modes refresh after a node switch and are isolated by proxy address', async () => {
  let clock = 0, current = 'ntw', calls = 0
  const mode = createIQCatalogMode({ log: () => {}, now: () => clock })
  const fetcher = async () => { calls++; return new Response(page(current)) }
  expect(new URL(await mode(search, {}, 'proxy-a', fetcher)).searchParams.get('modeCode')).toBe('ntw')
  current = 'sg'
  expect(await mode(search, {}, 'proxy-b', fetcher)).toBe(search)
  clock = 60_001
  expect(await mode(search, {}, 'proxy-a', fetcher)).toBe(search)
  expect(calls).toBe(3)
})

test('catalog adjustment leaves playback, login, other providers and signed requests alone', async () => {
  const mode = createIQCatalogMode({ log: () => {} })
  const fetcher = async () => { throw new Error('must not detect a catalog here') }
  const inputs = [
    ['https://pcw-api.iq.com/api/search2?modeCode=ntw', {}],
    [search, { method: 'POST', body: 'PRIVATE_BODY' }],
    [search + '&vf=PRIVATE_SIGN', {}],
    ['https://pcw-api.iq.com.example.test/api/search2?modeCode=intl', {}],
    ['https://pcw-api.iq.com/api/v2/episodeListSource/not-a-number?modeCode=intl', {}],
    ['https://intl-passport.iqiyi.com/login?modeCode=intl', {}],
    ['https://cache.inter.iqiyi.com/dash?modeCode=intl', {}],
    ['https://pcw-api.iqiyi.com/api/search2?modeCode=intl', {}],
    ['https://v.qq.com/api/search2?modeCode=intl', {}],
  ] as const
  for (const [url, init] of inputs) {
    expect(isIQCatalogRequest(new URL(url), init)).toBe(false)
    expect(await mode(url, init, 'proxy-a', fetcher)).toBe(url)
  }
})

test('failed region detection preserves the original request and respects cancellation', async () => {
  const mode = createIQCatalogMode({ log: () => {} })
  expect(await mode(search, {}, 'proxy-a', async () => new Response('', { status: 302 }))).toBe(search)
  const controller = new AbortController()
  const result = mode(search, { signal: controller.signal }, 'proxy-b', async () => {
    controller.abort(new Error('cancelled'))
    return new Response(page('ntw'))
  })
  await expect(result).rejects.toThrow('cancelled')
})

test('desktop route forwards the corrected catalog with the original request headers and proxy', async () => {
  const requests: Array<{ url: string; init: RequestInit; proxy: string }> = []
  const route = createIQSourceRoute({
    configuredProxy: () => 'http://127.0.0.1:7897',
    resolveProxy: async () => { throw new Error('must use the configured proxy') }, log: () => {},
    fetch: async (url, init, proxy) => {
      requests.push({ url, init, proxy })
      return new Response(url === 'https://www.iq.com/' ? page('ntw') : '{"code":"0"}')
    },
  })
  const fetcher = await route(new URL(search))
  await fetcher!(search, { headers: { cookie: 'PRIVATE_COOKIE' }, redirect: 'manual' })
  expect(requests).toHaveLength(2)
  expect(new URL(requests[1]!.url).searchParams.get('modeCode')).toBe('ntw')
  expect(new Headers(requests[1]!.init.headers).get('cookie')).toBe('PRIVATE_COOKIE')
  expect(requests[1]!.init.redirect).toBe('manual')
  expect(requests[1]!.proxy).toBe('http://127.0.0.1:7897')
})
