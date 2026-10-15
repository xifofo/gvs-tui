import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceGuidSha256, feedTencentNativeFixtures, resolveNativeCollectMode, resolveTencentNativeTemplatesDir } from './tencent-native-fixture-feed.ts'

describe('tencent native fixture feed (phone-free)', () => {
  test('templates directory ships watch/qimei/getfeature', () => {
    const dir = resolveTencentNativeTemplatesDir()
    expect(dir.includes('tencent-native-templates')).toBe(true)
  })

  test('emits fresh pending records bound to device guid hash without adb', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-fixture-feed-'))
    try {
      const out = join(dir, 'events.jsonl')
      const guid = 'D0F1A2B3C4D511F191697C8C09268FCA'
      const result = feedTencentNativeFixtures({
        gateway: 'http://127.0.0.1:8080',
        account: 'default',
        deviceGuid: guid,
        outPath: out,
        kinds: ['watch', 'qimei'],
        cid: 'cover-a',
        vid: 'ep-1',
      })
      expect(result.written).toBe(2)
      expect(result.device_guid_sha256).toBe(deviceGuidSha256(guid))
      expect(result.device_guid_sha256).toBe(createHash('sha256').update(guid, 'utf8').digest('hex'))
      const lines = readFileSync(out, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        const record = JSON.parse(line)
        expect(record.gateway).toBe('http://127.0.0.1:8080')
        expect(record.account).toBe('default')
        expect(record.delivery).toBe('pending')
        expect(record.event.device_guid_sha256).toBe(result.device_guid_sha256)
        expect(record.event.observed_at).toBeGreaterThan(Date.now() - 60_000)
        expect(record.event.source).toBe('android_app')
        expect(record.event.source_sha256).toMatch(/^[a-f0-9]{64}$/)
      }
      const watch = JSON.parse(lines[0]!)
      expect(watch.event.kind).toBe('watch')
      expect(watch.event.payload.cid).toBe('cover-a')
      expect(watch.event.payload.vid).toBe('ep-1')
      expect(watch.event.payload.filter_id).toBe('|tv|')
      const qimei = JSON.parse(lines[1]!)
      expect(qimei.event.kind).toBe('qimei')
      expect(qimei.event.payload.native.tm).toBe(String(qimei.event.observed_at))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('resolveNativeCollectMode defaults from legacy file path', () => {
    expect(resolveNativeCollectMode({})).toBe('off')
    expect(resolveNativeCollectMode({ tencentNativeEventFile: 'C:/x.jsonl' })).toBe('file')
    expect(resolveNativeCollectMode({ tencentNativeEventCollect: 'fixture' })).toBe('fixture')
    expect(resolveNativeCollectMode({ tencentNativeEventCollect: 'off', tencentNativeEventFile: 'C:/x.jsonl' })).toBe('off')
  })
})
