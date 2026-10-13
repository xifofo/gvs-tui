import { expect, test } from 'bun:test'
import { PROVIDER_NAME } from '../../../../shared/api'
import { PLATFORM_ICONS } from './platform-icons'

test('every app provider has a unified platform icon', () => {
  for (const p of Object.keys(PROVIDER_NAME)) {
    const i = PLATFORM_ICONS[p]
    expect(i, p).toBeDefined()
    expect(i!.color).toMatch(/^#[0-9A-F]{6}$/i)
  }
})

test('icon entries are well-formed', () => {
  for (const [id, i] of Object.entries(PLATFORM_ICONS)) {
    expect(i.id).toBe(id)
    if (i.glyph.kind === 'path') expect(i.glyph.d.length).toBeGreaterThan(10)
    if (i.glyph.kind === 'text') expect(i.glyph.text.length).toBeLessThanOrEqual(5)
  }
})
