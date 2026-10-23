/** 目录请求通过本地 HTTP 夹具验证凭据边界、字符串 ID 与换绑中的过期响应。 */
import { afterEach, expect, test } from 'bun:test'
import { PlutoFishConnection } from './connection.ts'
import type { PublisherIdentity } from './types.ts'

const publisher: PublisherIdentity = { id: 'publisher', kind: 'publisher', name: '目录端', sourceAccount: { id: 'source', name: '源账号', alias: 'main' } }
const page = { sourceAccountId: 'source', path: [{ id: '0', name: '根目录' }, { id: '9007199254740993', name: '红果' }], items: [], nextCursor: '' }
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })

async function fixture(handler: (request: Request) => Response | Promise<Response>) {
  let identity = structuredClone(publisher)
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler })
  const connection = new PlutoFishConnection({ load: () => ({ url: server.url.origin, key: 'private-publisher-token' }), verify: async () => identity })
  cleanup.push(() => { connection.close(); server.stop(true) })
  await connection.verify()
  return { connection, rebind: async () => { identity = { ...publisher, sourceAccount: { id: 'other', name: '新账号', alias: 'other' } }; await connection.verify() } }
}

test('浏览绑定源网盘发送发布端 Token，超大目录 ID 与分页参数保持字符串', async () => {
  const f = await fixture(async request => {
    expect(new URL(request.url).pathname).toBe('/api/v1/publisher/directories')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe('Bearer private-publisher-token')
    expect(request.headers.get('cookie')).toBeNull()
    expect(await request.json()).toEqual({ sourceAccountId: 'source', directoryId: '9007199254740993', cursor: '50' })
    return Response.json(page)
  })
  expect(await f.connection.directories('source', '9007199254740993', '50')).toEqual(page)
  expect(JSON.stringify(f.connection.view())).not.toContain('private-publisher-token')
  await expect(f.connection.directories('other', '0')).rejects.toThrow('绑定源账号')
})

test('目录加载中换绑会丢弃旧账号响应', async () => {
  let release!: () => void
  let started!: () => void
  const start = new Promise<void>(resolve => { started = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(async () => { started(); await wait; return Response.json(page) })
  const pending = f.connection.directories('source', '9007199254740993').then(() => null, error => error as Error)
  await start
  await f.rebind()
  release()
  expect((await pending)?.message).toContain('连接已变更')
})

test('停用发布端锁定入口，网盘凭据过期只显示固定安全错误', async () => {
  let status = 409
  const f = await fixture(() => Response.json({ error: { code: 'CLOUD_REAUTH_REQUIRED', message: 'private-provider-token' } }, { status }))
  await expect(f.connection.directories('source', '0')).rejects.toThrow('凭据已过期')
  expect(f.connection.ready).toBe(true)
  status = 403
  await expect(f.connection.directories('source', '0')).rejects.toThrow('HTTP 403')
  expect(f.connection.ready).toBe(false)
  expect(f.connection.view().identity).toBeNull()
})

test('错账号、路径、非字符串 ID 及重复分页均不能成为目录选择', async () => {
  const invalid = [
    { ...page, sourceAccountId: 'other' }, { ...page, path: [{ id: '0', name: '根目录' }] },
    { ...page, items: [{ id: 9007199254740993, name: '目录' }] }, { ...page, nextCursor: '50' },
  ]
  let value: unknown
  const f = await fixture(() => Response.json(value))
  for (value of invalid) await expect(f.connection.directories('source', '9007199254740993', '50')).rejects.toThrow('目录响应无效')
})

test('创建发送相对目录层级并核验完整路径，不能把本地路径或数字 ID 发给服务端', async () => {
  const names = ['此处通往繁星 (2026) {tmdb-296203}', 'Season 01']
  const created = { ...page, path: [...page.path, { id: '9007199254740994', name: names[0]! }, { id: '9007199254740995', name: names[1]! }] }
  let calls = 0
  const f = await fixture(async request => {
    calls++
    expect(new URL(request.url).pathname).toBe('/api/v1/publisher/directories/create')
    expect(request.headers.get('authorization')).toBe('Bearer private-publisher-token')
    expect(request.headers.get('cookie')).toBeNull()
    expect(await request.json()).toEqual({ sourceAccountId: 'source', directoryId: '9007199254740993', segments: names })
    return Response.json(created)
  })
  expect(await f.connection.createDirectories('source', '9007199254740993', names)).toEqual(created)
  for (const segments of [[], ['..'], ['/Users/xifo/Downloads'], ['a\\b'], ['a\n'], [' 星'], ['星'.repeat(86)], ['a', 'b', 'c', 'd', 'e']]) {
    await expect(f.connection.createDirectories('source', '0', segments)).rejects.toThrow('文件夹名称无效')
  }
  expect(calls).toBe(1)
})

test('创建失败不重发，目录错名、错归属或换绑响应不能被选中', async () => {
  let calls = 0, status = 502
  let value: unknown = { error: { message: 'private-provider-token' } }
  const f = await fixture(() => { calls++; return Response.json(value, { status }) })
  await expect(f.connection.createDirectories('source', '0', ['红果'])).rejects.toThrow('目录创建')
  expect(calls).toBe(1)
  status = 200
  for (value of [ { ...page, sourceAccountId: 'other' }, { ...page, path: [{ id: '0', name: '根目录' }, { id: '2', name: 'wrong' }] },
    { ...page, path: [{ id: '0', name: '根目录' }, { id: '2', name: 'wrong-parent' }, page.path[1]!] } ]) {
    await expect(f.connection.createDirectories('source', '0', ['红果'])).rejects.toThrow('目录')
  }
  let release!: () => void, start!: () => void
  const started = new Promise<void>(r => { start = r }), wait = new Promise<void>(r => { release = r })
  const g = await fixture(async () => { start(); await wait; return Response.json(page) })
  const pending = g.connection.createDirectories('source', '0', ['红果']).catch(e => e as Error)
  await started; await g.rebind(); release()
  expect((await pending as Error).message).toContain('连接已变更')
})

test('重连立即取消未返回的目录请求，旧权限失败不能锁住已恢复连接', async () => {
  let release!: () => void, start!: () => void, calls = 0
  const started = new Promise<void>(r => { start = r }), wait = new Promise<void>(r => { release = r })
  const f = await fixture(async () => {
    if (++calls === 1) { start(); await wait; return Response.json({}, { status: 401 }) }
    return Response.json(page)
  })
  const pending = f.connection.directories('source', '9007199254740993').then(() => null, error => error as Error)
  await started
  f.connection.cancelRequests()
  const error = await Promise.race([pending, Bun.sleep(500).then(() => new Error('旧请求仍在等待'))])
  expect(error?.message).toContain('旧请求已取消')
  await f.connection.verify()
  release()
  expect(await f.connection.directories('source', '9007199254740993')).toEqual(page)
  expect(f.connection.ready).toBe(true)
})

test('定时身份校验成功不会取消进行中的目录读取', async () => {
  let release!: () => void, start!: () => void
  const started = new Promise<void>(r => { start = r }), wait = new Promise<void>(r => { release = r })
  const f = await fixture(async () => { start(); await wait; return Response.json(page) })
  const pending = f.connection.directories('source', '9007199254740993')
  await started
  await f.connection.verify(undefined, true)
  release()
  expect(await pending).toEqual(page)
  expect(f.connection.ready).toBe(true)
})
