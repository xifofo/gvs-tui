import { expect, test } from 'bun:test'
import { authCodeFrom, b64url, isAuthRedirect, makePkce, makeState } from './cr-sso'

test('b64url 去 padding 且把 +/ 换成 -_', () => {
  const out = b64url(Buffer.from([251, 255, 191]))
  expect(out).not.toContain('=')
  expect(out).not.toContain('+')
  expect(out).not.toContain('/')
})

test('PKCE：verifier 长度与字符集合规，challenge 是它的 sha256', () => {
  const { verifier, challenge } = makePkce()
  expect(verifier.length).toBeGreaterThanOrEqual(43)
  expect(verifier.length).toBeLessThanOrEqual(128)
  expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(challenge).not.toBe(verifier)
  // 同一个 verifier 必须得到同一个 challenge
  const again = makePkce()
  expect(again.challenge).not.toBe(challenge)
  expect(challenge.length).toBe(43)
})

test('state 每次不同', () => {
  expect(makeState()).not.toBe(makeState())
})

test('从回跳地址取 code（含裸 code）', () => {
  expect(authCodeFrom('crunchyroll://auth?code=abc123&state=s1')).toBe('abc123')
  expect(authCodeFrom('  "crunchyroll://auth?scope=offline_access&code=abc123"  ')).toBe('abc123')
  expect(authCodeFrom('abc123')).toBe('abc123')
  expect(authCodeFrom('crunchyroll://auth?state=s1')).toBe('')
  expect(authCodeFrom('')).toBe('')
})

test('只有 crunchyroll://auth 前缀算回跳', () => {
  expect(isAuthRedirect('crunchyroll://auth?code=x')).toBe(true)
  expect(isAuthRedirect('CRUNCHYROLL://AUTH?code=x')).toBe(true)
  expect(isAuthRedirect('https://www.crunchyroll.com/callback?code=x')).toBe(false)
  expect(isAuthRedirect('')).toBe(false)
})
