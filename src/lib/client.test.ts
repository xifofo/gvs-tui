import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GwClient } from './client'
import { fetchGateway, fetchRemote, isProxyEnvKey } from './proxy'

let originalProxy: string | undefined
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined
beforeEach(() => {
  originalProxy = process.env.GVS_PROXY
  delete process.env.GVS_PROXY
})
afterEach(() => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
  if (originalProxy === undefined) delete process.env.GVS_PROXY
  else process.env.GVS_PROXY = originalProxy
})

test('gateway API uses the saved proxy for authentication and takes edits on the next request', async () => {
  const routes: unknown[] = []
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    routes.push((init as RequestInit & { proxy?: string })?.proxy)
    return Response.json({ code: 0, data: { id: 'key' } })
  }, { preconnect: fetch.preconnect }))
  const cfg = { gatewayProxy: 'http://localhost:7897' }
  const client = new GwClient('https://gateway.example', 'test-key', () => cfg.gatewayProxy)
  expect((await client.keyInfo()).id).toBe('key')
  cfg.gatewayProxy = 'http://localhost:7898'
  await client.keyInfo()
  cfg.gatewayProxy = ''
  await client.keyInfo()
  expect(routes).toEqual(['http://localhost:7897', 'http://localhost:7898', undefined])
})

test('environment override wins, local gateways bypass proxy, and unrelated requests stay separate', async () => {
  const routes: unknown[] = []
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    routes.push((init as RequestInit & { proxy?: string })?.proxy)
    return Response.json({ code: 0, data: {} })
  }, { preconnect: fetch.preconnect }))
  process.env.GVS_PROXY = 'http://localhost:8888'
  await new GwClient('https://gateway.example', 'key', 'http://localhost:7897').keyInfo()
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    await new GwClient(`http://${host}:8080`, 'key', 'http://localhost:7897').keyInfo()
  }
  delete process.env.GVS_PROXY
  await fetchRemote('https://api.tmdb.org/test')
  expect(routes).toEqual(['http://localhost:8888', undefined, undefined, undefined, undefined])
})

test('a failed gateway proxy makes no direct retry and does not expose proxy credentials', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('failed via http://user:private-secret@localhost:7897'))
  await expect(fetchGateway('https://gateway.example/v1/key', {}, 'http://user:private-secret@localhost:7897'))
    .rejects.toThrow(/^无法通过代理连接网关，请检查代理是否运行及分流规则（F4 → 连接 → 网关代理）$/)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  await expect(fetchGateway('https://gateway.example/v1/key', {}, 'http://localhost/proxy.pac'))
    .rejects.toThrow('HTTP/HTTPS')
  expect(fetchSpy).toHaveBeenCalledTimes(1)
})

test('HTTP denial is returned intact; aborts do not retry', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('blocked', { status: 403 }))
  expect((await fetchGateway('https://gateway.example', {}, 'http://localhost:7897')).status).toBe(403)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  const abort = new DOMException('aborted', 'AbortError')
  fetchSpy.mockRejectedValue(abort)
  await expect(fetchGateway('https://gateway.example', {}, 'http://localhost:7897')).rejects.toBe(abort)
  expect(fetchSpy).toHaveBeenCalledTimes(2)
})

test('a fresh process loads the saved gateway proxy without any proxy environment variable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-gateway-proxy-'))
  const requests: string[] = []
  const proxy = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      requests.push(req.url)
      return Response.json({ code: 0, data: { id: 'persisted-proxy' } })
    },
  })
  try {
    mkdirSync(join(dir, 'gvs'))
    writeFileSync(join(dir, 'gvs', 'tui.json'), JSON.stringify({
      host: 'http://gateway.invalid', key: 'test-key', gatewayProxy: `http://127.0.0.1:${proxy.port}`,
    }))
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !isProxyEnvKey(k) && !['GVS_PROXY', 'GVS_HOST', 'GVS_KEY', 'APPDATA', 'NO_PROXY', 'no_proxy'].includes(k))) as Record<string, string>
    const child = Bun.spawn([process.execPath, '--eval', `
      import { loadConfig } from './src/lib/config.ts';
      import { GwClient } from './src/lib/client.ts';
      const cfg = loadConfig();
      const client = new GwClient(cfg.host, cfg.key, () => cfg.gatewayProxy);
      console.log((await client.keyInfo()).id);
    `], { cwd: join(import.meta.dir, '../..'), env: { ...env, XDG_CONFIG_HOME: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(error).toBe('')
    expect(status).toBe(0)
    expect(output.trim()).toBe('persisted-proxy')
    expect(requests).toEqual(['http://gateway.invalid/v1/key'])
  } finally {
    proxy.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
}, 10000)
