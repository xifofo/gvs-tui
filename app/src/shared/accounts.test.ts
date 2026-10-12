import { expect, test } from 'bun:test'
import { addSlot, fallbackCandidates, isAccountError, migrateBook, parseVipExpiry, removeSlot, renameSlot, resolveSlot, sanitizeBook, setDefault, slotsOf } from './accounts'

test('migration creates one default gateway slot per login platform, idempotent', () => {
  const { book, changed } = migrateBook(undefined, ['iq', 'tencent', 'hongguo'], 1000)
  expect(changed).toBe(true)
  expect(book.slots.map((s) => [s.provider, s.name, s.mode])).toEqual([['iq', '默认账号', 'gateway'], ['tencent', '默认账号', 'gateway']])
  expect(book.defaults.iq).toBe(book.slots[0]!.id)
  expect(book.active.iq).toBe(book.slots[0]!.id)
  const again = migrateBook(book, ['iq', 'tencent'], 2000)
  expect(again.changed).toBe(false)
  expect(again.book.slots).toHaveLength(2)
  // 新平台后来才开通：只补那一个
  expect(migrateBook(book, ['iq', 'tencent', 'mgtv'], 3000).book.slots).toHaveLength(3)
})

test('add / rename / default / remove keeps invariants', () => {
  let b = migrateBook(undefined, ['iq'], 1000).book
  const first = b.slots[0]!.id
  const r = addSlot(b, 'iq', ' 副号 ', 'cookie', true, 2000)
  b = r.book
  expect(r.slot.name).toBe('副号')
  expect(addSlot(b, 'iq', '', 'qr', false, 2000).slot.name).toBe('账号 3')
  expect(addSlot(b, 'iq', '', 'qr', false, 2000).slot.id === r.slot.id).toBe(false)
  b = setDefault(b, r.slot.id)
  expect(slotsOf(b, 'iq').map((s) => s.id)).toEqual([r.slot.id, first])
  expect(resolveSlot(b, 'iq')?.id).toBe(r.slot.id)
  expect(resolveSlot(b, 'iq', first)?.id).toBe(first)
  b = renameSlot(b, first, '主号')
  b = removeSlot(b, r.slot.id)
  expect([b.defaults.iq, b.active.iq]).toEqual([first, first])
  let threw = false
  try { removeSlot(b, first) } catch { threw = true }
  expect(threw).toBe(true)
})

test('account errors and fallback order', () => {
  expect(isAccountError(new Error('Q00505 当前账号无权播放'))).toBe(true)
  expect(isAccountError('Q00503')).toBe(true)
  expect(isAccountError('需要开通会员才能观看')).toBe(true)
  expect(isAccountError('登录态已失效，请重新扫码')).toBe(true)
  expect(isAccountError('网络超时')).toBe(false)
  let b = migrateBook(undefined, ['iq'], 1000).book
  const gw = b.slots[0]!.id
  const a = addSlot(b, 'iq', 'A', 'cookie', true, 2000); b = a.book
  const q = addSlot(b, 'iq', 'Q', 'qr', false, 3000); b = q.book
  const c = addSlot(b, 'iq', 'C', 'cookie', true, 4000); b = c.book
  b = { ...b, slots: b.slots.map((s) => (s.id === c.slot.id ? { ...s, status: { short: '', summary: '', tone: 'ok', vipUntil: 0, checkedAt: 0 } } : s)) }
  expect(fallbackCandidates(b, 'iq', gw).map((s) => s.name)).toEqual(['C', 'A'])
  b = setDefault(b, a.slot.id)
  expect(fallbackCandidates(b, 'iq', gw).map((s) => s.name)).toEqual(['A', 'C'])
  expect(fallbackCandidates(b, 'iq', a.slot.id).map((s) => s.name)).toEqual(['C'])
})

test('vip expiry parsing and sanitize', () => {
  expect(parseVipExpiry('黄金会员 · 到期 2026-12-01')).toBe(new Date(2026, 11, 1, 23, 59, 59).getTime())
  expect(parseVipExpiry('VIP 有效期至2027年1月5日')).toBe(new Date(2027, 0, 5, 23, 59, 59).getTime())
  expect(parseVipExpiry('已登录')).toBe(0)
  expect(sanitizeBook({ slots: [{ id: 'x', provider: 'iq', mode: 'bogus' }], defaults: { iq: 'gone' } }).defaults.iq).toBe('x')
  expect(sanitizeBook(null).slots).toEqual([])
})
