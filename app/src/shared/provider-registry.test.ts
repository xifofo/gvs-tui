import { expect, test } from 'bun:test'
import { PROVIDER_IDS } from '../../../src/lib/providers'
import { accountBucket, moveProvider, needsAttention, orderProviders, PROVIDER_META, providerMeta, visibleProviders } from './provider-registry'

// provider registry
test('every known provider declares at least one login method', () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_META[id]
      expect(!!meta).toBe(true)
      expect(meta!.methods.length > 0).toBe(true)
      expect(meta!.multiAccount).toBe(false)
    }
  })

test('iq carries the overseas node hint; unknown ids get a safe default', () => {
    expect(providerMeta('iq').region?.includes('海外')).toBe(true)
    expect(providerMeta('nope').methods).toEqual(['none'])
  })

test('orderProviders applies saved order, ignores unknown ids, appends new ones', () => {
    expect(orderProviders(['youku', 'tencent', 'iq', 'mgtv'], ['iq', 'ghost', 'youku', 'iq'])).toEqual(['iq', 'youku', 'tencent', 'mgtv'])
  })

test('visibleProviders hides user-hidden providers', () => {
    expect(visibleProviders(['youku', 'tencent', 'iq'], { providerOrder: ['iq'], hiddenProviders: ['tencent'] })).toEqual(['iq', 'youku'])
  })

test('moveProvider swaps neighbours and clamps at the ends', () => {
    expect(moveProvider(['a', 'b', 'c'], [], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveProvider(['a', 'b', 'c'], [], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveProvider(['a', 'b', 'c'], ['c'], 'c', 1)).toEqual(['a', 'c', 'b'])
  })

test('attention buckets', () => {
    expect(needsAttention({ provider: 'youku', tone: 'warn', short: '需扫码', summary: '' })).toBe(true)
    expect(needsAttention({ provider: 'mgtv', tone: 'muted', short: '待登录', summary: '' })).toBe(true)
    expect(needsAttention({ provider: 'bilibili', tone: 'muted', short: '匿名', summary: '匿名可用' })).toBe(false)
    expect(accountBucket({ provider: 'iq', tone: 'ok', short: '已登录', summary: '' })).toBe('ok')
    expect(accountBucket({ provider: 'hongguo', tone: 'muted', short: '免登录', summary: '' })).toBe('idle')
  })
