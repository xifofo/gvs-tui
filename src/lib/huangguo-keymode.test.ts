import { test, expect } from 'bun:test'
import { huangguoKeyMode, parseHuangguoKey } from './huangguo.ts'

const KEY = '11'.repeat(16)

test('missing metadata delegates to the manifest and an older hex-only gateway retains its key', () => {
  expect(huangguoKeyMode('', null)).toEqual({ mode: 'native' })
  expect(huangguoKeyMode(KEY, { method: '', keyLines: 0, distinctUris: 0, mixedNone: false, missing: false, iv: '' })).toEqual({ mode: 'custom', key: KEY })
})

test('repeated URI with changed IV still delegates to per-segment decryption', () => {
  expect(huangguoKeyMode(KEY, { method: 'AES-128', keyLines: 2, distinctUris: 1, mixedNone: false, missing: false, iv: '' })).toEqual({ mode: 'native' })
})

test('single key, no rotation, no clear sections keeps the custom-key path', () => {
  expect(huangguoKeyMode(KEY, {
    method: 'AES-128', keyLines: 1, distinctUris: 1, mixedNone: false, missing: false, iv: '0x01',
  })).toEqual({ mode: 'custom', key: KEY })
})

test('declared encryption without a usable key fails closed instead of clear-downloading', () => {
  const missing = huangguoKeyMode('', { method: 'AES-128', keyLines: 1, distinctUris: 1, mixedNone: false, missing: true, iv: '' })
  expect(missing.mode).toBe('error')
  if (missing.mode === 'error') expect(missing.message).toContain('未取到解密密钥')
  // 旧版网关没上报 missing 标记、但 key 为空：同样失败
  const legacy = huangguoKeyMode('', { method: 'AES-128', keyLines: 0, distinctUris: 0, mixedNone: false, missing: false, iv: '' })
  expect(legacy.mode).toBe('error')
})

test('key rotation or mixed METHOD=NONE switches to native per-segment keying', () => {
  const rotation = huangguoKeyMode(KEY, { method: 'AES-128', keyLines: 2, distinctUris: 2, mixedNone: false, missing: false, iv: '' })
  expect(rotation).toEqual({ mode: 'native' })
  const mixed = huangguoKeyMode(KEY, { method: 'AES-128', keyLines: 2, distinctUris: 1, mixedNone: true, missing: false, iv: '' })
  expect(mixed).toEqual({ mode: 'native' })
})

test('parseHuangguoKey reads the gateway contract and tolerates old gateways', () => {
  expect(parseHuangguoKey({})).toBeNull()
  expect(parseHuangguoKey({ key: undefined })).toBeNull()
  // 旧版网关只有 method/hex
  expect(parseHuangguoKey({ key: { method: 'AES-128', hex: KEY } })).toEqual({
    method: 'AES-128', keyLines: 0, distinctUris: 0, mixedNone: false, missing: false, iv: '',
  })
  // 新版网关的轮换上报
  expect(parseHuangguoKey({
    key: { method: 'AES-128', hex: KEY, keyLines: 3, distinctUris: 2, mixedNone: true, iv: '0x9' },
  })).toEqual({
    method: 'AES-128', keyLines: 3, distinctUris: 2, mixedNone: true, missing: false, iv: '0x9',
  })
  // 取钥失败：missing 显式为真
  expect(parseHuangguoKey({ key: { method: 'AES-128', missing: true } })?.missing).toBe(true)
})
