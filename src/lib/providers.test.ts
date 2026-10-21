import { expect, test } from 'bun:test'
import {
  PROVIDER_LABELS,
  isOptionalLogin,
  loginPriority,
  OPTIONAL_LOGIN_PROVIDERS,
  providerLoginNote,
  PROVIDER_IDS,
} from './providers'

// 爱奇艺国内版扫码已经覆盖 iQ 内容的国内车道，所以 IQ 海外版登录降级为可选。
test('iqcn is the primary iQIYI login and iq is optional', () => {
  expect(isOptionalLogin('iq')).toBe(true)
  expect(isOptionalLogin('iqcn')).toBe(false)
  expect(loginPriority('iqcn')).toBeLessThan(loginPriority('iq'))
  expect(loginPriority('youku')).toBeGreaterThan(loginPriority('iq'))
})

test('optional login list stays a subset of the known providers', () => {
  for (const id of OPTIONAL_LOGIN_PROVIDERS) {
    expect(PROVIDER_IDS.includes(id as (typeof PROVIDER_IDS)[number])).toBe(true)
  }
})

test('login notes explain the iQIYI pairing without changing provider labels', () => {
  expect(PROVIDER_LABELS.iq).toBe('IQ 海外版')
  expect(providerLoginNote('iqcn')).toContain('国内车道')
  expect(providerLoginNote('iq')).toContain('可选')
  expect(providerLoginNote('youku')).toBe('')
})
