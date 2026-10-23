import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlutoFishConnection } from './connection.ts'
import { normalizePlutoFishURL, verifyPublisher, type PublisherFetch } from './client.ts'
import { loadPlutoFishConfig, savePlutoFishConfig } from './config.ts'
import { assertDesktopAccess } from './access.ts'
import { ConnectionForm } from './tui-form.ts'
import { verifiedGatewayKey } from './gateway.ts'
import { PublisherError, retryableError, retryAfter, retryDelay, transportError } from './retry.ts'

const publisher = { id: 'publisher-1', name: '下载器', kind: 'publisher' as const, sourceAccount: { id: 'source-1', name: '源账号', alias: 'main' } }
const input = { url: 'https://pf.example', key: 'test-private-key' }
const active: PlutoFishConnection[] = []
afterEach(() => { active.splice(0).forEach(c => c.close()) })
function connection(options: ConstructorParameters<typeof PlutoFishConnection>[0] = {}) {
  const c = new PlutoFishConnection({ load: () => ({ ...input }), save: () => {}, verify: async () => publisher, ...options })
  active.push(c)
  return c
}

test('saved credentials are unverified at startup; only a valid identity unlocks entry', async () => {
  const c = connection()
  expect(c.ready).toBe(false)
  expect(() => c.assertReady()).toThrow()
  expect(c.view().hasKey).toBe(true)
  expect(JSON.stringify(c.view())).not.toContain(input.key)
  await c.verify()
  expect(c.ready).toBe(true)
  expect(c.view().identity).toEqual(publisher)
  expect(connection().ready).toBe(false)
})

test('blank key reuses credentials only for the same server, failed replacement never persists', async () => {
  let saved = 0, calls = 0
  const c = connection({ save: () => { ++saved }, verify: async () => { ++calls; return publisher } })
  await c.verify({ url: input.url + '/', key: '' })
  expect(saved).toBe(1)
  await expect(c.verify({ url: 'https://another.example', key: '' })).rejects.toThrow('请填写')
  expect(c.ready).toBe(false)
  expect(calls).toBe(1)
  expect(saved).toBe(1)
})

test('invalid key, network failure, and corrupt configuration never unlock', async () => {
  const c = connection({ verify: async () => { throw new Error('PlutoFish 密钥无效') } })
  await expect(c.verify()).rejects.toThrow('密钥无效')
  expect(c.ready).toBe(false)
  expect(c.view().identity).toBeNull()
  const broken = connection({ load: () => { throw new Error('private filesystem detail') } })
  expect(broken.view().error).toBe('PlutoFish 配置读取失败，请重新填写连接信息')
  expect(broken.ready).toBe(false)
})

test('late responses cannot overwrite a newer failure or re-open a closed connection', async () => {
  let resolve!: (value: typeof publisher) => void
  let calls = 0
  const c = connection({ verify: async () => {
    if (++calls === 1) return new Promise(r => { resolve = r })
    throw new Error('已撤销')
  } })
  const first = c.verify().catch(() => {})
  await expect(c.verify()).rejects.toThrow('已撤销')
  resolve(publisher)
  await first
  expect(c.ready).toBe(false)
  expect(c.view().error).toBe('已撤销')
  const d = connection({ verify: async () => new Promise(r => { resolve = r }) })
  const pending = d.verify().catch(() => {})
  d.close()
  resolve(publisher)
  await pending
  expect(d.ready).toBe(false)
})

test('periodic revalidation locks entry after revocation and does not automatically unlock', async () => {
  let calls = 0
  const c = connection({ intervalMs: 5, verify: async () => { if (++calls > 1) throw new Error('已撤销'); return publisher } })
  await c.verify()
  c.monitor()
  await Bun.sleep(25)
  expect(c.ready).toBe(false)
  expect(calls).toBe(2)
})

test('HTTP client targets only publisher/me, sends no cookies and refuses redirects', async () => {
  let called = false
  const request = (async (url: string, init: RequestInit) => {
    called = true
    expect(url).toBe('https://pf.example/api/v1/publisher/me')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-private-key', Accept: 'application/json' })
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    return Response.json(publisher)
  }) as PublisherFetch
  expect(await verifyPublisher(input, undefined, request)).toEqual(publisher)
  expect(called).toBe(true)
})

test.each([401, 403, 500, 302])('HTTP %s cannot authenticate and does not echo response secrets', async status => {
  const request = (async () => new Response(input.key, { status })) as PublisherFetch
  try { await verifyPublisher(input, undefined, request); throw new Error('unexpected success') }
  catch (error) { expect(String(error)).not.toContain(input.key); expect(String(error)).not.toContain('unexpected success') }
})

test('rejects generic health responses and non-JSON pages even with HTTP 200', async () => {
  for (const response of [Response.json({ status: 'ready' }), new Response('<html>login</html>'), Response.json({ ...publisher, sourceAccount: null })]) {
    await expect(verifyPublisher(input, undefined, (async () => response) as PublisherFetch)).rejects.toThrow()
  }
  await expect(verifyPublisher(input, undefined, (async () => Response.json({ id: 'resource-publisher', name: '已移除的身份', kind: 'legacy', sourceAccount: null })) as PublisherFetch)).rejects.toThrow('身份响应格式不正确')
})

test('transport failures redact sensitive URL and request details', async () => {
  await expect(verifyPublisher(input, undefined, (async () => { throw new Error(input.key) }) as PublisherFetch)).rejects.toThrow('无法连接 PlutoFish')
  for (const url of ['http://public.example', 'https://user:secret@pf.example', 'https://pf.example?token=private', 'https://pf.example#private']) expect(() => normalizePlutoFishURL(url)).toThrow()
  expect(normalizePlutoFishURL('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
})

test('credentials are isolated, saved privately and never include verified state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plutofish-config-test-'))
  try {
    const path = join(dir, 'plutofish.json')
    savePlutoFishConfig(input, path)
    expect(loadPlutoFishConfig(path)).toEqual(input)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).not.toContain('verified')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('IPC and terminal fields cannot turn a saved key into admission', () => {
  for (const method of ['enqueue', 'resumeJob', 'retryJob', 'resumeAll', 'checkSubscriptions', 'saveSettings', 'catalog']) {
    expect(() => assertDesktopAccess(method, false)).toThrow()
    expect(() => assertDesktopAccess(method, true)).not.toThrow()
  }
  for (const method of ['state', 'setup', 'pauseAll']) expect(() => assertDesktopAccess(method, false)).not.toThrow()
  const form = new ConnectionForm(input.url)
  form.tab(); form.secret('connectionSecretAppend', input.key)
  form.tab(); form.tab(); form.secret('connectionSecretAppend', 'publisher-private')
  expect(form.view().field).toBe(3)
  expect(JSON.stringify(form.view())).not.toContain(input.key)
  expect(form.view().keyLength).toBe(17)
  form.tab(); expect(form.view().field).toBe(0)
  form.clearSecrets(); expect(form.view().gatewayKeyLength).toBe(0)
})


test('gateway must return a key identity, not merely a successful envelope', async () => {
  for (const response of [{}, null, { id: '1', name: 'gateway', scope: [], all: 'true' }]) {
    await expect(verifiedGatewayKey({ keyInfo: async () => response as never })).rejects.toThrow('有效的 Key 身份')
  }
})

async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 200; i++) { if (ready()) return; await Bun.sleep(5) }
  throw new Error('连接未恢复')
}

test('自动连接在离线启动和后台断网后恢复，健康检查单次完成后才继续', async () => {
  let offline = true, calls = 0, inflight = 0, maximum = 0
  const c = connection({ autoReconnect: true, intervalMs: 5, retryBaseMs: 10, retryMaxMs: 20,
    verify: async (_input, signal) => {
      calls++; maximum = Math.max(maximum, ++inflight)
      try { await Bun.sleep(20); signal?.throwIfAborted(); if (offline) throw new PublisherError('断网', true); return publisher }
      finally { inflight-- }
    },
  })
  await expect(c.verify()).rejects.toThrow('断网')
  expect(c.view().reconnect?.attempt).toBe(1)
  await waitFor(() => c.view().reconnect?.attempt === 2)
  expect(c.ready).toBe(false)
  expect(retryableError((() => { try { c.assertReady() } catch (e) { return e } })())).toBe(true)
  offline = false
  await waitFor(() => c.ready)
  expect(c.view().reconnect).toBeUndefined()
  offline = true
  await waitFor(() => !!c.view().reconnect)
  offline = false
  await waitFor(() => c.ready)
  expect(maximum).toBe(1)
  c.close(); const stopped = calls
  await Bun.sleep(50)
  expect(calls).toBe(stopped)
})

test('新地址自动恢复只重试新凭据，成功前不保存；主动换连接撤销旧重试', async () => {
  let offline = true
  const seen: string[] = [], saved: unknown[] = []
  const c = connection({ autoReconnect: true, retryBaseMs: 10, save: value => { saved.push(value) }, verify: async value => {
    seen.push(value.url)
    if (offline) throw new PublisherError('断网', true)
    return publisher
  } })
  await expect(c.verify({ url: 'https://new.example', key: 'new-secret' })).rejects.toThrow()
  expect(saved).toHaveLength(0)
  offline = false
  await waitFor(() => c.ready)
  expect(seen).toEqual(['https://new.example', 'https://new.example'])
  expect(saved).toEqual([{ url: 'https://new.example', key: 'new-secret' }])
  expect(JSON.stringify(c.view())).not.toContain('new-secret')
  offline = true
  await expect(c.verify()).rejects.toThrow()
  offline = false
  await c.verify({ url: 'https://last.example', key: 'last-secret' })
  await Bun.sleep(40)
  expect(seen.at(-1)).toBe('https://last.example')
  expect(seen.filter(url => url === 'https://last.example')).toHaveLength(1)
})

test.each([401, 403, 404])('HTTP %s 停止自动重连；重新填写后可恢复', async status => {
  let calls = 0, fixed = false
  const c = connection({ autoReconnect: true, retryBaseMs: 5, verify: (value, signal) => verifyPublisher(value, signal, async () => {
    calls++; return fixed ? Response.json(publisher) : Response.json({}, { status })
  }) })
  await expect(c.verify()).rejects.toThrow()
  expect(c.view().reconnect).toBeUndefined()
  await Bun.sleep(30); expect(calls).toBe(1)
  fixed = true; await c.verify(); expect(c.ready).toBe(true)
})

test('临时 HTTP、套接字和超时可重试，权限、证书、文件和取消错误不重试', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    try { await verifyPublisher(input, undefined, async () => Response.json({}, { status, headers: { 'Retry-After': '12' } })); throw new Error('unexpected') }
    catch (e) { expect(retryableError(e)).toBe(true); expect((e as PublisherError).retryAfterMs).toBe(12000) }
  }
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET']) {
    expect(transportError(new TypeError('private', { cause: { code } })).retryable).toBe(true)
  }
  for (const code of ['ENOENT', 'EACCES', 'ENOSPC', 'CERT_HAS_EXPIRED']) {
    expect(transportError(new TypeError('private', { cause: { code } })).retryable).toBe(false)
  }
  expect(retryableError(new SyntaxError('invalid JSON'))).toBe(false)
  expect(() => transportError(new TypeError('aborted'), AbortSignal.abort())).toThrow()
  expect([1, 2, 3, 20].map(n => retryDelay(n, 5000, 60000))).toEqual([5000, 10000, 20000, 60000])
  expect(retryAfter(new Response('', { headers: { 'Retry-After': 'invalid' } }))).toBeUndefined()
})

test('IPv4/IPv6 聚合网络错误自动恢复，证书和未知错误不被当成临时断网', async () => {
  const network = () => new TypeError('private transport details', { cause: new AggregateError([
    Object.assign(new Error('private address'), { code: 'ENETUNREACH' }),
    Object.assign(new Error('private address'), { code: 'ETIMEDOUT' }),
  ]) })
  expect(transportError(network()).retryable).toBe(true)
  for (const error of [new Error('unknown'), Object.assign(new Error('certificate'), { code: 'CERT_HAS_EXPIRED' })]) {
    expect(transportError(new TypeError('fetch failed', { cause: new AggregateError([
      Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), error,
    ]) })).retryable).toBe(false)
  }
  let calls = 0
  const c = connection({ autoReconnect: true, retryBaseMs: 5, verify: (value, signal) => verifyPublisher(value, signal, async () => {
    if (++calls === 1) throw network()
    return Response.json(publisher)
  }) })
  await expect(c.verify()).rejects.toThrow('无法连接')
  expect(c.view().reconnect?.attempt).toBe(1)
  await waitFor(() => c.ready)
  expect(calls).toBe(2)
  expect(c.view().reconnect).toBeUndefined()
})
