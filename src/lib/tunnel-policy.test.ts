import { expect, test } from 'bun:test'
import { needsTunnel, TUNNEL_PROVIDERS } from './tunnel-policy.ts'

test('single-platform Keys start their required tunnel', () => {
  for (const name of TUNNEL_PROVIDERS) expect(needsTunnel(p => p === name)).toBe(true)
  expect(needsTunnel(() => true)).toBe(true)
  expect(needsTunnel(p => p === 'douban')).toBe(false)
  expect(needsTunnel(() => false)).toBe(false)
})
