import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ReportCall } from './tencent-operations.ts'

export type TencentNativeEventMode = 'off' | 'preview' | 'send'
export type TencentNativeEventSettings = { path: string; mode: TencentNativeEventMode; gateway: string; account: string }
export type TencentNativeSourceRecord = {
  gateway: string
  account: string
  /** A mirror has already been transmitted by its actual producer. */
  delivery: 'mirror' | 'pending'
  event: { id: string; kind: string; source: string; source_sha256: string; device_guid_sha256?: string; observed_at: number; payload: Record<string, unknown> }
}
const MAX_LINE = 64 * 1024
const MAX_READ = 256 * 1024
const MAX_BATCH = 4
const kinds = new Set(['watch', 'adlog', 'bosskv', 'getfeature', 'qimei'])
const identifier = /^[A-Za-z0-9_.:-]{1,128}$/
const digest = /^[a-f\d]{64}$/i
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export class TencentNativeEventStop extends Error {
  constructor() { super('Tencent native event flow stopped; inspect delivery/session status'); this.name = 'TencentNativeEventStop' }
}

/** Main-process only: consume actual producer events, without synthesizing any
 * Android fields from UI clicks or download byte counts. Files are read-only;
 * payloads are never copied to application logs/config/diagnostic files. */
export class TencentNativeEvents {
  private file = ''
  private fileIdentity = ''
  private offset = 0
  private tail = Buffer.alloc(0)
  private scope = ''
  private stopped = false
  private pending: Promise<void> = Promise.resolve()
  private readonly seen = new Map<string, string>()
  private readonly previewedPending = new Map<string, TencentNativeSourceRecord>()

  constructor(private readonly settings: () => TencentNativeEventSettings, private readonly log: (line: string) => void, private readonly result?: (kind: string, id: string, reply: Record<string, unknown>) => void) {}

  drain(binding: string, call: ReportCall): Promise<void> {
    const work = this.pending.then(() => this.consume(binding, call))
    this.pending = work.catch(() => {})
    return work
  }

  private async consume(binding: string, call: ReportCall): Promise<void> {
    const cfg = this.settings()
    if (!cfg.path || cfg.mode === 'off' || !binding) return
    const scope = `${cfg.gateway.replace(/\/+$/, '')}\0${cfg.account}`
    if (this.scope && this.scope !== scope) throw new TencentNativeEventStop()
    this.scope = scope
    if (this.stopped) throw new TencentNativeEventStop()
    try {
      let budget = MAX_BATCH
      if (cfg.mode === 'send') {
        for (const [id, record] of this.previewedPending) {
          if (this.settings().mode !== 'send' || budget <= 0) break
          this.validate(record)
          this.previewedPending.delete(id)
          budget--
          await this.deliver(record, binding, call, true)
        }
      }
      this.read(cfg.path)
      for (let count = 0; count < 32 && budget > 0; count++) {
        if (this.settings().mode === 'off') break
        const end = this.tail.indexOf(10)
        if (end < 0) {
          if (this.tail.length > MAX_LINE) throw new Error('oversized source record')
          break
        }
        const line = this.tail.subarray(0, end)
        this.tail = this.tail.subarray(end + 1)
        if (!line.toString('utf8').trim()) continue
        if (line.length > MAX_LINE) throw new Error('oversized source record')
        const record = JSON.parse(line.toString('utf8')) as TencentNativeSourceRecord
        if (!object(record) || typeof record.gateway !== 'string' || typeof record.account !== 'string') throw new Error('invalid source scope')
        if (record.gateway.replace(/\/+$/, '') !== cfg.gateway.replace(/\/+$/, '') || record.account !== cfg.account) {
          this.log('tencent_native_event status=source_scope_mismatch')
          continue
        }
        this.validate(record)
        const event = record.event
        const hash = createHash('sha256').update(JSON.stringify(event)).digest('hex')
        const previous = this.seen.get(event.id)
        if (previous) {
          if (previous !== hash) throw new Error('event id reused with different content')
          continue
        }
        // Record before attempting delivery. A thrown/unknown result must never
        // cause a local automatic resend of the same event.
        this.seen.set(event.id, hash)
        while (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value!)
        const send = this.settings().mode === 'send' && record.delivery === 'pending'
        budget--
        await this.deliver(record, binding, call, send)
        if (!send && record.delivery === 'pending') {
          if (this.previewedPending.size >= 64) throw new Error('preview queue full')
          this.previewedPending.set(event.id, record)
        }
      }
    } catch (error) {
      this.stopped = true
      this.log('tencent_native_event status=stopped_no_automatic_resend')
      if (error instanceof TencentNativeEventStop) throw error
      // Do not propagate exception text: JSON and HTTP exceptions may contain
      // native plaintext, signatures, or account identifiers.
      throw new TencentNativeEventStop()
    }
  }

  private async deliver(record: TencentNativeSourceRecord, binding: string, call: ReportCall, send: boolean): Promise<void> {
    const event = record.event
    const reply = await call({ session_type: 'tv', report_type: 'event', binding, payload: JSON.stringify(event), send: send ? '1' : '0' })
    this.result?.(event.kind, event.id, reply)
    const status = typeof reply.status === 'string' && /^[a-z0-9_]{1,80}$/.test(reply.status) ? reply.status : 'unknown'
    this.log(`tencent_native_event kind=${event.kind} delivery=${record.delivery} status=${status} sent=${reply.sent === true ? 'yes' : 'no'}`)
    if (reply.stop === true || reply.delivery_unknown === true || reply.session_stopped === true) throw new TencentNativeEventStop()
  }

  private read(path: string): void {
    let fd: number
    try { fd = openSync(path, 'r') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.log('tencent_native_event status=source_unavailable'); return }
      throw error
    }
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile()) throw new Error('source must be a regular append-only JSONL file')
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
      if (this.file && (this.file !== path || this.fileIdentity !== identity || stat.size < this.offset)) throw new Error('source replaced or truncated')
      this.file = path; this.fileIdentity = identity
      if (this.tail.length >= MAX_READ) return
      const length = Math.min(MAX_READ - this.tail.length, Math.max(0, stat.size - this.offset))
      if (length === 0) return
      const chunk = Buffer.alloc(length)
      const read = readSync(fd, chunk, 0, length, this.offset)
      this.offset += read
      this.tail = Buffer.concat([this.tail, chunk.subarray(0, read)])
    } finally { closeSync(fd) }
  }

  private validate(record: TencentNativeSourceRecord): void {
    if (!object(record) || typeof record.gateway !== 'string' || typeof record.account !== 'string' || !['mirror', 'pending'].includes(record.delivery) || !object(record.event)) throw new Error('invalid source record')
    const event = record.event
    if (typeof event.id !== 'string' || !identifier.test(event.id) || typeof event.kind !== 'string' || !kinds.has(event.kind) || typeof event.source_sha256 !== 'string' || !digest.test(event.source_sha256) || !Number.isSafeInteger(event.observed_at) || event.observed_at < Date.now() - 300_000 || event.observed_at > Date.now() + 60_000 || !object(event.payload)) throw new Error('invalid or stale native event')
    if (event.source !== 'android_app' && !(event.source === 'native_player' && event.kind === 'watch')) throw new Error('native source required')
    if ((event.source === 'android_app' || event.device_guid_sha256 !== undefined) && !digest.test(event.device_guid_sha256 || '')) throw new Error('device binding required')
  }
}
