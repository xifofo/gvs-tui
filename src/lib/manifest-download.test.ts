import { expect, test } from 'bun:test'
import { manifestInput, parseContentKeys, resolveManifestDownload } from './manifest-provider.ts'
import type { GwClient } from './client.ts'
import { usesMeasuredNaming } from './completed-naming.ts'

test('Hami and Friday use finished media codecs while legacy provider naming stays unchanged', () => {
  expect(usesMeasuredNaming({ provider: 'friday' })).toBe(true)
  expect(usesMeasuredNaming({ provider: 'hamivideo' })).toBe(true)
  expect(usesMeasuredNaming({ provider: 'tencent' })).toBe(false)
  expect(usesMeasuredNaming({ provider: 'tencent', namingVersion: 1 })).toBe(true)
})

test('content key parser validates lengths, deduplicates and rejects contradictory KIDs', () => {
  const row = { kid: 'a'.repeat(32), key: 'b'.repeat(32) }
  expect(parseContentKeys([row, row])).toEqual([`${row.kid}:${row.key}`])
  expect(() => parseContentKeys([{ ...row, key: 'PRIVATE' }])).toThrow('格式无效')
  expect(() => parseContentKeys([row, { ...row, key: 'c'.repeat(32) }])).toThrow('冲突')
  expect(parseContentKeys(undefined)).toEqual([])
})

test('Friday preserves the selected quality and download never accepts missing decrypt material', async () => {
  expect(manifestInput('friday', {}, 'tv:1:1:1:2', '1080')).toEqual({ id: 'tv:1:1:1:2', quality: '1080' })
  const cli = { invoke: async (_p: string, _a: string, input: Record<string, unknown>) => {
    expect(input.download).toBe(true)
    return { media: [{ url: 'https://cdn.example/manifest.mpd', format: 'dash', drm: { system: 'widevine' } }] }
  } } as unknown as GwClient
  await expect(resolveManifestDownload(cli, {}, 'friday', 'id')).rejects.toThrow('DRM_CLIENT_UNAVAILABLE')
})
