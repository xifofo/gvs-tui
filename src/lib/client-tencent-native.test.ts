import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GwClient } from './client.ts'
import type { FileConfig } from './config.ts'
import { setRunLogDisabled } from './runlog.ts'

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function setup(source: 'tui_process' | 'electron_process') {
  setRunLogDisabled(true)
  cleanups.push(() => setRunLogDisabled(false))
  const dir = mkdtempSync(join(tmpdir(), 'tx-business-flow-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const previousDiagnostics = process.env.GVS_TENCENT_DIAGNOSTICS_PATH
  process.env.GVS_TENCENT_DIAGNOSTICS_PATH = join(dir, 'isolated-diagnostics.jsonl')
  cleanups.push(() => { if (previousDiagnostics === undefined) delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH; else process.env.GVS_TENCENT_DIAGNOSTICS_PATH = previousDiagnostics })
  const path = join(dir, 'producer.jsonl')
  const calls: { action: string; input: Record<string, unknown>; account: string; auth: string }[] = []
  let stopped = false
  let beforeBind: (() => Promise<void>) | undefined
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const body = await req.json() as { action: string; input: Record<string, unknown> }
    calls.push({ ...body, account: req.headers.get('X-Gvs-Account') || 'default', auth: req.headers.get('Authorization') || '' })
    const input = body.input
    if (body.action === 'report' && input.report_type === 'bind') await beforeBind?.()
    const data = body.action !== 'report' ? (body.action === 'detail' ? { episodes: [{ vid: 'episode1' }] } : { em: 0, has_url: true })
      : input.report_type === 'bind' ? { binding: 'fixture-binding-' + (req.headers.get('X-Gvs-Account') || 'default'), observation_sources: ['tui_process', 'electron_process'] }
      : input.report_type === 'event' ? { status: stopped ? 'transport_error' : input.send === '1' ? 'qimei_decrypted_unverified' : 'preview', ...(stopped ? { delivery_unknown: true, stop: true } : {}) }
      : { status: 'observed_locally' }
    return Response.json({ code: 0, msg: 'SUCCESS', data })
  } })
  cleanups.push(() => server.stop(true))
  const cfg = { host: server.url.href.replace(/\/$/, ''), key: 'fixture-key', tencentMode: 'tv', tencentObservations: true, tencentNativeEventFile: path, tencentNativeEventMode: 'send' } as FileConfig
  let account = 'slot-a'
  const client = new GwClient(cfg.host, cfg.key, () => cfg, source)
  client.accountFor = () => account
  function write(id: string, delivery: 'mirror' | 'pending', target = account) {
    appendFileSync(path, JSON.stringify({ gateway: cfg.host, account: target, delivery, event: {
      id, kind: 'qimei', source: 'android_app', source_sha256: '2'.repeat(64), device_guid_sha256: 'a'.repeat(64), observed_at: Date.now(),
      payload: { native: { protobuf_base64: 'CAE=', cpt: '2', tm: String(Date.now()), nn: 'fixture-nonce', usec: 100 } },
    } }) + '\n')
  }
  writeFileSync(path, '')
  return { client, calls, cfg, write, switchAccount: (value: string) => { account = value }, failDelivery: () => { stopped = true }, setBeforeBind: (callback: () => Promise<void>) => { beforeBind = callback } }
}

describe('Tencent business flow through the shared app/TUI GwClient', () => {
  for (const source of ['tui_process', 'electron_process'] as const) {
    test(`${source}: detail, quality probe and download share the correct account and consume native events`, async () => {
      const f = setup(source)
      f.write('mirror-before-detail', 'mirror')
      await f.client.invoke('tencent', 'detail', { cid: 'cover1', session_type: 'tv' })
      f.write('pending-before-probe', 'pending')
      await f.client.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })
      const job = f.client.forkTencentJob(5, 'episode1')
      f.switchAccount('slot-b')
      f.write('pending-old-job', 'pending', 'slot-a')
      await job.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })
      await job.closeTencentTransfer(false, false)
      const native = f.calls.filter(c => c.input.report_type === 'event')
      expect(native).toHaveLength(3)
      expect(native.map(c => c.input.send)).toEqual(['0', '1', '1'])
      expect(f.calls.every(c => c.account === 'slot-a')).toBe(true)
      expect(f.calls.every(c => c.auth === 'Bearer fixture-key')).toBe(true)
      expect(f.calls.filter(c => c.input.report_type === 'bind')).toHaveLength(1)
      expect(f.calls.filter(c => c.action === 'play').every(c => c.input.report_binding === 'fixture-binding-slot-a')).toBe(true)
      const observations = f.calls.filter(c => c.input.report_type === 'observe').map(c => JSON.parse(String(c.input.payload)))
      expect(observations.every(c => c.source === source)).toBe(true)
      expect(native.every(c => JSON.parse(String(c.input.payload)).source === 'android_app')).toBe(true)
    })
  }

  test('switching account obtains its own binding and cannot inherit a previous flow', async () => {
    const f = setup('electron_process')
    await f.client.invoke('tencent', 'detail', { cid: 'cover1', session_type: 'tv' })
    f.switchAccount('slot-b')
    f.write('slot-b-event', 'pending')
    await f.client.invoke('tencent', 'play', { vid: 'episode2', session_type: 'tv' })
    const bindings = f.calls.filter(c => c.input.report_type === 'bind')
    expect(bindings.map(c => c.account)).toEqual(['slot-a', 'slot-b'])
    const play = f.calls.find(c => c.action === 'play')!
    expect(play.account).toBe('slot-b')
    expect(play.input.report_binding).toBe('fixture-binding-slot-b')
  })

  test('an account switch while binding is in flight cannot reroute its event or business request', async () => {
    const f = setup('electron_process')
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { entered = resolve })
    f.setBeforeBind(async () => { entered(); await gate })
    f.write('owner-a', 'pending')
    const operation = f.client.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })
    await ready
    f.switchAccount('slot-b')
    release()
    await operation
    expect(f.calls.every(c => c.account === 'slot-a')).toBe(true)
    expect(f.calls.filter(c => c.action === 'play')).toHaveLength(1)
    expect(f.calls.filter(c => c.input.report_type === 'event')).toHaveLength(1)
  })

  test('new source files start a new flow while an existing job keeps its original producer', async () => {
    const f = setup('tui_process')
    await f.client.invoke('tencent', 'detail', { cid: 'cover1', session_type: 'tv' })
    const job = f.client.forkTencentJob(9, 'episode1')
    const nextFile = f.cfg.tencentNativeEventFile + '.next'
    writeFileSync(nextFile, '')
    f.cfg.tencentNativeEventFile = nextFile
    await f.client.invoke('tencent', 'detail', { cid: 'cover2', session_type: 'tv' })
    f.write('old-job-source', 'pending')
    await job.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })
    expect(f.calls.filter(c => c.input.report_type === 'bind')).toHaveLength(2)
    const events = f.calls.filter(c => c.input.report_type === 'event')
    expect(events).toHaveLength(1)
    expect(JSON.parse(String(events[0]?.input.payload)).id).toBe('old-job-source')
  })

  test('unknown native delivery stops before media retrieval and does not replay automatically', async () => {
    const f = setup('tui_process')
    f.write('pending', 'pending'); f.failDelivery()
    await expect(f.client.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })).rejects.toThrow('native event flow stopped')
    expect(f.calls.filter(c => c.action === 'play')).toHaveLength(0)
    await expect(f.client.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })).rejects.toThrow('stopped after rejection')
    expect(f.calls.filter(c => c.input.report_type === 'event')).toHaveLength(1)
  })

  test('without a producer the actual desktop action remains local observations only', async () => {
    const f = setup('tui_process'); f.cfg.tencentNativeEventFile = ''
    await f.client.invoke('tencent', 'play', { vid: 'episode1', session_type: 'tv' })
    expect(f.calls.some(c => c.action === 'play')).toBe(true)
    expect(f.calls.filter(c => c.input.report_type === 'event')).toHaveLength(0)
    expect(f.calls.some(c => c.input.report_type === 'observe')).toBe(true)
  })
})
