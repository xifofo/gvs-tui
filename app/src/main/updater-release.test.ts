import { test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  DesktopReleaseClient, RELEASES_API, RELEASES_ATOM, RELEASES_URL,
  newer, parseReleaseAtom, parseReleaseList, readReleaseCache, releaseFromURL, retryTime,
  type ReleaseCache,
} from './updater-release'
import { downloadFailureMessage, failedCheckState } from './updater-state'
import type { UpdateState } from '../shared/api'

const row = (version: string, patch: Record<string, unknown> = {}) => ({
  tag_name: `desktop-v${version}`, html_url: `${RELEASES_URL}/tag/desktop-v${version}`,
  draft: false, prerelease: false, ...patch,
})
const json = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init)
const atom = (...urls: string[]) => `<feed xmlns="http://www.w3.org/2005/Atom">${urls.map(url => `<entry><link rel="alternate" type="text/html" href="${url}"/></entry>`).join('')}</feed>`
const update: UpdateState = { status: 'idle', version: '', current: '0.1.39', percent: 0, message: '', url: '', auto: true }

test('release selection requires explicit published stable metadata and a matching canonical desktop tag', () => {
  const latest = parseReleaseList([
    row('0.1.40'), row('0.2.0'), row('0.1.99'),
    row('9.0.0', { prerelease: true }), row('8.0.0', { draft: true }),
    row('7.0.0', { prerelease: undefined }), row('6.0.0', { html_url: 'https://evil.example/releases/tag/desktop-v6.0.0' }),
    row('5.0.0', { tag_name: 'v5.0.0' }), row('4.0.0-beta.1'), row('03.0.0'),
  ])
  assert.equal(latest?.version, '0.2.0')
  assert.equal(newer('0.1.40', '0.1.39'), true)
  assert.equal(newer('0.1.40', '0.1.40-beta.2'), true)
  assert.equal(newer('0.1.40', '0.1.40'), false)
  assert.equal(newer('0.1.40-beta.1', '0.1.39'), false)
  assert.throws(() => parseReleaseList({ message: 'API rate limit exceeded' }))
})

test('release links reject other repositories, credentials, queries, paths and encoded or prerelease tags', () => {
  for (const url of [
    'http://github.com/xifofo/gvs-tui/releases/tag/desktop-v1.0.0',
    'https://github.com.evil.example/xifofo/gvs-tui/releases/tag/desktop-v1.0.0',
    'https://github.com/my-name-is-alan/gvs-tui/releases/tag/desktop-v1.0.0',
    'https://github.com/other/gvs-tui/releases/tag/desktop-v1.0.0',
    'https://user:secret@github.com/xifofo/gvs-tui/releases/tag/desktop-v1.0.0',
    `${RELEASES_URL}/tag/desktop-v1.0.0?redirect=evil`, `${RELEASES_URL}/tag/desktop-v1.0.0#fragment`,
    `${RELEASES_URL}/tag/desktop-v1.0.0/asset.exe`, `${RELEASES_URL}/tag/desktop-v1.0.0-rc.1`,
    `${RELEASES_URL}/tag/desktop-v%31.0.0`, `${RELEASES_URL}/tag/desktop-v9007199254740993.0.0`,
  ]) assert.equal(releaseFromURL(url), null, url)
})

test('Atom only extracts canonical entry links and never trusts release-note links as metadata', () => {
  const text = atom(`${RELEASES_URL}/tag/desktop-v0.1.41`, `${RELEASES_URL}/tag/v99.0.0`, `${RELEASES_URL}/tag/desktop-v8.0.0-rc.1`)
    .replace('</entry>', `<content type="html"><link rel="alternate" href="${RELEASES_URL}/tag/desktop-v99.0.0"/></content></entry>`)
  assert.equal(parseReleaseAtom(text)?.version, '0.1.41')
  assert.throws(() => parseReleaseAtom('<html>Sign in</html>'))
  assert.throws(() => parseReleaseAtom('<!DOCTYPE feed []>' + text))
})

test('concurrent checks share one request, successful results are cached, and later checks use ETag', async () => {
  let now = 1_000_000
  const calls: Array<{ url: string; init: RequestInit }> = []
  let finish!: (r: Response) => void
  let saved: ReleaseCache | undefined
  const client = new DesktopReleaseClient({ now: () => now, save: cache => { saved = cache }, fetch: (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve(new Response(null, { status: 304 }))
  } })
  const first = client.check(true)
  const second = client.check(true)
  assert.equal(first, second)
  finish(json([row('0.1.40')], { headers: { etag: '"release-40"' } }))
  assert.equal((await first).release?.version, '0.1.40')
  assert.equal((await client.check(true)).verified, true)
  assert.equal(calls.length, 1)
  now += 61_000
  assert.equal((await client.check(true)).release?.version, '0.1.40')
  assert.equal(new Headers(calls[1]!.init.headers).get('if-none-match'), '"release-40"')
  assert.equal(saved?.api?.checkedAt, now)
  assert.equal(calls[1]!.init.redirect, 'error')
  assert.equal(calls[1]!.init.credentials, 'omit')
})

test('403 honors rate-limit reset, uses the official Atom feed, and does not authorize an unverified stable-looking release', async () => {
  let now = 1_000_000
  let saved: ReleaseCache | undefined
  const calls: string[] = []
  const client = new DesktopReleaseClient({ now: () => now, save: cache => { saved = cache }, fetch: async url => {
    calls.push(url)
    return url === RELEASES_API
      ? json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4600' } })
      : new Response(atom(`${RELEASES_URL}/tag/desktop-v0.1.99`))
  } })
  const result = await client.check(true)
  assert.deepEqual(calls, [RELEASES_API, RELEASES_ATOM])
  assert.equal(result.verified, false)
  assert.equal(result.release, null)
  assert.equal(result.url, `${RELEASES_URL}/tag/desktop-v0.1.99`)
  assert.match(result.message, /403.*60 分钟.*尚未确认正式版/)
  now += 60_000
  await client.check(true)
  assert.equal(calls.length, 2)
  let restartedCalls = 0
  const restarted = new DesktopReleaseClient({ cache: saved, now: () => now, fetch: async () => { restartedCalls++; throw Error('must not request during persisted backoff') } })
  assert.equal((await restarted.check(true)).verified, false)
  assert.equal(restartedCalls, 0)
})

test('429 waits for Retry-After and rate limits never turn failed or empty fallback feeds into latest', async () => {
  for (const feedResponse of [new Response('bad gateway', { status: 503 }), new Response(atom())]) {
    const client = new DesktopReleaseClient({ now: () => 10_000, fetch: async url => url === RELEASES_API
      ? new Response('', { status: 429, headers: { 'retry-after': '600' } }) : feedResponse })
    const result = await client.check(true)
    assert.equal(result.verified, false)
    assert.equal(result.release, null)
    assert.match(result.message, /429.*10 分钟/)
    assert.equal(result.url, RELEASES_URL)
  }
  assert.equal(retryTime(new Headers({ 'retry-after': 'Thu, 01 Jan 1970 00:10:00 GMT' }), 1000, 1), 600_000)
  assert.equal(retryTime(new Headers(), 1000, 3), 241_000)
})

test('timeouts abort the request, give an actionable message, and do not immediately retry on another check', async () => {
  let calls = 0
  let aborted = false
  const client = new DesktopReleaseClient({ timeoutMs: 10, fetch: async (_url, init) => {
    calls++
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => {
      aborted = true
      reject(new Error('aborted'))
    }))
  } })
  const result = await client.check(true)
  assert.equal(aborted, true)
  assert.equal(result.verified, false)
  assert.match(result.message, /超时/)
  await client.check(true)
  assert.equal(calls, 1)
})

test('fresh disk cache avoids startup requests, corrupt caches cannot become verified releases', async () => {
  const now = 1_000_000
  const release = releaseFromURL(`${RELEASES_URL}/tag/desktop-v0.1.40`)!
  const cache: ReleaseCache = { schema: 1, api: { etag: 'v40', checkedAt: now, release }, atom: null, failures: 0, retryAt: 0, failureMessage: '', atomAllowed: false }
  const client = new DesktopReleaseClient({ cache, now: () => now, fetch: async () => { throw Error('fresh cache must not fetch') } })
  assert.equal((await client.check()).release?.version, '0.1.40')
  const corrupt = { ...cache, api: { ...cache.api!, release: { ...release, url: 'https://evil.example/installer' } } }
  assert.equal(readReleaseCache(corrupt, now).api, null)
  assert.equal(readReleaseCache({ ...cache, api: { ...cache.api!, checkedAt: now + 999_999 } }, now).api, null)
})

test('304 without cached data and API error JSON with status 200 remain failures', async () => {
  for (const response of [new Response(null, { status: 304 }), json({ message: 'API rate limit exceeded' })]) {
    const client = new DesktopReleaseClient({ fetch: async () => response })
    assert.equal((await client.check(true)).verified, false)
  }
})

test('a successful list containing only terminal or prerelease versions cannot claim the desktop is latest', async () => {
  const client = new DesktopReleaseClient({ fetch: async () => json([
    row('0.9.0', { tag_name: 'v0.9.0' }), row('0.2.0', { prerelease: true }),
  ]) })
  const result = await client.check(true)
  assert.equal(result.verified, false)
  assert.equal(result.release, null)
  assert.match(result.message, /未找到桌面正式版/)
})

test('background failures preserve actionable state and manual failures expose a trusted official URL', () => {
  const available: UpdateState = { ...update, status: 'available', version: '0.1.40', url: `${RELEASES_URL}/tag/desktop-v0.1.40` }
  const checking: UpdateState = { ...update, status: 'checking' }
  assert.deepEqual(failedCheckState(available, checking, false, 'GitHub 403', RELEASES_URL), available)
  assert.deepEqual(failedCheckState(update, checking, false, 'GitHub 403', RELEASES_URL), update)
  for (const status of ['ready', 'downloading'] as const) {
    const current = { ...available, status }
    assert.deepEqual(failedCheckState(update, current, true, 'GitHub 403', RELEASES_URL), current)
  }
  const error = failedCheckState(update, checking, true, 'GitHub 更新检查达到请求限额（403）。', RELEASES_URL)
  assert.equal(error.status, 'error')
  assert.match(error.message, /403/)
  assert.equal(error.url, RELEASES_URL)
  assert.match(downloadFailureMessage(new Error('sha512 checksum mismatch')), /完整性校验失败，未安装/)
})
