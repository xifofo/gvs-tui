import { expect, test } from 'bun:test'
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
