import { expect, test } from 'bun:test'
import { platformBar, tabStrip } from './shared'
import { displayWidth } from '../lib/text'

test('narrow platform strip retains the selected platform and both browse modes', () => {
  const bar = platformBar(['youku', 'iqcn'], 58, 'iqcn', 'rank')
  const text = bar.chunks.map(chunk => chunk.text).join('')
  expect(displayWidth(text)).toBeLessThanOrEqual(58)
  expect(text).toContain('6 爱奇艺国内版')
  expect(text).toContain('推荐')
  expect(text).toContain('榜单')
  expect(text).toContain('‹')
})

test('a platform reached through search Tab has its own visible active tab', () => {
  const bar = platformBar(['youku', 'mewatch', 'hamivideo', 'iq'], 58, 'iq')
  const active = bar.chunks.filter(chunk => chunk.bg).map(chunk => chunk.text).join('')
  expect(active).toContain('IQ 海外版')
  expect(displayWidth(bar.chunks.map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(58)
})

test('late episode groups remain visible and overly long labels stay bounded', () => {
  const groups = ['正片', '预告花絮', '幕后纪录', '节目访谈', '特别企划']
  const chunks = tabStrip(groups, 4, 20)
  expect(chunks.filter(chunk => chunk.bg).map(chunk => chunk.text).join('')).toContain('特别企划')
  expect(displayWidth(chunks.map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(20)
  const narrow = tabStrip(['前一组', '很长很长的当前节目分组', '后一组'], 1, 12)
  expect(narrow.some(chunk => !!chunk.bg)).toBe(true)
  expect(displayWidth(narrow.map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(12)
})
