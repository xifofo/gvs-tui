import { expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { AccountStore, type AccountDeps } from './account-store'

function harness(opts: { encrypt?: boolean } = {}) {
  let saved = ''
  const imported: string[] = []
  const deps: AccountDeps = {
    load: () => saved || null,
    save: (j) => { saved = j },
    encrypt: (p) => (opts.encrypt === false ? null : 'enc:' + p),
    decrypt: (c) => c.slice(4),
    importCookie: async (p, c) => { imported.push(`${p}:${c}`) },
    statusOf: () => ({ short: '已登录', summary: '黄金会员 · 到期 2026-12-01', tone: 'ok' }),
    changed: () => {},
    now: () => 1000,
  }
  const s = new AccountStore(deps)
  s.migrate(['iq', 'tencent'])
  return { s, deps, imported, saved: () => saved }
}

test('migration keeps existing gateway session as default; secrets encrypted at rest', async () => {
  const h = harness()
  const v = h.s.view().book
  expect(v.slots.map((x) => x.name)).toEqual(['默认账号', '默认账号'])
  const r = await h.s.add('iq', '副号', 'P00001=abc')
  expect([r.needsLogin, h.imported]).toEqual([false, ['iq:P00001=abc']])
  expect(h.s.activeId('iq')).toBe(r.slot.id)
  expect(h.saved().includes('P00001=abc') && !h.saved().includes('enc:P00001=abc')).toBe(false)
  expect(h.saved().includes('enc:P00001=abc')).toBe(true)
  h.s.recordStatus('iq')
  expect(h.s.view().book.slots.find((x) => x.id === r.slot.id)?.status?.vipUntil).toBe(new Date(2026, 11, 1, 23, 59, 59).getTime())
  // 重新加载
  const again = new AccountStore({ ...h.deps, load: () => h.saved() })
  expect(again.view().book.slots).toHaveLength(3)
})

test('cookie save refused without encryption; qr slot needs login', async () => {
  const h = harness({ encrypt: false })
  let err = ''
  try { await h.s.add('iq', 'x', 'c') } catch (e) { err = (e as Error).message }
  expect(err.includes('无法加密')).toBe(true)
  const q = await h.s.add('iq', '扫码号')
  expect(q.needsLogin).toBe(true)
  expect(h.s.activeId('iq')).toBe(q.slot.id)
})

test('withFallback switches to the next cookie account on Q00505, not on other errors', async () => {
  const h = harness()
  const a = await h.s.add('iq', 'A', 'cookieA')
  const b = await h.s.add('iq', 'B', 'cookieB')
  h.s.setDefault(a.slot.id)
  await h.s.activate(a.slot.id)
  h.imported.length = 0
  let calls = 0
  const switched: string[] = []
  const out = await h.s.withFallback('iq', async () => {
    calls++
    if (h.s.activeId('iq') === a.slot.id) throw new Error('Q00505 会员受限')
    return 'ok'
  }, (s) => switched.push(s.name))
  expect([out, calls, switched, h.imported]).toEqual(['ok', 2, ['B'], ['iq:cookieB']])
  expect(h.s.view().book.slots.find((x) => x.id === a.slot.id)?.status?.tone).toBe('err')
  let thrown = ''
  try { await h.s.withFallback('iq', async () => { throw new Error('网络超时') }) } catch (e) { thrown = (e as Error).message }
  expect(thrown).toBe('网络超时')
  // 指定账号：先切过去
  await h.s.use('iq', a.slot.id, async () => 1)
  expect(h.s.activeId('iq')).toBe(a.slot.id)
  void b
})

function multiHarness() {
  let saved = ''
  const imported: string[] = []
  const calls: string[] = []
  const active: Record<string, string> = {}
  const gwSessions = new Map<string, string>()
  const als = new AsyncLocalStorage<string>() // same mechanism Core.runAsAccount uses
  const current = () => als.getStore() ?? ''
  const deps: AccountDeps = {
    load: () => saved || null,
    save: (j) => { saved = j },
    encrypt: (p) => 'enc:' + p,
    decrypt: (c) => c.slice(4),
    importCookie: async (p, c) => { imported.push(`${p}@${current()}:${c}`); gwSessions.set(current(), c) },
    statusOf: () => ({ short: '已登录', summary: '', tone: 'ok' }),
    changed: () => {},
    now: () => 1000,
    gateway: {
      supports: (p) => p === 'iq',
      ensure: async (p, a) => { calls.push(`ensure ${p}/${a}`) },
      rename: async (p, a, n) => { calls.push(`rename ${p}/${a}=${n}`) },
      remove: async (p, a) => { calls.push(`remove ${p}/${a}`) },
      setActive: (p, a) => { active[p] = a },
      run: (_p, a, fn) => als.run(a, fn),
    },
  }
  const s = new AccountStore(deps)
  s.migrate(['iq', 'tencent'])
  return { s, imported, calls, active, gwSessions, cur: current }
}

test('multi-account gateway: switching is a header change, no re-import, no rescan', async () => {
  const h = multiHarness()
  const def = h.s.view().book.slots.find((x) => x.provider === 'iq')!
  expect(h.s.gatewayId(def)).toBe('default') // migrated legacy session = gateway default account
  const a = await h.s.add('iq', 'A', 'cookieA')
  const gwA = h.s.gatewayId(a.slot)
  expect(/^[a-z0-9][a-z0-9_-]{0,31}$/.test(gwA)).toBe(true)
  expect(h.calls.includes(`ensure iq/${gwA}`)).toBe(true)
  expect(h.imported).toEqual([`iq@${gwA}:cookieA`]) // imported into its own account
  expect(h.active.iq).toBe(gwA)
  // QR slot: scan once
  const q = await h.s.add('iq', '扫码号')
  expect(q.needsLogin).toBe(true)
  h.s.recordStatus('iq') // login succeeded → status ok
  // switching back and forth never re-imports and QR does not need a rescan
  await h.s.activate(a.slot.id)
  await h.s.activate(def.id)
  const back = await h.s.activate(q.slot.id)
  expect(back.needsLogin).toBe(false)
  expect(h.imported).toHaveLength(1)
  expect(h.active.iq).toBe(h.s.gatewayId(q.slot))
})

test('multi-account gateway: concurrent use with different accounts is not serialised', async () => {
  const h = multiHarness()
  const a = await h.s.add('iq', 'A', 'cookieA')
  const b = await h.s.add('iq', 'B', 'cookieB')
  let inflight = 0, peak = 0
  const seen: string[] = []
  const job = (id: string) => h.s.use('iq', id, async () => {
    inflight++; peak = Math.max(peak, inflight)
    seen.push(h.cur())
    await new Promise((r) => setTimeout(r, 20))
    inflight--
    return h.cur()
  })
  const [ra, rb] = await Promise.all([job(a.slot.id), job(b.slot.id)])
  expect(peak).toBe(2)
  expect([ra, rb]).toEqual([h.s.gatewayId(a.slot), h.s.gatewayId(b.slot)])
})

test('multi-account gateway: fallback retries under another account without switching', async () => {
  const h = multiHarness()
  const a = await h.s.add('iq', 'A', 'cookieA')
  const b = await h.s.add('iq', 'B', 'cookieB')
  h.s.setDefault(a.slot.id)
  await h.s.activate(a.slot.id)
  h.imported.length = 0
  const gwA = h.s.gatewayId(a.slot)
  const out = await h.s.withFallback('iq', async () => {
    if (h.cur() === gwA) throw new Error('Q00505 会员受限')
    return h.cur()
  })
  expect(out).toBe(h.s.gatewayId(b.slot))
  expect(h.s.activeId('iq')).toBe(a.slot.id) // UI "current" account unchanged
  expect(h.imported).toEqual([`iq@${gwA}:cookieA`]) // one re-import attempt for A (gateway may have restarted)
  h.s.remove(b.slot.id)
  expect(h.calls.includes(`remove iq/${h.s.gatewayId(b.slot)}`)).toBe(true)
})

test('legacy gateway keeps the cookie re-import path for unsupported providers', async () => {
  const h = multiHarness()
  const t = await h.s.add('tencent', 'T2', 'vqq=1')
  expect(h.imported).toEqual(['tencent@:vqq=1'])
  expect(h.calls.some((c) => c.includes('tencent'))).toBe(false)
  void t
})
