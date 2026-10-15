import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TencentNativeEvents, TencentNativeEventStop, type TencentNativeEventMode } from './tencent-native-events.ts'

function event(id = 'event-1') {
  return { gateway: 'http://localhost:8080', account: 'slot-a', delivery: 'pending', event: {
    id, kind: 'qimei', source: 'android_app', source_sha256: '2'.repeat(64), device_guid_sha256: 'a'.repeat(64), observed_at: Date.now(),
    payload: { native: { protobuf_base64: 'CAE=', cpt: '1', tm: String(Date.now()), nn: 'fixture-nonce', usec: 100 } },
  } }
}
function fixture(mode: TencentNativeEventMode = 'preview') {
  const directory = mkdtempSync(join(tmpdir(), 'tx-native-events-'))
  const path = join(directory, 'actual-producer.jsonl')
  const logs: string[] = [], calls: Record<string, unknown>[] = []
  const cfg = { gateway: 'http://localhost:8080', account: 'slot-a', path, mode }
  const source = new TencentNativeEvents(() => cfg, line => logs.push(line))
  const call = async (input: Record<string, unknown>) => { calls.push(input); return { status: 'preview' } }
  return { cfg, path, source, calls, call, logs, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

describe('Tencent actual native source', () => {
  test('app mirrors cannot send and raw payloads never enter logs', async () => {
    const f = fixture('send')
    try {
      const record = { ...event(), delivery: 'mirror' }
      writeFileSync(f.path, JSON.stringify(record) + '\n')
      await f.source.drain('PRIVATE-BINDING', f.call)
      expect(f.calls).toHaveLength(1)
      expect(f.calls[0]?.send).toBe('0')
      expect(f.logs.join(' ')).not.toContain('PRIVATE-BINDING')
      expect(f.logs.join(' ')).not.toContain('fixture-nonce')
      expect(f.logs.join(' ')).not.toContain('CAE=')
    } finally { f.cleanup() }
  })

  test('preview and send use the exact source event without manufacturing fields', async () => {
    const f = fixture('send')
    try {
      const record = event()
      writeFileSync(f.path, JSON.stringify(record) + '\n')
      await f.source.drain('binding', f.call)
      expect(f.calls[0]?.send).toBe('1')
      expect(JSON.parse(String(f.calls[0]?.payload))).toEqual(record.event)
      await f.source.drain('binding', f.call)
      appendFileSync(f.path, JSON.stringify(record) + '\n')
      await f.source.drain('binding', f.call)
      expect(f.calls).toHaveLength(1)
    } finally { f.cleanup() }
  })

  test('fresh pending previews can be sent once after an explicit mode change; mirrors cannot', async () => {
    const f = fixture('preview')
    try {
      writeFileSync(f.path, [event('pending'), { ...event('mirror'), delivery: 'mirror' }].map(r => JSON.stringify(r)).join('\n') + '\n')
      await f.source.drain('binding', f.call)
      expect(f.calls.map(c => c.send)).toEqual(['0', '0'])
      f.cfg.mode = 'send'
      await f.source.drain('binding', f.call)
      expect(f.calls.map(c => c.send)).toEqual(['0', '0', '1'])
      await f.source.drain('binding', f.call)
      expect(f.calls).toHaveLength(3)
    } finally { f.cleanup() }
  })

  test('disabling delivery during a batch stops its remaining requests', async () => {
    const f = fixture('send')
    try {
      writeFileSync(f.path, [event('first'), event('second')].map(r => JSON.stringify(r)).join('\n') + '\n')
      await f.source.drain('binding', async input => { f.calls.push(input); f.cfg.mode = 'off'; return { status: 'unverified_response' } })
      expect(f.calls).toHaveLength(1)
      await f.source.drain('binding', f.call)
      expect(f.calls).toHaveLength(1)
    } finally { f.cleanup() }
  })

  test('partial JSONL and concurrent lifecycle callbacks consume an event once', async () => {
    const f = fixture()
    try {
      const line = JSON.stringify(event())
      writeFileSync(f.path, line.slice(0, 40))
      await f.source.drain('binding', f.call)
      expect(f.calls).toHaveLength(0)
      appendFileSync(f.path, line.slice(40) + '\n')
      await Promise.all([f.source.drain('binding', f.call), f.source.drain('binding', f.call)])
      expect(f.calls).toHaveLength(1)
    } finally { f.cleanup() }
  })

  test('wrong gateway or account is never delivered', async () => {
    const f = fixture()
    try {
      writeFileSync(f.path, [ { ...event('wrong-account'), account: 'slot-b' }, { ...event('wrong-host'), gateway: 'https://other.invalid' }, event('right') ].map(r => JSON.stringify(r)).join('\n') + '\n')
      await f.source.drain('binding', f.call)
      expect(f.calls).toHaveLength(1)
      expect(JSON.parse(String(f.calls[0]?.payload)).id).toBe('right')
    } finally { f.cleanup() }
  })

  test('delivery unknown stops later queued events and automatic retries', async () => {
    const f = fixture('send')
    try {
      writeFileSync(f.path, [event('first'), event('second')].map(r => JSON.stringify(r)).join('\n') + '\n')
      const call = async (input: Record<string, unknown>) => { f.calls.push(input); return { status: 'transport_error', delivery_unknown: true } }
      await expect(f.source.drain('binding', call)).rejects.toBeInstanceOf(TencentNativeEventStop)
      await expect(f.source.drain('binding', call)).rejects.toBeInstanceOf(TencentNativeEventStop)
      expect(f.calls).toHaveLength(1)
    } finally { f.cleanup() }
  })

  test('malformed or stale source stops without echoing plaintext', async () => {
    for (const mutate of [
      (r: ReturnType<typeof event>) => { r.event.source = 'tui_process' },
      (r: ReturnType<typeof event>) => { r.event.observed_at = 1 },
      (r: ReturnType<typeof event>) => { r.event.device_guid_sha256 = '' },
      (r: ReturnType<typeof event>) => { r.event.id = 123 as unknown as string },
    ]) {
      const f = fixture()
      try {
        const record = event(); mutate(record); writeFileSync(f.path, JSON.stringify(record) + '\n')
        await expect(f.source.drain('binding', f.call)).rejects.toBeInstanceOf(TencentNativeEventStop)
        expect(f.calls).toHaveLength(0)
        expect(f.logs.join(' ')).not.toContain('fixture-nonce')
      } finally { f.cleanup() }
    }
  })

  test('reusing ID with changed data and replacing source both fail closed', async () => {
    const f = fixture()
    try {
      const original = event()
      writeFileSync(f.path, JSON.stringify(original) + '\n')
      await f.source.drain('binding', f.call)
      original.event.payload.native.nn = 'changed'
      appendFileSync(f.path, JSON.stringify(original) + '\n')
      await expect(f.source.drain('binding', f.call)).rejects.toBeInstanceOf(TencentNativeEventStop)
      expect(f.calls).toHaveLength(1)
    } finally { f.cleanup() }
    const replaced = fixture()
    try {
      writeFileSync(replaced.path, JSON.stringify(event()) + '\n')
      await replaced.source.drain('binding', replaced.call)
      writeFileSync(replaced.path, '')
      await expect(replaced.source.drain('binding', replaced.call)).rejects.toBeInstanceOf(TencentNativeEventStop)
    } finally { replaced.cleanup() }
  })
})
