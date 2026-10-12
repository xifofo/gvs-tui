import { expect, test } from 'bun:test'
import { DEFAULT_UI_PREFS, mergeUiPrefs, preferredQualityIndex, pushRecent, RECENT_LIMIT, sanitizeUiPrefs } from './ui-prefs'

// ui prefs
test('sanitize fills defaults and drops junk', () => {
    expect(sanitizeUiPrefs(undefined)).toEqual(DEFAULT_UI_PREFS)
    expect(sanitizeUiPrefs({ sidebarCollapsed: 'yes', hiddenProviders: ['iq', 3, ' iq ', ''], defaultQuality: '4k' })).toEqual({
      ...DEFAULT_UI_PREFS, hiddenProviders: ['iq'],
    })
  })

test('merge keeps untouched fields', () => {
    const merged = mergeUiPrefs({ hiddenProviders: ['iq'], defaultQuality: '1080' }, { sidebarCollapsed: true })
    expect([merged.sidebarCollapsed, merged.hiddenProviders, merged.defaultQuality]).toEqual([true, ['iq'], '1080'])
  })

test('theme and motion prefs sanitize to dark + on', () => {
    expect([sanitizeUiPrefs({}).theme, sanitizeUiPrefs({}).motion]).toEqual(['dark', true])
    expect([sanitizeUiPrefs({ theme: 'light' }).theme, sanitizeUiPrefs({ theme: 'system' }).theme, sanitizeUiPrefs({ theme: 'neon' }).theme]).toEqual(['light', 'system', 'dark'])
    expect([sanitizeUiPrefs({ motion: false }).motion, sanitizeUiPrefs({ motion: 0 }).motion]).toEqual([false, true])
    expect(mergeUiPrefs({ theme: 'light' }, { motion: false })).toEqual({ ...DEFAULT_UI_PREFS, theme: 'light', motion: false })
  })

test('pushRecent de-duplicates case/space-insensitively and caps', () => {
    expect(pushRecent(['庆余年', 'Abc  Def'], 'abc def')).toEqual(['abc def', '庆余年'])
    expect(pushRecent([], '   ')).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `q${i}`)
    expect(pushRecent(many, 'new')).toHaveLength(RECENT_LIMIT)
  })

test('preferredQualityIndex picks highest at or below cap', () => {
    const q = [{ height: 2160 }, { height: 1080 }, { height: 1080 }, { height: 720 }]
    expect(preferredQualityIndex(q, 'best')).toBe(0)
    expect(preferredQualityIndex(q, '1080')).toBe(1)
    expect(preferredQualityIndex(q, '720')).toBe(3)
    expect(preferredQualityIndex([{ height: 2160 }], '720')).toBe(0)
    expect(preferredQualityIndex([], '1080')).toBe(0)
  })
