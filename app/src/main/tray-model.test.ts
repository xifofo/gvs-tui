import { expect, test } from 'bun:test'
import { trayKey, trayModel } from './tray-model'

test('tray menu key is stable across unrelated subscription changes', () => {
  const a = trayModel(false, { running: false, subs: [{ newCount: 0 }] })
  const b = trayModel(false, { running: false, subs: [{ newCount: 3 }, { newCount: 0 }] })
  expect(trayKey(a)).toBe(trayKey(b))
  expect(a.tooltip === b.tooltip).toBe(false)
})

test('tray menu rebuilds when pause/running state changes', () => {
  const a = trayModel(false, { running: false, subs: [] })
  expect(trayKey(trayModel(true, { running: false, subs: [] })) === trayKey(a)).toBe(false)
  const r = trayModel(false, { running: true, subs: [] })
  expect(r.items.find((i) => i.id === 'check')).toEqual({ id: 'check', label: '正在检查…', enabled: false })
})
